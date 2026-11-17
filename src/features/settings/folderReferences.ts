import { DEMO_ROOT_ID } from '../../../shared/files.ts';
import type { RootGrant } from '../../../shared/files.ts';
import type { Resource } from '../../../shared/actions.ts';
import type { Workspace } from '../../../shared/workspace.ts';

export function foldersToReconnect(workspace: Workspace, connected: RootGrant[]) {
  const available = new Set([DEMO_ROOT_ID, ...connected.map(({ id }) => id)]);
  const missing = new Map<string, Set<string>>();

  function record(rootId: string | undefined, label: string) {
    if (!rootId || available.has(rootId)) return;
    const labels = missing.get(rootId) ?? new Set<string>();
    labels.add(label);
    missing.set(rootId, labels);
  }

  function shortcuts(items: Resource[], scope: string) {
    for (const item of items) {
      if (item.kind === 'markdown' || item.kind === 'pdf') record(item.rootId, scope + ' · ' + item.path);
    }
  }

  for (const course of workspace.courses) {
    for (const widget of course.widgets) {
      if (widget.type === 'fileLibrary') record(widget.config.rootId, course.name + ' · ' + (widget.config.folder || widget.title));
      if (widget.type === 'quickLinks') shortcuts(widget.config.items, course.name);
    }
  }
  const widgets = workspace.home.widgets;
  if (widgets) {
    shortcuts(widgets.shortcuts ?? [], '首页');
    for (const item of [widgets.recent, widgets.stats, widgets.onthisday]) {
      if (item) record(item.rootId, '首页 · ' + (item.folder || '笔记组件'));
    }
    for (const item of [widgets.note?.location, widgets.quote?.note]) {
      if (item) record(item.rootId, '首页 · ' + item.path);
    }
    for (const item of [widgets.duowei, widgets.annotations, widgets.wechat]) {
      if (item) record(item.rootId, '首页 · ' + item.source);
    }
  }
  return [...missing].map(([id, labels]) => ({ id, labels: [...labels] }));
}
