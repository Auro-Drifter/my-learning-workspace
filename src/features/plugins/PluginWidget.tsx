import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PluginPackage, PluginResult, PluginSlot, PluginValues } from '../../../shared/plugins.ts';
import { message } from '../../services/api.ts';
import { runPlugin } from './runPlugin.ts';

function valuesFor(manifest: PluginPackage, current: PluginValues) {
  return Object.fromEntries(manifest.fields.map((field) => {
    const value = current[field.key];
    return [field.key, typeof value === typeof field.default ? value : field.default];
  }));
}

export function PluginFields({ manifest, settings, change }: {
  manifest: PluginPackage; settings: PluginValues; change: (values: PluginValues) => void;
}) {
  const values = valuesFor(manifest, settings);
  return <>{manifest.fields.map((field) => field.kind === 'checkbox'
    ? <label className="check" key={field.key}><input type="checkbox" checked={Boolean(values[field.key])}
      onChange={(event) => change({ ...values, [field.key]: event.target.checked })} />{field.label}</label>
    : <label key={field.key}>{field.label}<input type={field.kind} maxLength={500}
      min={field.kind === 'number' ? -1e9 : undefined} max={field.kind === 'number' ? 1e9 : undefined}
      step={field.kind === 'number' ? 'any' : undefined}
      value={String(values[field.key])} onChange={(event) => {
        const value = field.kind === 'number' ? (Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0) : event.target.value;
        change({ ...values, [field.key]: value });
      }} /></label>)}</>;
}

export function PluginWidget({ manifest, slot, disabled, saveState }: {
  manifest: PluginPackage; slot: PluginSlot; disabled: boolean;
  saveState: (state: PluginValues) => Promise<boolean>;
}) {
  const [view, setView] = useState<PluginResult['view']>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const data = JSON.stringify({ settings: valuesFor(manifest, slot.settings), state: slot.state });
  const latest = useRef<{ data: string; code: string; disabled: boolean; saveState: typeof saveState } | undefined>(undefined);
  useLayoutEffect(() => {
    latest.current = { data, code: manifest.code, disabled, saveState };
    return () => { latest.current = undefined; };
  }, [data, manifest.code, disabled, saveState]);
  useEffect(() => {
    let disposed = false;
    setError('');
    void runPlugin(manifest.code, JSON.parse(data) as PluginSlot, null)
      .then(({ view }) => { if (!disposed) setView(view); })
      .catch((failure) => { if (!disposed) setError(message(failure)); });
    return () => { disposed = true; };
  }, [manifest.code, data]);

  async function invoke(id: string) {
    setBusy(true);
    setError('');
    try {
      const next = await runPlugin(manifest.code, JSON.parse(data) as PluginSlot, id);
      const active = latest.current;
      if (!active || active.disabled || active.data !== data || active.code !== manifest.code) return;
      if (next.state && JSON.stringify(next.state) !== JSON.stringify(slot.state) && !await active.saveState(next.state)) {
        setError('插件状态保存失败。');
        return;
      }
      setView(next.view);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  return <div className="plugin-widget">
    {error && <p className="error" role="alert">{error}</p>}
    {!view && !error && <p role="status" className="muted">正在加载插件…</p>}
    {view?.map((node, index) => {
      if (node.kind === 'text') return <p className="preserve-lines" key={index}>{node.text}</p>;
      if (node.kind === 'metric') return <div className="plugin-metric" key={index}>
        <strong>{node.value}</strong><small className="muted">{node.label}</small>
      </div>;
      return <button type="button" disabled={busy || disabled} key={index} onClick={() => void invoke(node.id)}>{node.label}</button>;
    })}
  </div>;
}
