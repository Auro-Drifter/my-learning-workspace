import { useState } from 'react';
import { widgetSchema } from '../../shared/workspace.ts';
import type { Widget } from '../../shared/workspace.ts';
import { Dialog } from '../components/Dialog.tsx';
import { message } from '../services/api.ts';
import type { ActionContext } from '../services/actionRouter.tsx';
import { widgetRegistry } from './registry.tsx';
import { PluginFields } from '../features/plugins/PluginWidget.tsx';

export function WidgetForm({ initial, save, close, context }: {
  initial: Widget; save: (widget: Widget) => void | Promise<boolean>; close: () => void; context: ActionContext;
}) {
  const [draft, setDraft] = useState(initial);

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pluginId = draft.type === 'plugin' ? draft.config.pluginId : undefined;
  const plugin = context.plugins.packages.find(({ manifest }) => manifest.id === pluginId)?.manifest;
  const label = draft.type === 'plugin' ? plugin?.name ?? '插件组件' : widgetRegistry[draft.type].label;
  return <Dialog title={'配置' + label} onClose={() => { if (!saving) close(); }} className="widget-dialog">
    <form className="form" onSubmit={async (event) => {
      event.preventDefault();
      if (saving) return;
      setError('');
      const parsed = widgetSchema.safeParse(draft);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        setError(issue.message);
        return;
      }
      setSaving(true);
      try {
        if (await save(parsed.data) === false) setError('未能保存。关闭后可在工作台查看保存状态。');
        else close();
      } catch (failure) {
        setError(message(failure));
      } finally {
        setSaving(false);
      }
    }}>
      <div className="form" inert={saving}>
        <label>组件标题<input required maxLength={120} value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        {draft.type === 'plugin' ? plugin ? <PluginFields manifest={plugin} settings={draft.config.settings}
          change={(settings) => setDraft({ ...draft, config: { ...draft.config, settings } })} />
          : <p className="muted">请先安装相同 ID 的插件包。</p> : widgetRegistry[draft.type].editor(draft, context, setDraft)}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={saving}>{saving ? '正在保存…' : '保存组件'}</button>
    </form>
  </Dialog>;
}
