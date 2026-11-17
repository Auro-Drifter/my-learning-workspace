import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, CalendarDays, LayoutGrid, ListTodo, PencilLine, Settings2, Sunrise } from 'lucide-react';
import { finishFocus, getHomeLayout, localDay, pluginHomeId } from '../../../shared/home.ts';
import type { Home, HomeCardId, HomeLayout } from '../../../shared/home.ts';
import type { InstalledPlugin, PluginLibrary } from '../../../shared/plugins.ts';
import type { Course } from '../../../shared/workspace.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { message } from '../../services/api.ts';
import { FocusCard } from './FocusCard.tsx';
import { HabitCard } from './HabitCard.tsx';
import { HomePluginCard } from '../plugins/HomePluginCard.tsx';
import { HomeLayoutGrid } from './HomeLayoutEditor.tsx';
import type { HomeCardDefinition, HomeLayoutDraft } from './HomeLayoutEditor.tsx';
import type { HomeWidgetContext } from './HomeWidgetFrame.tsx';
import { extraHomeCards } from './homeWidgetRegistry.tsx';
import './home.css';

const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
const timeFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function greeting(now: Date) {
  const hour = now.getHours();
  if (hour < 5 || hour >= 22) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

type SettingsTarget = 'all' | 'welcome' | 'habits';

function HomeForm({ home, target, close, submit }: {
  home: Home; target: SettingsTarget; close: () => void; submit: (next: Home) => Promise<boolean>;
}) {
  const [name, setName] = useState(home.name);
  const [welcome, setWelcome] = useState(home.welcome ?? { clock: true, courseCount: true });
  const [habits, setHabits] = useState(home.habits);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const title = target === 'all' ? '首页设置' : target === 'welcome' ? '欢迎横幅设置' : '习惯打卡设置';
  return <Dialog title={title} onClose={() => { if (!busy) close(); }}>
    <form className="form" onSubmit={async (event) => {
      event.preventDefault();
      const titles = habits.map(({ title }) => title.trim());
      if (titles.some((title) => !title)) return setError('请填写每项习惯的名称。');
      const ids = new Set(habits.map(({ id }) => id));
      const checkIns = Object.fromEntries(Object.entries(home.checkIns)
        .map(([date, values]) => [date, values.filter((id) => ids.has(id))] as const)
        .filter(([, values]) => values.length > 0));
      setBusy(true);
      setError('');
      try {
        if (await submit({
          ...home, name: name.trim(), welcome: home.welcome || !welcome.clock || !welcome.courseCount ? welcome : undefined,
          habits: habits.map((habit, index) => ({ ...habit, title: titles[index] })), checkIns,
        })) {
          close();
        } else setError('首页设置保存失败。');
      } catch (failure) {
        setError(message(failure));
      } finally {
        setBusy(false);
      }
    }}>
      {target !== 'habits' && <>
        <label>称呼（选填）<input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={welcome.clock} onChange={(event) =>
          setWelcome({ ...welcome, clock: event.target.checked })} />显示时钟</label>
        <label className="check"><input type="checkbox" checked={welcome.courseCount} onChange={(event) =>
          setWelcome({ ...welcome, courseCount: event.target.checked })} />显示课程数量</label>
      </>}
      {target !== 'welcome' && <fieldset className="resource-form">
        <legend>打卡习惯</legend>
        {habits.map((habit, index) => <div className="habit-form-row" key={habit.id}>
          <label>习惯 {index + 1}<input maxLength={25} required value={habit.title} onChange={(event) =>
            setHabits(habits.map((entry) => entry.id === habit.id ? { ...entry, title: event.target.value } : entry))} /></label>
          <button type="button" onClick={() => {
            if (Object.values(home.checkIns).some((entry) => entry.includes(habit.id))
              && !window.confirm('保存后会同时移除这项习惯的历史记录。继续移除？')) return;
            setHabits(habits.filter((entry) => entry.id !== habit.id));
          }}>移除</button>
        </div>)}
        <button type="button" disabled={habits.length >= 8} onClick={() => setHabits([...habits, { id: crypto.randomUUID(), title: '' }])}>添加习惯</button>
      </fieldset>}
      {error && <p role="alert" className="error">{error}</p>}
      <button type="submit" className="primary" disabled={busy}>保存首页设置</button>
    </form>
  </Dialog>;
}

export function HomePage({ home, courses, current, disabled, select, save, plugins, savePlugin, managePlugins, draft, layoutChanged, setDraft, saveLayout, roots, updateRoots, openFile, saveCourse }: {
  home: Home; courses: Course[]; current?: Course; disabled: boolean;
  select: (id: string) => void; save: (data: Home) => Promise<boolean>;
  plugins: PluginLibrary; savePlugin: (plugin: InstalledPlugin) => Promise<boolean>; managePlugins: () => void;
  draft?: HomeLayoutDraft;
  layoutChanged: boolean; setDraft: (next?: HomeLayoutDraft) => void;
  saveLayout: (cards: HomeLayout, original: HomeLayout) => Promise<boolean>;
  roots: HomeWidgetContext['roots']; updateRoots: HomeWidgetContext['updateRoots'];
  openFile: HomeWidgetContext['openFile']; saveCourse: HomeWidgetContext['saveCourse'];
}) {
  const [now, setNow] = useState(() => new Date());
  const [settings, setSettings] = useState<SettingsTarget>();
  const [layoutError, setLayoutError] = useState('');
  useEffect(() => {
    const update = () => setNow(new Date());
    const interval = window.setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  useEffect(() => {
    if (disabled) return;
    const complete = finishFocus(home, now.getTime());
    if (complete !== home) void save(complete);
  }, [home, disabled, now, save]);

  const upcoming = courses.flatMap((course) => course.tasks.filter((task) => task.status !== 'done').map((task) => ({ course, task })))
    .sort((a, b) => (a.task.dueAt || '9999-12-31').localeCompare(b.task.dueAt || '9999-12-31'));
  const savedCards = getHomeLayout(home.layout, plugins);
  const cards = draft
    ? [...draft.cards, ...savedCards.filter(({ id }) => !draft.cards.some((card) => card.id === id))]
    : savedCards;

  const widgetContext: HomeWidgetContext = {
    roots, updateRoots, openFile, saveCourse, courses, disabled, now, selectCourse: select, configs: home.widgets ?? {},
    save: (id, config) => save({ ...home, widgets: { ...home.widgets, [id]: config } }),
  };
  const definitions = new Map<HomeCardId, HomeCardDefinition>([
    ['welcome', { title: '欢迎横幅', render: () => <section className="home-card home-welcome" aria-labelledby="home-welcome-title">
      <header className="home-card-header">
        <div className="home-card-heading">
          <span className="home-card-icon"><Sunrise aria-hidden="true" /></span>
          <h2 id="home-welcome-title">欢迎横幅</h2>
        </div>
        <button type="button" className="quiet-button home-icon-button" aria-label="欢迎横幅设置" title="欢迎横幅设置"
          disabled={disabled} onClick={() => setSettings('welcome')}><Settings2 className="tool-icon" aria-hidden="true" /></button>
      </header>
      <div className="home-welcome-body">
        <div className="welcome-intro">
          <h3>{greeting(now)}{home.name && <>，<span>{home.name}</span></>}</h3>
          {(home.welcome?.courseCount ?? true) && <p><BookOpen className="tool-icon" aria-hidden="true" />{courses.length} 门课程</p>}
          {current && <button type="button" className="welcome-continue" disabled={disabled} onClick={() => select(current.id)}>
            继续学习 <span className="welcome-course">{current.name}</span><ArrowRight className="tool-icon" aria-hidden="true" />
          </button>}
        </div>
        {(home.welcome?.clock ?? true) && <time className="welcome-clock" dateTime={localDay(now) + 'T' + timeFormat.format(now)}>
          <strong>{timeFormat.format(now)}</strong><span><CalendarDays className="tool-icon" aria-hidden="true" />{dateFormat.format(now)}</span>
        </time>}
      </div>
    </section> }],
    ['habits', { title: '习惯打卡', render: () =>
      <HabitCard home={home} now={now} disabled={disabled} save={save} edit={() => setSettings('habits')} /> }],
    ['focus', { title: '番茄钟', render: () => <FocusCard home={home} now={now} disabled={disabled} save={save} /> }],
    ['tasks', { title: '学习待办', render: () => <section className="home-card home-tasks" aria-labelledby="home-tasks-title">
      <header className="home-card-header">
        <div className="home-card-heading">
          <span className="home-card-icon"><ListTodo aria-hidden="true" /></span>
          <h2 id="home-tasks-title">学习待办</h2>
        </div>
        <span className="home-card-meta">{upcoming.length} 项未完成</span>
      </header>
      {upcoming.length ? <ul className="plain-list home-task-list">{upcoming.slice(0, 5).map(({ course, task }) =>
        <li key={course.id + ':' + task.id}><button type="button" className="quiet-button" disabled={disabled} onClick={() => select(course.id)}>
          <span>{task.title}</span><small>{course.name}{task.dueAt ? ' · ' + task.dueAt : ''}</small>
          <ArrowRight className="tool-icon" aria-hidden="true" />
        </button></li>)}</ul> : <p className="muted home-task-empty">暂无待办。</p>}
    </section> }],
    ...extraHomeCards(widgetContext),
  ]);
  if (plugins.disabledBuiltins.includes('quickLinks')) definitions.delete('shortcuts');
  if (plugins.disabledBuiltins.includes('tasks')) definitions.delete('kanban');
  for (const id of ['welcome', 'habits', 'focus', 'tasks'] as const) {
    if (plugins.disabledBuiltins.includes(id)) definitions.delete(id);
  }
  for (const plugin of plugins.packages) {
    if (plugin.enabled) definitions.set(pluginHomeId(plugin.manifest.id), {
      title: plugin.manifest.name, group: '插件', render: () => <HomePluginCard plugin={plugin} disabled={disabled} save={savePlugin} />,
    });
  }

  function changeLayout(next: HomeLayout) {
    if (!draft) return;
    setLayoutError('');
    setDraft({ ...draft, cards: next });
  }

  return <div className="home-dashboard">
    <header className="home-masthead">
      <h1>首页</h1>
      <div className="home-tools">
        {draft ? <>
          <button type="button" className="quiet-button" disabled={disabled}
            onClick={() => changeLayout(getHomeLayout(undefined, plugins))}>恢复默认布局</button>
          <button type="button" disabled={disabled} onClick={() => { setLayoutError(''); setDraft(undefined); }}>取消</button>
          <button type="button" className="primary" disabled={disabled} onClick={async () => {
            setLayoutError('');
            if (!layoutChanged || await saveLayout(cards, draft.original)) setDraft(undefined);
            else setLayoutError('首页布局未能保存。请检查上方的保存状态。');
          }}>保存首页布局</button>
        </> : <>
          {current && (!definitions.has('welcome') || cards.find(({ id }) => id === 'welcome')?.hidden) &&
            <button type="button" className="quiet-button" disabled={disabled} onClick={() => select(current.id)}>
              继续学习 · {current.name}<ArrowRight className="tool-icon" aria-hidden="true" />
            </button>}
          <a href="#home-pages" className="quiet-button button-like">Home Pages 原版</a>
          <button type="button" className="quiet-button" onClick={managePlugins}>
            <LayoutGrid className="tool-icon" aria-hidden="true" />管理组件
          </button>
          <button type="button" className="quiet-button" disabled={disabled} onClick={() => setSettings('all')}>
            <Settings2 className="tool-icon" aria-hidden="true" />首页设置
          </button>
          <button type="button" className="home-edit-button" disabled={disabled} onClick={() => {
            setDraft({ original: savedCards, cards: savedCards });
          }}><PencilLine className="tool-icon" aria-hidden="true" />编辑首页</button>
        </>}
      </div>
    </header>
    {layoutError && <p className="error" role="alert">{layoutError}</p>}
    <HomeLayoutGrid cards={cards} definitions={definitions} change={draft ? changeLayout : undefined} busy={disabled} />
    {settings && <HomeForm home={home} target={settings} submit={save} close={() => setSettings(undefined)} />}
  </div>;
}
