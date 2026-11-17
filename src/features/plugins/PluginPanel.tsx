import { useState } from 'react';
import { builtinPlugins, installPlugin, pluginPackageSchema } from '../../../shared/plugins.ts';
import type { BuiltinPlugin, InstalledPlugin, PluginLibrary, PluginPackage } from '../../../shared/plugins.ts';
import { message } from '../../services/api.ts';
import { downloadJson } from '../../services/downloadJson.ts';
import { bundledPlugins } from './bundled.ts';

export function PluginPanel({ library, disabled, save }: {
  library: PluginLibrary; disabled: boolean; save: (next: PluginLibrary) => Promise<boolean>;
}) {
  const [candidate, setCandidate] = useState<PluginPackage>();
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function apply(next: PluginLibrary, status: string) {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      if (!await save(next)) {
        setError('插件设置保存失败。');
        return false;
      }
      setFeedback(status);
      return true;
    } catch (failure) {
      setError(message(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const blocked = disabled || busy;
  const entry = candidate && library.packages.find(({ manifest }) => manifest.id === candidate.id);
  function updatePackage(plugin: InstalledPlugin, status: string) {
    return apply({ ...library, packages: library.packages.map((item) => item.manifest.id === plugin.manifest.id ? plugin : item) }, status);
  }

  return <div className="form plugin-panel">
    {error && <p className="error" role="alert">{error}</p>}
    {feedback && <p className="muted" role="status">{feedback}</p>}

    <section className="panel">
      <h3>可以安装的插件</h3>
      <p className="muted">插件会给工作台增加新功能。例如，安装学习计数器后，可以把它放在首页。</p>
      <ul className="plain-list plugin-entries">{bundledPlugins.map((manifest) => {
        const alreadyInstalled = library.packages.some((item) => item.manifest.id === manifest.id);
        return <li key={manifest.id}>
          <div><strong>{manifest.name}</strong><p className="muted">{manifest.description}</p></div>
          <div className="row">
            <button type="button" disabled={blocked || alreadyInstalled || library.packages.length >= 16}
              onClick={() => void apply({ ...library, packages: [...library.packages, installPlugin(manifest)] }, '插件已安装')}>
              {alreadyInstalled ? '已安装' : '安装 ' + manifest.name}
            </button>
            <button type="button" className="quiet-button" onClick={() => downloadJson(manifest.id + '.mlw-plugin.json', manifest)}>下载插件文件</button>
          </div>
        </li>;
      })}</ul>
    </section>

    <section className="panel">
      <h3>已安装的插件</h3>
      {library.packages.length === 0 && <p className="muted">安装后的插件会出现在这里。</p>}
      <ul className="plain-list plugin-entries">{library.packages.map((plugin) => <li key={plugin.manifest.id}>
        <div><strong>{plugin.manifest.name}</strong> <small className="muted">版本 {plugin.manifest.version}</small></div>
        <div className="row">
          <label className="check"><input type="checkbox" checked={plugin.enabled} disabled={blocked} onChange={(event) => {
            void updatePackage({ ...plugin, enabled: event.target.checked }, '插件状态已保存');
          }} />启用</label>
          <button type="button" disabled={blocked || !plugin.enabled} onClick={() => {
            void updatePackage({ ...plugin, showOnHome: !plugin.showOnHome }, '首页配置已保存');
          }}>{plugin.showOnHome ? '移出首页' : '添加到首页'}</button>
          <button type="button" disabled={blocked} className="danger-button" onClick={() => {
            if (window.confirm('卸载「' + plugin.manifest.name + '」？它在首页的卡片和记录会被移除。以后重新安装这个插件，可以继续使用课程里的卡片。')) {
              void apply({ ...library, packages: library.packages.filter((item) => item !== plugin) }, '插件已卸载');
            }
          }}>卸载</button>
        </div>
      </li>)}</ul>
    </section>

    <section className="panel">
      <h3>自带功能</h3>
      <p className="muted">取消勾选会在整个工作台停用这项功能。只想调整首页时，请用首页的「编辑首页」。</p>
      <div className="builtin-plugin-list">
        {Object.entries(builtinPlugins).map(([id, name]) => {
          const key = id as BuiltinPlugin;
          return <label className="check" key={id}><input type="checkbox" disabled={blocked}
            checked={!library.disabledBuiltins.includes(key)} onChange={(event) => {
              const disabledBuiltins = event.target.checked ? library.disabledBuiltins.filter((item) => item !== key) : [...library.disabledBuiltins, key];
              void apply({ ...library, disabledBuiltins }, '插件状态已保存');
            }} />{name}</label>;
        })}
      </div>
    </section>
    <details className="panel settings-details">
      <summary>从本机安装插件</summary>
      <div className="form">
        <p className="muted">手上已有工作台插件文件时，在这里选择文件，再点「安装插件」。</p>
        <label>选择插件文件<input type="file" accept=".json,application/json" disabled={blocked} onChange={async (event) => {
          const file = event.target.files?.[0];
          setCandidate(undefined);
          setFeedback('');
          setError('');
          if (!file) return;
          try {
            if (file.size > 160_000) throw new Error('这个插件文件太大，无法安装。');
            const parsed = pluginPackageSchema.safeParse(JSON.parse((await file.text()).replace(/^\uFEFF/u, '')));
            if (!parsed.success) throw new Error('这个文件不是工作台能安装的插件。');
            setCandidate(parsed.data);
          } catch (failure) {
            setError(failure instanceof SyntaxError ? '打不开这个插件文件。请选择工作台的插件文件。' : message(failure));
          }
        }} /></label>
        {candidate && <div>
          <strong>{candidate.name}</strong> <small className="muted">版本 {candidate.version}</small>
          {candidate.description && <p>{candidate.description}</p>}
          <button type="button" className="primary" disabled={blocked || (!entry && library.packages.length >= 16)} onClick={async () => {
            const ok = entry ? await updatePackage({ ...entry, manifest: candidate }, '插件已替换')
              : await apply({ ...library, packages: [...library.packages, installPlugin(candidate)] }, '插件已安装');
            if (ok) setCandidate(undefined);
          }}>{entry ? '更新已安装的插件' : '安装插件'}</button>
        </div>}
      </div>
    </details>
  </div>;
}
