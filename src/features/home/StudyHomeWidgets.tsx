import { useMemo, useRef, useState } from 'react';
import { Columns3, Hourglass, Link, Quote } from 'lucide-react';
import type { FileLocation, Resource } from '../../../shared/actions.ts';
import { localDay } from '../../../shared/home.ts';
import { homeWidgetCatalog } from '../../../shared/homeWidgets.ts';
import type { Course, Task } from '../../../shared/workspace.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { ResourceEditor } from '../resources/ResourceEditor.tsx';
import { FilePicker } from '../resources/FileLibrary.tsx';
import { ResourceAction } from '../../services/actionRouter.tsx';
import { message } from '../../services/api.ts';
import { CourseSelect, HomeWidgetFrame, WidgetSettings } from './HomeWidgetFrame.tsx';
import type { HomeWidgetContext } from './HomeWidgetFrame.tsx';
import { useHomeNote } from './homeNotes.ts';

export function ShortcutsCard({ context }: { context: HomeWidgetContext }) {
  const { title } = homeWidgetCatalog.shortcuts;
  const items = context.configs.shortcuts ?? [];
  return <HomeWidgetFrame title={title} icon={Link} disabled={context.disabled}
    settings={(close) => <WidgetSettings title={title} initial={items} close={close}
      save={(value) => context.save('shortcuts', value)}
      fields={(draft, change) => <ResourceEditor items={draft} change={change} courses={context.courses}
        roots={context.roots} updateRoots={context.updateRoots} />} />}>
    {items.length ? <ul className="resources home-widget-list">{items.map((item) =>
      <li key={item.id}><ResourceAction item={item} context={context} /></li>)}</ul>
      : <p className="muted">在卡片设置中添加常用入口。</p>}
  </HomeWidgetFrame>;
}

function calendarDays(a: string, b: string) {
  return Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
}

export function CountdownCard({ context }: { context: HomeWidgetContext }) {
  const { title } = homeWidgetCatalog.countdown;
  const config = context.configs.countdown ?? { title: '学习目标', date: '', elapsed: false };
  const delta = config.date ? calendarDays(config.date, localDay(context.now)) : 0;
  const label = delta === 0 ? '就是今天' : delta > 0 ? '还有' : '已过去';
  return <HomeWidgetFrame title={title} icon={Hourglass} disabled={context.disabled}
    settings={(close) => <WidgetSettings title={title} initial={config} close={close}
      save={(value) => context.save('countdown', value)} fields={(draft, change) => <>
        <label>目标名称<input required maxLength={120} value={draft.title} onChange={(event) => change({ ...draft, title: event.target.value })} /></label>
        <label>目标日期<input required type="date" value={draft.date} onChange={(event) => change({ ...draft, date: event.target.value })} /></label>
        <label>类型<select value={draft.elapsed ? 'elapsed' : 'target'} onChange={(event) => change({ ...draft, elapsed: event.target.value === 'elapsed' })}>
          <option value="target">倒计时</option><option value="elapsed">纪念日</option>
        </select></label>
      </>} />}>
    {config.date ? <div className="home-countdown"><strong>{config.title}</strong>
      <div><span>{label}</span>{delta !== 0 && <> <b>{Math.abs(delta)}</b> 天</>}</div>
      <time className="muted" dateTime={config.date}>{config.date} · {config.elapsed ? '纪念日' : '目标日'}</time></div>
      : <p className="muted">在卡片设置中选择日期。</p>}
  </HomeWidgetFrame>;
}

export function NoteLocationFields({ location, change, context }: {
  location?: FileLocation; change: (value?: FileLocation) => void; context: HomeWidgetContext;
}) {
  const item: Extract<Resource, { kind: 'markdown' }> = {
    kind: 'markdown', title: '', icon: '', id: 'home-source', rootId: location?.rootId ?? '', path: location?.path ?? '',
  };
  return <FilePicker item={item} roots={context.roots} updateRoots={context.updateRoots} update={(next) => {
    if (next.kind === 'markdown') change({ rootId: next.rootId, path: next.path });
  }} />;
}

export function QuoteCard({ context }: { context: HomeWidgetContext }) {
  const { title } = homeWidgetCatalog.quote;
  const config = context.configs.quote ?? { text: '' };
  const { data, error } = useHomeNote(config.note);
  const lines = useMemo(() => (config.note ? data : config.text)?.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean) ?? [],
    [config.note, config.text, data]);
  const index = calendarDays(localDay(context.now), '1970-01-01');
  return <HomeWidgetFrame title={title} icon={Quote} disabled={context.disabled}
    settings={(close) => <WidgetSettings title={title} initial={config} close={close}
      save={(value) => context.save('quote', value)} fields={(draft, change) => <>
        <label>自定义语录（每行一条）<textarea maxLength={8000} value={draft.text}
          onChange={(event) => change({ ...draft, text: event.target.value })} /></label>
        <fieldset className="resource-form"><legend>笔记来源（选填，优先使用）</legend>
          {draft.note ? <>
            <NoteLocationFields location={draft.note} context={context} change={(note) => change({ ...draft, note })} />
            <button type="button" onClick={() => change({ ...draft, note: undefined })}>清除笔记来源</button>
          </> : <button type="button" onClick={() => change({ ...draft, note: { rootId: '', path: '' } })}>选择语录笔记</button>}
        </fieldset>
      </>} />}>
    {error ? <p role="alert" className="error">{error}</p> : lines.length
      ? <blockquote className="home-quote">{lines[((index % lines.length) + lines.length) % lines.length]}</blockquote>
      : <p className="muted">{config.note && data === undefined ? '正在读取语录…' : '在卡片设置中输入语录，或选一本一行一条的笔记。'}</p>}
  </HomeWidgetFrame>;
}

const columns = { todo: '待办', doing: '进行中', done: '完成' } satisfies Record<Task['status'], string>;

export function KanbanCard({ context }: { context: HomeWidgetContext }) {
  const { title } = homeWidgetCatalog.kanban;
  const config = context.configs.kanban ?? { courseId: '', showDone: true };
  const scope = config.courseId ? context.courses.filter(({ id }) => id === config.courseId) : context.courses;
  const drag = useRef<{ course: Course; task: Task }>(null);
  const [target, setTarget] = useState<Task['status']>();
  const [draft, setDraft] = useState<{ courseId: string; task: Task }>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const blocked = pending || context.disabled;

  async function update(course: Course, task: Task) {
    setError('');
    setPending(true);
    try {
      const tasks = course.tasks.some(({ id }) => id === task.id)
        ? course.tasks.map((item) => item.id === task.id ? task : item) : [...course.tasks, task];
      if (await context.saveCourse({ ...course, tasks })) setDraft(undefined);
      else setError('任务未能保存。');
    } catch (failure) {
      setError(message(failure));
    } finally {
      setPending(false);
    }
  }

  return <HomeWidgetFrame title={title} icon={Columns3} disabled={context.disabled}
    settings={(close) => <WidgetSettings title={title} initial={config} close={close}
      save={(value) => context.save('kanban', value)} fields={(value, change) => <>
        <CourseSelect courses={context.courses} value={value.courseId} empty="所有课程" change={(courseId) => change({ ...value, courseId })} />
        <label className="check"><input type="checkbox" checked={value.showDone}
          onChange={(event) => change({ ...value, showDone: event.target.checked })} />显示已完成</label>
      </>} />}>
    <div className="home-widget-actions"><button type="button" disabled={blocked || !scope.some(({ tasks }) => tasks.length < 300)}
      onClick={() => {
        setError('');
        setDraft({ courseId: scope.length === 1 ? scope[0].id : '',
          task: { id: crypto.randomUUID(), title: '', notes: '', dueAt: '', status: 'todo', resourceId: null } });
      }}>新建看板任务</button></div>
    <div className="home-kanban">
      {(Object.keys(columns) as Task['status'][]).filter((status) => config.showDone || status !== 'done').map((status) => {
        const items = scope.flatMap((course) => course.tasks.filter((task) => task.status === status).map((task) => ({ course, task })));
        return <section key={status} aria-label={columns[status]} data-drop={target === status ? '' : undefined}
          onDragOver={(event) => {
            if (drag.current && !blocked) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setTarget(status); }
          }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(undefined); }}
          onDrop={(event) => {
            if (!drag.current || blocked) return;
            event.preventDefault();
            const { course, task } = drag.current;
            drag.current = null;
            setTarget(undefined);
            if (task.status !== status) void update(course, { ...task, status });
          }}>
          <h3>{columns[status]} <small>{items.length}</small></h3>
          <ul className="plain-list">{items.map(({ course, task }) => <li key={task.id} draggable={!blocked}
            onDragStart={(event) => { drag.current = { course, task }; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', task.id); }}
            onDragEnd={() => { drag.current = null; setTarget(undefined); }}>
            <button type="button" className="quiet-button" disabled={blocked} onClick={() => { setError(''); setDraft({ courseId: course.id, task }); }}>{task.title}</button>
            <small className="muted">{course.name}{task.dueAt && ' · ' + task.dueAt}</small>
            <select aria-label={task.title + '看板状态'} value={task.status} disabled={blocked} onChange={(event) =>
              void update(course, { ...task, status: event.target.value as Task['status'] })}>
              {Object.entries(columns).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </li>)}</ul>
        </section>;
      })}
    </div>
    {!draft && error && <p role="alert" className="error">{error}</p>}
    {draft && <Dialog title="看板任务" onClose={() => { if (!pending) setDraft(undefined); }}>
      <form className="form" onSubmit={(event) => {
        event.preventDefault();
        const course = scope.find(({ id }) => id === draft.courseId);
        if (course) void update(course, { ...draft.task, title: draft.task.title.trim() });
      }}>
        {draft.task.status === 'todo' && !scope.some(({ tasks }) => tasks.some(({ id }) => id === draft.task.id)) &&
          <CourseSelect courses={scope.filter(({ tasks }) => tasks.length < 300)} value={draft.courseId}
            empty="选择课程" required change={(courseId) => setDraft({ ...draft, courseId })} />}
        <label>任务标题<input required maxLength={120} value={draft.task.title}
          onChange={(event) => setDraft({ ...draft, task: { ...draft.task, title: event.target.value } })} /></label>
        <label>截止日期<input type="date" value={draft.task.dueAt}
          onChange={(event) => setDraft({ ...draft, task: { ...draft.task, dueAt: event.target.value } })} /></label>
        <label>任务备注<textarea maxLength={4000} value={draft.task.notes}
          onChange={(event) => setDraft({ ...draft, task: { ...draft.task, notes: event.target.value } })} /></label>
        {error && <p role="alert" className="error">{error}</p>}
        <button type="submit" className="primary" disabled={blocked || !draft.task.title.trim()}>保存看板任务</button>
      </form>
    </Dialog>}
  </HomeWidgetFrame>;
}
