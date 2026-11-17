import ReactGridLayout, { useContainerWidth } from 'react-grid-layout';
import { getCompactor } from 'react-grid-layout/core';
import type { Layout } from 'react-grid-layout';
import { ChartNoAxesColumnIncreasing, FileText, GripVertical, Link2, ListTodo, NotebookPen, Plus, Puzzle } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { GRID_COLUMNS, MAX_LAYOUT_ROWS, overlaps } from '../../shared/workspace.ts';
import type { Widget } from '../../shared/workspace.ts';
import type { PluginValues } from '../../shared/plugins.ts';
import { CourseActionsMenu } from '../components/CourseActionsMenu.tsx';
import { PluginWidget } from '../features/plugins/PluginWidget.tsx';
import type { ActionContext } from '../services/actionRouter.tsx';
import { widgetRegistry } from './registry.tsx';
import { moveWidget } from './moveWidget.ts';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const fixedGrid = getCompactor(null, false, true);
const dragGrid = getCompactor(null, true);
const widgetIcons = { quickLinks: Link2, text: NotebookPen, fileLibrary: FileText,
  tasks: ListTodo, study: ChartNoAxesColumnIncreasing, plugin: Puzzle } as const;

function WidgetContent({ widget, context, save }: {
  widget: Widget; context: ActionContext; save: (state: PluginValues) => Promise<boolean>;
}) {
  if (widget.type !== 'plugin') {
    if (context.plugins.disabledBuiltins.includes(widget.type)) return <p className="muted">此组件的插件已停用。</p>;
    return widgetRegistry[widget.type].view(widget, context);
  }
  const pluginId = widget.config.pluginId;
  const found = context.plugins.packages.find(({ manifest }) => manifest.id === pluginId);
  if (!found || !found.enabled) return <p className="muted">插件 {pluginId} 尚未安装或已停用。</p>;
  return <PluginWidget manifest={found.manifest} slot={widget.config} disabled={context.disabled} saveState={save} />;
}

export function WidgetGrid({ widgets, editing, disabled, fontSize, context, onLayout, configure, toggle, remove, savePluginState }: {
  widgets: Widget[];
  editing: boolean;
  disabled: boolean;
  fontSize: number;
  context: ActionContext;
  onLayout: (layout: Layout) => void;
  configure: (widget: Widget) => void;
  toggle: (widget: Widget) => void;
  remove: (widget: Widget) => void;
  savePluginState: (id: string, state: PluginValues) => Promise<boolean>;
}) {
  const { width, containerRef, mounted, measureWidth } = useContainerWidth({ measureBeforeMount: true });
  useLayoutEffect(() => { if (!mounted) measureWidth(); }, [mounted, measureWidth]);
  const drag = useRef<{ layout: Layout; id: string }>(undefined);
  const [dragging, setDragging] = useState(false);
  const pointer = useRef<{ id: string; offsetX: number; offsetY: number }>(undefined);
  const dragCompactor = useMemo(() => ({
    ...dragGrid,
    compact: (items: Layout, cols: number) => {
      const session = drag.current;
      const moving = items.find((item) => item.i === session?.id);
      const arranged = session && moving ? moveWidget(session.layout, moving.i, moving.x, moving.y) : items;
      return dragGrid.compact(arranged, cols);
    },
  }), []);
  const visible = widgets.filter((widget) => widget.enabled);
  const hidden = widgets.filter((widget) => !widget.enabled);
  const narrow = width < 640;
  const compactGrid = width >= 900;
  const layout = visible.map(({ id, layout }) => ({ i: id, ...layout, minW: 2, minH: 2, maxH: 24 }));
  function keyboardAdjust(event: KeyboardEvent<HTMLElement>, widget: Widget) {
    if (!editing || disabled || event.target !== event.currentTarget) return;
    const shifts: Record<string, [number, number]> = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    };
    const shift = shifts[event.key];
    if (!shift) return;
    event.preventDefault();
    const [dx, dy] = shift;
    const { x, y, w, h } = widget.layout;
    if (!event.shiftKey) {
      const arranged = moveWidget(layout, widget.id, x + dx, y + dy, 0);
      if (arranged !== layout) onLayout(arranged);
      return;
    }
    const next = { x, y, w: w + dx, h: h + dy };
    if (next.x < 0 || next.y < 0 || next.w < 2 || next.h < 2 || next.h > 24
      || next.x + next.w > GRID_COLUMNS || next.y + next.h > MAX_LAYOUT_ROWS
      || visible.some((entry) => entry.id !== widget.id && overlaps(entry.layout, next))) return;
    onLayout(layout.map((item) => item.i === widget.id ? { ...item, ...next } : item));
  }

  const entries = [...visible].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x).map((widget) => {
    const Icon = widgetIcons[widget.type];
    const resourceAction = widget.type === 'quickLinks'
      ? (widget.config.items.length ? '编辑入口' : '添加入口')
      : widget.type === 'fileLibrary' ? '配置目录' : undefined;
    return (
      <article key={widget.id} className="widget" data-widget-id={widget.id} data-widget-type={widget.type}>
        <header className={'widget-header' + (editing && !narrow && !disabled ? ' drag-handle' : '')}
          tabIndex={editing && !disabled ? 0 : undefined} onKeyDown={(event) => keyboardAdjust(event, widget)}
          onPointerDownCapture={(event) => {
            if (!editing || disabled || event.pointerType !== 'mouse' || event.button !== 0) return;
            const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
            if (bounds) pointer.current = { id: widget.id, offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top };
          }}>
          <h3>{editing && !narrow ? <GripVertical className="tool-icon widget-grip" aria-hidden="true" />
            : <Icon className="tool-icon widget-type-icon" aria-hidden="true" />}{widget.title}</h3>
          {!editing && resourceAction && widget.type !== 'plugin' && !context.plugins.disabledBuiltins.includes(widget.type)
            && <button type="button" className="quiet-button widget-content-action" disabled={disabled} onClick={() => configure(widget)}>
              {resourceAction === '添加入口' && <Plus className="tool-icon" aria-hidden="true" />}{resourceAction}
            </button>}
          {editing && <div className="widget-controls">
            <button type="button" className="quiet-button" disabled={disabled} onClick={() => configure(widget)}>配置</button>
            <CourseActionsMenu label={widget.title + '的更多操作'} disabled={disabled} actions={[
              { label: '隐藏', run: () => toggle(widget) },
              { label: '移除', run: () => remove(widget), danger: true },
            ]} />
          </div>}
        </header>
        <div className="widget-content" inert={editing}><WidgetContent widget={widget} context={context}
          save={(value) => savePluginState(widget.id, value)} /></div>
      </article>
    );
  });
  return <div ref={containerRef} className="grid-host">
    {visible.length === 0 && <p className="empty">此课程暂无可见组件。使用「编辑布局」添加组件。</p>}
    {mounted && narrow && <div className="stack">
      {editing && <p className="muted layout-narrow-hint">窄窗口使用单列预览。可用键盘调整位置，或扩大窗口拖动。</p>}
      {entries}
    </div>}
    {mounted && !narrow && visible.length > 0 && <ReactGridLayout
      width={width}
      layout={layout}
      gridConfig={{ cols: GRID_COLUMNS, rowHeight: compactGrid ? Math.max(30, fontSize * 2) : 40, margin: compactGrid ? [14, 14] : [12, 12], containerPadding: [0, 0], maxRows: MAX_LAYOUT_ROWS }}
      compactor={dragging ? dragCompactor : fixedGrid}
      dragConfig={{ enabled: editing && !disabled, threshold: 6, handle: '.drag-handle', cancel: 'button, a, input, textarea, select' }}
      resizeConfig={{ enabled: editing && !disabled, handles: ['se'] }}
      onDragStart={(items, _original, item) => {
        if (!item) return;
        drag.current = { layout: items.map((entry) => ({ ...entry })), id: item.i };
        setDragging(true);
      }}
      onDrag={(_items, _original, item, _placeholder, event, node) => {
        const grip = pointer.current;
        if (!grip || grip.id !== item?.i || !(event instanceof MouseEvent) || !node?.offsetParent) return;
        const grid = node.offsetParent.getBoundingClientRect();
        // The grid owns drop coordinates. Keep the preview moving even when its snapped cell is unchanged.
        node.style.setProperty('--pointer-x', (event.clientX - grid.left - grip.offsetX) + 'px');
        node.style.setProperty('--pointer-y', (event.clientY - grid.top - grip.offsetY) + 'px');
        node.dataset.pointerDrag = '';
      }}
      onDragStop={(items, _original, _item, _placeholder, _event, node) => {
        if (node) {
          delete node.dataset.pointerDrag;
          node.style.removeProperty('--pointer-x');
          node.style.removeProperty('--pointer-y');
        }
        pointer.current = undefined;
        drag.current = undefined;
        setDragging(false);
        onLayout(items);
      }}
      onResizeStop={onLayout}
    >{entries}</ReactGridLayout>}
    {editing && hidden.length > 0 && <section className="panel">
      <h3>隐藏的组件</h3>
      <ul className="plain-list">{hidden.map((widget) => <li className="row" key={widget.id}>
        <span>{widget.title}</span>
        <div className="widget-controls">
          <button type="button" disabled={disabled} onClick={() => toggle(widget)}>显示</button>
          <CourseActionsMenu label={widget.title + '的更多操作'} disabled={disabled} actions={[
            { label: '配置', run: () => configure(widget) },
            { label: '移除', run: () => remove(widget), danger: true },
          ]} />
        </div>
      </li>)}</ul>
    </section>}
  </div>;
}
