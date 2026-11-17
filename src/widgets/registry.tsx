import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Resource } from '../../shared/actions.ts';
import type { Widget, WidgetLayout, WidgetType } from '../../shared/workspace.ts';
import { defaultSlot } from '../../shared/plugins.ts';
import type { PluginLibrary } from '../../shared/plugins.ts';
import { ResourceEditor, resourceKinds } from '../features/resources/ResourceEditor.tsx';
import { FileLibrary, rootOptions } from '../features/resources/FileLibrary.tsx';
import { StudyWidget, TasksWidget } from '../features/tasks/StudyWidgets.tsx';
import { ResourceAction } from '../services/actionRouter.tsx';
import type { ActionContext } from '../services/actionRouter.tsx';

type Base = { id: string; courseId: string; enabled: boolean; title: string; layout: WidgetLayout };
type Context = ActionContext;

type Definition = {
  label: string;
  size: { w: number; h: number };
  create: (base: Base) => Widget;
  view: (widget: Widget, context: Context) => ReactNode;
  editor: (widget: Widget, context: Context, change: (next: Widget) => void) => ReactNode;
};

function QuickLinks({ items, context }: { items: Resource[]; context: Context }) {
  const [query, setQuery] = useState('');
  if (!items.length) return <p className="muted">暂无快捷入口。</p>;
  const needle = query.trim().toLocaleLowerCase();
  const matching = items.filter((item) => [item.title, resourceKinds[item.kind], 'path' in item ? item.path : '',
    'url' in item ? item.url : 'file' in item ? item.file : ''].some((value) => value.toLocaleLowerCase().includes(needle)));
  return <>
    {items.length >= 6 && <input type="search" aria-label="搜索快捷入口" placeholder="搜索快捷入口" value={query}
      onChange={(event) => setQuery(event.target.value)} />}
    {matching.length ? <ul className="resources">{matching.map((item) =>
      <li key={item.id}><ResourceAction item={item} context={context} /></li>)}</ul>
      : <p className="muted">未找到匹配的入口。</p>}
  </>;
}

type RegisteredWidget = Exclude<WidgetType, 'plugin'>;
export const widgetRegistry: Record<RegisteredWidget, Definition> = {
  quickLinks: {
    label: '快捷入口',
    size: { w: 6, h: 5 },
    create: (base) => ({ ...base, type: 'quickLinks', config: { items: [] } }),
    view: (widget, context) => widget.type === 'quickLinks' && <QuickLinks items={widget.config.items} context={context} />,
    editor: (widget, context, change) => widget.type === 'quickLinks' && <ResourceEditor
      items={widget.config.items} courses={context.courses} roots={context.roots} updateRoots={context.updateRoots}
      change={(items) => change({ ...widget, config: { items } })} />,
  },
  text: {
    label: '学习备注',
    size: { w: 6, h: 5 },
    create: (base) => ({ ...base, type: 'text', config: { text: '' } }),
    view: (widget) => widget.type === 'text' && <p className="preserve-lines">{widget.config.text || '还没有填写备注。'}</p>,
    editor: (widget, _context, change) => widget.type === 'text' && <label>内容<textarea
      maxLength={8000} value={widget.config.text}
      onChange={(event) => change({ ...widget, config: { text: event.target.value } })} /></label>,
  },
  fileLibrary: {
    label: '文件目录',
    size: { w: 6, h: 5 },
    create: (base) => ({ ...base, type: 'fileLibrary', config: { rootId: '', folder: '', kind: 'all' } }),
    view: (widget, context) => widget.type === 'fileLibrary' && <FileLibrary config={widget.config} context={context} />,
    editor: (widget, context, change) => widget.type === 'fileLibrary' && <>
      <label>资料文件夹<select value={widget.config.rootId} onChange={(event) => change({
        ...widget, config: { ...widget.config, rootId: event.target.value, folder: '' },
      })}>{rootOptions(context.roots, widget.config.rootId)}</select></label>
      <label>子目录（可选）<input placeholder="课程/笔记" maxLength={1600} value={widget.config.folder} onChange={(event) => change({
        ...widget, config: { ...widget.config, folder: event.target.value },
      })} /></label>
      <label>文件类型<select value={widget.config.kind} onChange={(event) => change({
        ...widget, config: { ...widget.config, kind: event.target.value as typeof widget.config.kind },
      })}>
        <option value="all">Markdown 和 PDF</option><option value="markdown">Markdown</option><option value="pdf">PDF</option>
      </select></label>
    </>,
  },
  tasks: {
    label: '作业与任务',
    size: { w: 6, h: 5 },
    create: (base) => ({ ...base, type: 'tasks', config: {} }),
    view: (_widget, context) => <TasksWidget course={context.course} context={context} />,
    editor: () => null,
  },
  study: {
    label: '手动学习进度',
    size: { w: 6, h: 5 },
    create: (base) => ({ ...base, type: 'study', config: {} }),
    view: (_widget, context) => <StudyWidget course={context.course} context={context} />,
    editor: () => null,
  },
};

const extensionSize = { w: 6, h: 5 };

export function widgetSize(widget: Widget) {
  return widget.type === 'plugin' ? extensionSize : widgetRegistry[widget.type].size;
}

export function widgetChoices(library: PluginLibrary) {
  const builtins = (Object.entries(widgetRegistry) as [RegisteredWidget, Definition][])
    .filter(([id]) => !library.disabledBuiltins.includes(id))
    .map(([id, definition]) => ({ ...definition, id }));
  const extensions = library.packages.filter(({ enabled }) => enabled).map(({ manifest }) => ({
    id: 'plugin:' + manifest.id,
    label: manifest.name,
    description: manifest.description,
    size: extensionSize,
    create: (base: Base): Widget => ({ ...base, type: 'plugin', config: { pluginId: manifest.id, ...defaultSlot(manifest) } }),
  }));
  return [...builtins, ...extensions];
}
