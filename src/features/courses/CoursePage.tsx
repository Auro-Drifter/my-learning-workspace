import { useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Archive, ArrowDown, ArrowUp, ChevronDown, Pencil } from 'lucide-react';
import type { Layout } from 'react-grid-layout';
import { newResource } from '../resources/ResourceEditor.tsx';
import { courseResources, firstFreePosition, overlaps } from '../../../shared/workspace.ts';
import type { Course, Widget } from '../../../shared/workspace.ts';
import { message } from '../../services/api.ts';
import { followInCurrentPage, routeHref } from '../../services/navigation.ts';
import type { ActionContext } from '../../services/actionRouter.tsx';
import { CourseActionsMenu } from '../../components/CourseActionsMenu.tsx';
import { WidgetForm } from '../../widgets/WidgetForm.tsx';
import { WidgetGrid } from '../../widgets/WidgetGrid.tsx';
import { WidgetLibrary } from '../../widgets/WidgetLibrary.tsx';
import { reflowWidgets } from '../../widgets/reflowWidgets.ts';
import { widgetChoices, widgetSize } from '../../widgets/registry.tsx';
import type { LayoutDraft } from './layoutDrafts.ts';
import { sameWidgets } from './layoutDrafts.ts';

export function CoursePage({
  course, disabled, fontSize, context, saveCourse, editCourse, shiftCourse, archive, canMoveUp, canMoveDown, showHome,
  draft, startLayout, editLayout, undoLayout, closeLayout,
}: {
  course: Course;
  disabled: boolean;
  fontSize: number;
  context: ActionContext;
  saveCourse: (course: Course) => Promise<boolean>;
  editCourse: () => void;
  shiftCourse: (shift: -1 | 1) => void;
  archive: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  showHome: () => void;
  draft?: LayoutDraft;
  startLayout: () => void;
  editLayout: (widgets: Widget[]) => void;
  undoLayout: () => void;
  closeLayout: () => void;
}) {
  const [library, setLibrary] = useState(false);
  const [config, setConfig] = useState<Widget>();
  const [error, setError] = useState('');
  const managementTrigger = useRef<HTMLButtonElement>(null);
  const editAfterMenu = useRef(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const choices = widgetChoices(context.plugins);
  const editing = !!draft;
  const widgets = draft?.widgets ?? course.widgets;
  const dirty = !!draft && !sameWidgets(draft.original, draft.widgets);
  const matchesSaved = !!draft && dirty && sameWidgets(draft.widgets, course.widgets);
  const stale = !!draft && !matchesSaved && !sameWidgets(draft.original, course.widgets);

  useEffect(() => {
    if (matchesSaved && !disabled) closeLayout();
  }, [matchesSaved, disabled, closeLayout]);

  function saveWidgets(nextWidgets: Widget[]) {
    const next = { ...course, widgets: nextWidgets };
    const ids = new Set(courseResources(next).map(({ id }) => id));
    return saveCourse({
      ...next,
      tasks: next.tasks.map((task) => task.resourceId && !ids.has(task.resourceId) ? { ...task, resourceId: null } : task),
    });
  }

  function finish() {
    closeLayout();
    setError('');
    requestAnimationFrame(() => editButton.current?.focus({ preventScroll: true }));
  }

  function edit(action: () => Widget[]) {
    setError('');
    try { editLayout(action()); }
    catch (failure) { setError(message(failure)); }
  }

  function applyPositions(layout: Layout) {
    if (!editing) return;
    const positions = new Map(layout.map(({ i, x, y, w, h }) => [i, { x, y, w, h }]));
    editLayout(widgets.map((widget) => {
      const next = positions.get(widget.id);
      if (!next) return widget;
      const { x, y, w, h } = widget.layout;
      return next.x === x && next.y === y && next.w === w && next.h === h ? widget : { ...widget, layout: next };
    }));
  }

  function configureWidget(widget: Widget) {
    setConfig(!editing && widget.type === 'quickLinks' && !widget.config.items.length
      ? { ...widget, config: { items: [newResource('web')] } }
      : widget);
  }

  function openConfig(choice: typeof choices[number]) {
    setLibrary(false);
    try {
      const { w, h } = choice.size;
      const layout = firstFreePosition(w, h, widgets.filter((entry) => entry.enabled).map((entry) => entry.layout));
      setConfig(choice.create({ id: crypto.randomUUID(), courseId: course.id, enabled: true, title: choice.label, layout }));
    } catch (failure) {
      setError(message(failure));
    }
  }

  return <div className="course-view">
    <header className="course-header">
      <div className="course-intro">
        <nav aria-label="当前位置" className="course-breadcrumb">
          <a href={routeHref({ page: 'home' })} onClick={(event) => { if (followInCurrentPage(event)) showHome(); }}>首页</a>
          {(course.navigationPath.length ? course.navigationPath : ['课程']).map((name, index) => <span key={index}>{name}</span>)}
        </nav>
        <h1>{course.name}</h1>
        {course.description && <p className="preserve-lines">{course.description}</p>}
      </div>
      {!editing && <div className="row course-actions">
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button ref={managementTrigger} type="button" className="course-management-trigger">
              课程管理<ChevronDown className="tool-icon" aria-hidden="true" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="course-management-actions" align="end" sideOffset={6} collisionPadding={8}
              hideWhenDetached loop onCloseAutoFocus={(event) => {
                if (!editAfterMenu.current) return;
                editAfterMenu.current = false;
                const trigger = managementTrigger.current;
                if (!trigger) return;
                // The native dialog records its opener after the menu releases focus.
                event.preventDefault();
                trigger.focus({ preventScroll: true });
                editCourse();
              }}>
              <DropdownMenu.Item className="course-management-item" disabled={disabled}
                onSelect={() => { editAfterMenu.current = true; }}>
                <Pencil className="tool-icon" aria-hidden="true" />编辑课程
              </DropdownMenu.Item>
              <DropdownMenu.Item className="course-management-item" disabled={!canMoveUp || disabled}
                onSelect={() => shiftCourse(-1)}>
                <ArrowUp className="tool-icon" aria-hidden="true" />课程上移
              </DropdownMenu.Item>
              <DropdownMenu.Item className="course-management-item" disabled={!canMoveDown || disabled}
                onSelect={() => shiftCourse(1)}>
                <ArrowDown className="tool-icon" aria-hidden="true" />课程下移
              </DropdownMenu.Item>
              <DropdownMenu.Item className="course-management-item danger-button" disabled={disabled} onSelect={archive}>
                <Archive className="tool-icon" aria-hidden="true" />归档
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button type="button" ref={editButton} disabled={disabled} className="primary" onClick={() => {
          startLayout();
          requestAnimationFrame(() => addButton.current?.focus({ preventScroll: true }));
        }}>编辑布局</button>
      </div>}
    </header>
    {draft && <section className="layout-toolbar" aria-label="布局编辑工具">
      <div className="layout-toolbar-info">
        <strong>布局编辑</strong>
        <small>{stale ? '课程组件有新版本，当前草稿无法覆盖。' : dirty ? '更改尚未保存' : '拖动卡片标题移动或换位 · Shift + 方向键调整尺寸'}</small>
      </div>
      <div className="row layout-toolbar-actions">
        <button type="button" ref={addButton} disabled={disabled || stale || widgets.length >= 40} onClick={() => setLibrary(true)}>添加组件</button>
        <button type="button" className="quiet-button" disabled={disabled || stale || !draft.history.length} onClick={undoLayout}>撤销</button>
        <button type="button" className="primary" disabled={disabled || stale || !dirty} onClick={async () => {
          setError('');
          try { if (await saveWidgets(widgets)) finish(); }
          catch (failure) { setError(message(failure)); }
        }}>保存布局</button>
        <CourseActionsMenu label="布局选项" disabled={disabled} actions={[
          { label: '恢复默认布局', disabled: stale || !widgets.length, run: () => edit(() => {
            const reset: Widget[] = [];
            for (const widget of widgets) {
              const { w, h } = widgetSize(widget);
              const layout = firstFreePosition(w, h, reset.map((entry) => entry.layout));
              reset.push({ ...widget, layout });
            }
            return reset;
          }) },
          { label: dirty ? '放弃更改' : '退出编辑', run: finish, danger: dirty },
        ]} />
      </div>
    </section>}
    {error && <p role="alert" className="error">{error}</p>}
    <WidgetGrid widgets={widgets} editing={editing} fontSize={fontSize} disabled={disabled || stale} context={editing ? { ...context, disabled: true } : context}
      onLayout={applyPositions} configure={configureWidget}
      savePluginState={(id, state) => saveWidgets(course.widgets.map((entry) => entry.id === id && entry.type === 'plugin'
        ? { ...entry, config: { ...entry.config, state } } : entry))}
      toggle={(widget) => edit(() => {
        const occupied = widgets.filter((entry) => entry.enabled && entry.id !== widget.id).map((entry) => entry.layout);
        const layout = !widget.enabled && occupied.some((entry) => overlaps(entry, widget.layout))
          ? firstFreePosition(widget.layout.w, widget.layout.h, occupied) : widget.layout;
        const next = widgets.map((entry) => entry.id === widget.id ? { ...widget, layout, enabled: !widget.enabled } : entry);
        return widget.enabled ? reflowWidgets(next) : next;
      })}
      remove={(widget) => edit(() => {
        const next = widgets.filter((entry) => entry.id !== widget.id);
        return widget.enabled ? reflowWidgets(next) : next;
      })}
    />
    {library && <WidgetLibrary choices={choices} select={openConfig} close={() => setLibrary(false)} />}
    {config && <WidgetForm key={config.id} initial={config} context={context} close={() => setConfig(undefined)} save={(widget) => {
      const updated = widgets.map((entry) => entry.id === widget.id ? widget : entry);
      if (!editing) return saveWidgets(updated);
      editLayout(updated.some((entry) => entry.id === widget.id) ? updated : [...updated, widget]);
    }} />}
  </div>;
}
