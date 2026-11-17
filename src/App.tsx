import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { defaultAppearance } from '../shared/appearance.ts';
import type { Appearance } from '../shared/appearance.ts';
import type { InstalledPlugin } from '../shared/plugins.ts';
import { pluginHomeId } from '../shared/home.ts';
import type { HomeCardId, HomeLayout } from '../shared/home.ts';
import type { HomeLayoutDraft } from './features/home/HomeLayoutEditor.tsx';
import type { RootGrant } from '../shared/files.ts';
import { Dialog } from './components/Dialog.tsx';
import { QuickJump } from './components/QuickJump.tsx';
import type { LocalResource } from './services/actionRouter.tsx';
import type { Course, Workspace } from '../shared/workspace.ts';
import { replaceCourse } from '../shared/workspace.ts';
import { CourseForm } from './features/courses/CourseForm.tsx';
import { CoursePage } from './features/courses/CoursePage.tsx';
import { CourseSidebar } from './features/courses/CourseSidebar.tsx';
import { applyCourseTreeAction, canCopyInto, recordCourseDates } from './features/courses/courseExplorer.ts';
import type { CourseTreeAction } from './features/courses/courseExplorer.ts';
import { useLayoutDrafts } from './features/courses/layoutDrafts.ts';
import { HomePage } from './features/home/HomePage.tsx';
import { HomePagesFrame } from './features/home-pages/HomePagesFrame.tsx';
import { ConfigPanel, exportConfig } from './features/settings/ConfigPanel.tsx';
import type { SettingsSection } from './features/settings/ConfigPanel.tsx';
import { appearanceVariables } from './features/settings/appearanceStyle.ts';
import { api, isPagesDemo, message } from './services/api.ts';
import { followInCurrentPage, routeHref } from './services/navigation.ts';
import { useWorkspaceRoute } from './services/useWorkspaceRoute.ts';
import { useWorkspace } from './services/useWorkspace.ts';
import { useBeforeUnloadWarning } from './services/useBeforeUnloadWarning.ts';

const NoteViewer = lazy(() => import('./features/notes/NoteViewer.tsx'));
const PdfViewer = lazy(() => import('./features/pdf/PdfViewer.tsx'));
const narrowScreen = '(max-width: 760px)';

export function App() {
  const state = useWorkspace();
  const { route, navigate, courseHref } = useWorkspaceRoute(state.workspace);
  const layouts = useLayoutDrafts();
  const [homeDraft, setHomeDraft] = useState<HomeLayoutDraft>();
  const homeChanged = !!homeDraft && homeDraft.original !== homeDraft.cards
    && JSON.stringify(homeDraft.original) !== JSON.stringify(homeDraft.cards);
  useBeforeUnloadWarning(homeChanged || layouts.changed);
  const [form, setForm] = useState<Course | 'new'>();
  const [newCourseFolder, setNewCourseFolder] = useState<string[]>();
  const [viewer, setViewer] = useState<LocalResource>();
  const [roots, setRoots] = useState<RootGrant[]>([]);
  const [rootsError, setRootsError] = useState('');
  const refreshRoots = useCallback(() => {
    void api<RootGrant[]>('/api/roots').then(
      (values) => { setRoots(values); setRootsError(''); },
      (failure) => setRootsError(message(failure)),
    );
  }, []);
  useEffect(refreshRoots, [refreshRoots]);

  const [settings, setSettings] = useState<SettingsSection>();
  const [jump, setJump] = useState(false);
  const [appearancePreview, setAppearancePreview] = useState<Appearance>();
  const [rail, setRail] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia(narrowScreen).matches);
  const [localError, setLocalError] = useState('');
  const main = useRef<HTMLElement>(null);
  const sidebarToggle = useRef<HTMLButtonElement>(null);

  const workspace = state.workspace;
  const appearance = appearancePreview ?? workspace?.appearance ?? defaultAppearance;
  const home = route.page !== 'course';
  const disabled = state.savingReason !== 'course-navigation' && (state.saving || !!state.draft);
  const saveStatus = state.savingReason === 'changes' ? '正在保存…'
    : state.draft && !state.savingReason ? '有未保存的更改'
      : layouts.changed || homeChanged ? '有布局草稿' : '已保存';
  const selectedId = route.page === 'course' ? route.id ?? workspace?.activeCourseId : workspace?.activeCourseId;
  const course = workspace?.courses.find((entry) => entry.id === selectedId && !entry.archived);
  const drawerOpen = narrow && drawer;
  const sidebar = narrow ? drawer : rail;

  useEffect(() => {
    const media = window.matchMedia(narrowScreen);
    const update = () => {
      setNarrow(media.matches);
      if (!media.matches) setDrawer(false);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape' && drawerOpen) {
        event.preventDefault();
        setDrawer(false);
        requestAnimationFrame(() => sidebarToggle.current?.focus());
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'
        && !form && !viewer && !settings && !jump && !drawerOpen && workspace) {
        event.preventDefault();
        setJump(true);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [form, viewer, settings, jump, drawerOpen, workspace]);

  useEffect(() => { setDrawer(false); }, [home, selectedId]);
  useLayoutEffect(() => { if (main.current) main.current.scrollTop = 0; }, [home, selectedId]);
  useLayoutEffect(() => {
    const style = document.documentElement.style;
    const variables = Object.entries(appearanceVariables(appearance));
    for (const [name, value] of variables) style.setProperty(name, value);
    return () => { for (const [name] of variables) style.removeProperty(name); };
  }, [appearance]);

  useEffect(() => {
    if (home || settings || !workspace || !course || state.saving || state.draft || workspace.activeCourseId === course.id) return;
    void state.commit({ ...workspace, activeCourseId: course.id }, 'course-navigation').catch((failure) => setLocalError(message(failure)));
  }, [home, settings, workspace, course, state.saving, state.draft, state.commit]);

  function perform(next: Workspace) {
    setLocalError('');
    return state.commit(next).catch((failure) => {
      setLocalError(message(failure));
      return false;
    });
  }

  if (!workspace) return <main className="loading">
    <h1>My Learning Workspace</h1>
    {state.error ? <>
      <p role="alert" className="error">{state.error}</p>
      <button type="button" onClick={() => void state.reload()}>重新读取</button>
    </> : <p role="status">正在读取本地配置…</p>}
  </main>;

  const { courses } = workspace;
  const available = courses.filter((entry) => !entry.archived);
  const siblings = course ? available.filter((entry) => entry.navigationPath.join('/') === course.navigationPath.join('/')) : [];
  const siblingIndex = course ? siblings.indexOf(course) : -1;

  function closeDrawer(restore = true) {
    if (!drawerOpen) return;
    setDrawer(false);
    requestAnimationFrame(() => restore ? sidebarToggle.current?.focus() : main.current?.focus({ preventScroll: true }));
  }

  const saveHomeLayout = (cards: HomeLayout, original: HomeLayout) => {
    const visibility = new Map(cards.map(({ id, hidden }) => [id, hidden]));
    const previous = new Map(original.map(({ id, hidden }) => [id, hidden]));
    const packages = workspace.plugins.packages.map((plugin) => {
      const id = pluginHomeId(plugin.manifest.id);
      const hidden = visibility.get(id);
      return hidden !== undefined && hidden !== previous.get(id) ? { ...plugin, showOnHome: !hidden } : plugin;
    });
    const pins = new Map<HomeCardId, boolean>(packages.map((plugin) => [pluginHomeId(plugin.manifest.id), plugin.showOnHome]));
    const layout = cards.flatMap((card) => {
      if (!card.id.startsWith('plugin:')) return [card];
      const pinned = pins.get(card.id);
      return pinned === undefined ? [] : [{ ...card, hidden: !pinned }];
    });
    return perform({ ...workspace, home: { ...workspace.home, layout }, plugins: { ...workspace.plugins, packages } });
  };

  function showHome() {
    navigate({ page: 'home' });
    closeDrawer(false);
  }

  function selectCourse(id: string) {
    if (!available.some((entry) => entry.id === id)) return;
    navigate({ page: 'course', id });
    closeDrawer(false);
  }

  async function handleTreeAction(action: CourseTreeAction) {
    if (disabled || !workspace) return false;
    const next = applyCourseTreeAction(workspace, action);
    if (next === workspace) return action.type === 'rename';
    if (!await perform(recordCourseDates(next, workspace))) return false;
    if (action.type === 'purge') {
      for (const id of workspace.courseExplorer?.trash.find((entry) => entry.id === action.id)?.courses ?? []) layouts.discard(id);
    }
    // The rendered workspace already reflects the saved tree before falling back to another course.
    if (action.type === 'trash' && !home && course && !next.courses.some(({ id, archived }) => id === course.id && !archived)) {
      navigate(next.activeCourseId ? { page: 'course', id: next.activeCourseId } : { page: 'home' }, true);
    }
    return true;
  }

  const saveCourse = (next: Course) => state.commit(recordCourseDates(replaceCourse(workspace, next), workspace));
  const saveHomePlugin = (plugin: InstalledPlugin) => state.commit({ ...workspace, plugins: {
    ...workspace.plugins,
    packages: workspace.plugins.packages.map((entry) => entry.manifest.id === plugin.manifest.id ? plugin : entry),
  } });
  const viewingPosition = viewer && workspace.pdfPositions.find(({ rootId, path }) => rootId === viewer.rootId && path === viewer.path);

  return <div className="workbench">
    <a className="skip-link" href="#workspace-main" tabIndex={drawerOpen ? -1 : undefined} onClick={(event) => {
      event.preventDefault();
      main.current?.focus();
    }}>跳到主内容</a>
    <header className="app-header" inert={drawerOpen}>
      <div className="masthead-start">
        <button ref={sidebarToggle} type="button" className="sidebar-toggle" aria-controls="course-sidebar" aria-expanded={sidebar}
          aria-label={sidebar ? '收起课程' : '展开课程'} title={sidebar ? '收起课程' : '展开课程'}
          onClick={() => narrow ? setDrawer(!drawer) : setRail(!rail)}>
          {sidebar ? <PanelLeftClose className="tool-icon" aria-hidden="true" />
            : <PanelLeftOpen className="tool-icon" aria-hidden="true" />}
        </button>
        <a href={routeHref({ page: 'home' })} className="brand" aria-label="My Learning Workspace 首页" onClick={(event) => {
          if (followInCurrentPage(event)) showHome();
        }}>
          <span aria-hidden="true" className="brand-mark"><i /><i /><i /></span>
          <strong>My Learning Workspace</strong>
        </a>
      </div>
      <button type="button" className="jump-trigger" aria-label="快速跳转" aria-keyshortcuts="Control+K Meta+K" onClick={() => setJump(true)}>
        <Search className="tool-icon" aria-hidden="true" />
        <span className="jump-label">快速跳转</span><kbd>Ctrl K</kbd>
      </button>
      <div className="masthead-end">
        {isPagesDemo && <small className="muted" title="更改只保存在当前浏览器">在线体验版</small>}
        <span aria-live="polite" className="save-status" data-pending={saveStatus !== '已保存'}>{saveStatus}</span>
        <button type="button" className="quiet-button settings-trigger" onClick={() => setSettings('appearance')}>设置</button>
      </div>
    </header>
    <div className={'shell' + (sidebar ? '' : ' sidebar-hidden')} data-drawer={drawerOpen}>
      {narrow && <button type="button" className="drawer-shade" tabIndex={-1} inert={!drawerOpen}
        aria-hidden={!drawerOpen} aria-label="关闭课程导航" onClick={() => closeDrawer()} />}
      <CourseSidebar visible={sidebar} courses={courses} current={course} home={home} disabled={disabled} drawer={drawerOpen}
        draftIds={[...layouts.drafts.keys()]} close={() => closeDrawer()}
        explorer={workspace.courseExplorer} act={handleTreeAction} courseHref={courseHref}
        openHome={showHome} add={(folder) => {
          setNewCourseFolder(folder === undefined ? undefined : folder ? folder.split('/') : []);
          closeDrawer(false);
          setForm('new');
        }} select={selectCourse}
        edit={(entry) => {
          if (disabled) return;
          selectCourse(entry.id);
          setForm(entry);
        }}
        canDrop={(items, target, copy) => {
          if (disabled) return false;
          if (copy) return canCopyInto(workspace, items, target);
          try { return applyCourseTreeAction(workspace, { type: 'move', items, target }) !== workspace; }
          catch { return false; }
        }}
        restore={async (entry) => {
          if (await perform({ ...replaceCourse(workspace, { ...entry, archived: false }), activeCourseId: entry.id })) {
            navigate({ page: 'course', id: entry.id });
            closeDrawer(false);
          }
        }} />
      <main className={route.page === 'home-pages' ? 'workspace workspace-home-pages' : 'workspace'} ref={main} id="workspace-main" tabIndex={-1} inert={drawerOpen}>
        {(state.error || localError) && <section className="panel error" role="alert">
          <p>{state.error || localError}</p>
          {state.draft && <div className="row">
            <button type="button" onClick={() => exportConfig(state.draft!)}>导出未保存配置</button>
            {!state.conflict && <button type="button" disabled={state.saving} onClick={() => void perform(state.draft!)}>重试保存</button>}
            <button type="button" disabled={state.saving} onClick={() => {
              if (window.confirm('放弃未保存的配置并重新读取磁盘？')) void state.reload();
            }}>重新读取磁盘</button>
          </div>}
        </section>}
        {route.page === 'home-pages' ? <HomePagesFrame roots={roots} openFile={setViewer} appearance={appearance} />
          : home ? <HomePage home={workspace.home} courses={available} current={course} disabled={disabled} select={selectCourse} layoutChanged={homeChanged}
          managePlugins={() => setSettings('plugins')} save={(next) => state.commit({ ...workspace, home: next })}
          plugins={workspace.plugins} savePlugin={saveHomePlugin} draft={homeDraft} setDraft={setHomeDraft}
          roots={roots} updateRoots={setRoots} openFile={setViewer} saveCourse={saveCourse}
          saveLayout={saveHomeLayout} />
          : course ? <CoursePage key={course.id} course={course} disabled={disabled} fontSize={appearance.fontSize}
            context={{ course, courses, roots, updateRoots: setRoots, plugins: workspace.plugins, disabled, selectCourse, saveCourse, openFile: setViewer }}
            editCourse={() => setForm(course)} saveCourse={saveCourse} showHome={showHome}
            draft={layouts.drafts.get(course.id)} startLayout={() => layouts.begin(course)} editLayout={(widgets) => layouts.edit(course.id, widgets)}
            undoLayout={() => layouts.undo(course.id)} closeLayout={() => layouts.discard(course.id)}
            canMoveUp={siblingIndex > 0} canMoveDown={siblingIndex < siblings.length - 1}
            shiftCourse={(shift) => {
              const other = siblings[siblingIndex + shift];
              if (!other) return;
              const index = courses.indexOf(course);
              const next = courses.indexOf(other);
              const list = [...courses];
              [list[index], list[next]] = [other, course];
              void perform({ ...workspace, courses: list });
            }}
            archive={async () => {
              if (!window.confirm('归档「' + course.name + '」？可从侧栏恢复。')) return;
              const index = available.indexOf(course);
              const next = available[index + 1] ?? available[index - 1];
              if (await perform({ ...replaceCourse(workspace, { ...course, archived: true }), activeCourseId: next?.id ?? null })) {
                layouts.discard(course.id);
                navigate(next ? { page: 'course', id: next.id } : { page: 'home' }, true);
              }
            }}
          /> : <section className="empty">
            <h1>{route.id ? '课程不可用' : '暂无活动课程'}</h1>
            {route.id && <p>这门课程可能已归档。可从侧栏打开其他课程。</p>}
            <button type="button" onClick={showHome}>返回首页</button>
          </section>}
      </main>
    </div>
    {jump && <QuickJump courses={available} currentId={course?.id} close={() => setJump(false)} select={(id) => {
      selectCourse(id);
      requestAnimationFrame(() => main.current?.focus({ preventScroll: true }));
    }} />}
    {form && <CourseForm initial={form === 'new' ? undefined : form} courses={courses}
      folders={workspace.courseExplorer?.folders}
      defaultFolder={newCourseFolder ?? (home ? undefined : course?.navigationPath)} close={() => setForm(undefined)} save={async (next) => {
        const saved = await (form === 'new'
          ? state.commit(recordCourseDates({ ...workspace, courses: [...courses, next], activeCourseId: next.id }, workspace))
          : saveCourse(next));
        if (saved && form === 'new') navigate({ page: 'course', id: next.id });
        return saved;
      }} />}
    {settings && <ConfigPanel workspace={workspace} close={() => setSettings(undefined)} restore={state.commit} disabled={disabled}
      initialSection={settings} onImported={(imported) => {
        setHomeDraft(undefined);
        layouts.clear();
        if (!home) navigate(imported.activeCourseId ? { page: 'course', id: imported.activeCourseId } : { page: 'home' }, true);
      }} roots={roots} rootsError={rootsError} updateRoots={setRoots} refreshRoots={refreshRoots}
      openFile={setViewer} previewAppearance={setAppearancePreview} />}
    {viewer && <Suspense fallback={<Dialog title={viewer.title} className="reader-dialog" onClose={() => setViewer(undefined)}><p role="status">正在加载阅读器…</p></Dialog>}>
      {viewer.kind === 'markdown'
        ? <NoteViewer key={viewer.rootId + '/' + viewer.path} location={viewer} title={viewer.title} close={() => setViewer(undefined)} />
        : <PdfViewer key={viewer.rootId + '/' + viewer.path} location={viewer} title={viewer.title} lastPage={viewingPosition?.page ?? 1}
          close={() => setViewer(undefined)} remember={async (page) => {
            if (disabled) return false;
            const previous = workspace.pdfPositions.filter(({ rootId, path }) => rootId !== viewer.rootId || path !== viewer.path);
            return state.commit({ ...workspace, pdfPositions: [...previous.slice(-499), { rootId: viewer.rootId, path: viewer.path, page }] });
          }} />}
    </Suspense>}
  </div>;
}
