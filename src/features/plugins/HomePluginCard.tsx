import { useState } from 'react';
import { Puzzle, Settings2 } from 'lucide-react';
import type { InstalledPlugin, PluginValues } from '../../../shared/plugins.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { message } from '../../services/api.ts';
import { PluginFields, PluginWidget } from './PluginWidget.tsx';

export function HomePluginCard({ plugin, disabled, save }: {
  plugin: InstalledPlugin; disabled: boolean; save: (plugin: InstalledPlugin) => Promise<boolean>;
}) {
  const { manifest, home } = plugin;
  const [settings, setSettings] = useState<PluginValues>();
  const [error, setError] = useState('');
  return <section className="home-card">
    <header className="home-card-header">
      <div className="home-card-heading">
        <span className="home-card-icon"><Puzzle aria-hidden="true" /></span><h2>{manifest.name}</h2>
      </div>
      {!!manifest.fields.length && <button type="button" className="quiet-button home-icon-button" disabled={disabled}
        aria-label={'配置' + manifest.name} title="配置组件"
        onClick={() => { setError(''); setSettings(home.settings); }}><Settings2 className="tool-icon" aria-hidden="true" /></button>}
    </header>
    <div className="home-plugin-body">
      <PluginWidget manifest={manifest} slot={home} disabled={disabled || !!settings}
        saveState={(state) => save({ ...plugin, home: { ...home, state } })} />
    </div>
    {settings && <Dialog title={'配置' + manifest.name} onClose={() => setSettings(undefined)}>
      <form className="form" onSubmit={async (event) => {
        event.preventDefault();
        setError('');
        try {
          if (await save({ ...plugin, home: { ...home, settings } })) setSettings(undefined);
          else setError('保存失败。');
        } catch (failure) {
          setError(message(failure));
        }
      }}>
        <PluginFields manifest={manifest} settings={settings} change={setSettings} />
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={disabled} className="primary">保存配置</button>
      </form>
    </Dialog>}
  </section>;
}
