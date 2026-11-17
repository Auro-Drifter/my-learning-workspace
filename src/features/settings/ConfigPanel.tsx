import { useId, useRef, useState } from 'react';
import type { Appearance } from '../../../shared/appearance.ts';
import { AppearancePanel } from './AppearancePanel.tsx';
import { PluginPanel } from '../plugins/PluginPanel.tsx';
import { MAX_CONFIG_BYTES, workspaceSchema } from '../../../shared/workspace.ts';
import type { Workspace } from '../../../shared/workspace.ts';
import { Dialog } from '../../components/Dialog.tsx';
import type { LocalResource } from '../../services/actionRouter.tsx';
import type { RootGrant } from '../../../shared/files.ts';
import { RootPanel } from './RootPanel.tsx';
import { downloadJson } from '../../services/downloadJson.ts';
import { isPagesDemo } from '../../services/api.ts';
import { foldersToReconnect } from './folderReferences.ts';

export function exportConfig(workspace: Workspace) {
  downloadJson('learning-workspace.json', workspace);
}

const sections = { appearance: '外观', plugins: '插件', roots: '资料文件夹', backup: '备份与恢复' } as const;
export type SettingsSection = keyof typeof sections;
const sectionKeys = Object.keys(sections) as SettingsSection[];

export function ConfigPanel({ workspace, disabled, close, restore, roots, rootsError, refreshRoots, updateRoots, openFile, previewAppearance, initialSection, onImported }: {
  workspace: Workspace; disabled: boolean; close: () => void; restore: (workspace: Workspace) => Promise<boolean>;
  roots: RootGrant[]; rootsError: string; refreshRoots: () => void; updateRoots: (roots: RootGrant[]) => void;
  openFile: (file: LocalResource) => void;
  previewAppearance: (value: Appearance | undefined) => void;
  initialSection: SettingsSection;
  onImported: (workspace: Workspace) => void;
}) {
  const id = useId();
  const fileRead = useRef(0);
  const [section, setSection] = useState(initialSection);
  const [candidate, setCandidate] = useState<Workspace>();
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  function selectSection(next: SettingsSection) {
    if (next === section) return;
    fileRead.current++;
    setSection(next);
    setCandidate(undefined);
    setFileName('');
    setError('');
  }

  return <Dialog title="设置" onClose={close} className="settings-dialog">
    <div className="settings-nav" role="tablist" aria-label="设置分类">
      {sectionKeys.map((key, index) => <button type="button" key={key} className="quiet-button" role="tab"
        id={id + '-tab-' + key} aria-controls={id + '-panel-' + key} aria-selected={section === key}
        tabIndex={section === key ? 0 : -1} onClick={() => selectSection(key)}
        onKeyDown={(event) => {
          const last = sectionKeys.length - 1;
          let next: number;
          switch (event.key) {
            case 'ArrowLeft': next = index === 0 ? last : index - 1; break;
            case 'ArrowRight': next = index === last ? 0 : index + 1; break;
            case 'Home': next = 0; break;
            case 'End': next = last; break;
            default: return;
          }
          event.preventDefault();
          selectSection(sectionKeys[next]);
          document.getElementById(id + '-tab-' + sectionKeys[next])?.focus();
        }}>{sections[key]}</button>)}
    </div>
    {sectionKeys.map((key) => <div key={key} className="settings-content" role="tabpanel"
      id={id + '-panel-' + key} aria-labelledby={id + '-tab-' + key} hidden={key !== section} tabIndex={0}>
      {key === section && <div className="section-enter">
        {section === 'appearance' && <AppearancePanel value={workspace.appearance} disabled={disabled} preview={previewAppearance}
          save={(appearance) => restore({ ...workspace, appearance })} />}
        {section === 'plugins' && (isPagesDemo
          ? <p className="muted">自定义插件请在本机完整版中使用。</p>
          : <PluginPanel library={workspace.plugins} disabled={disabled} save={(plugins) => restore({ ...workspace, plugins })} />)}
        {section === 'roots' && <RootPanel roots={roots} loadError={rootsError} refresh={refreshRoots} update={updateRoots}
          openFile={openFile} missing={foldersToReconnect(workspace, roots)} />}
        {section === 'backup' && <div className="form">
          <section className="panel">
            <h3>保存一份备份</h3>
            <p className="muted">备份会记录课程、组件、任务和外观。电脑上的笔记和 PDF 请另外复制保存。</p>
            <button type="button" onClick={() => exportConfig(workspace)}>下载备份</button>
          </section>
          <section className="panel form">
            <h3>从备份恢复</h3>
            <p className="muted">选择以前从本工作台下载的备份。恢复后，可以在「资料文件夹」重新连接电脑上的原文件。</p>
            <label>选择备份文件<input type="file" disabled={disabled} accept=".json,application/json" onChange={async (event) => {
              const request = ++fileRead.current;
              const file = event.target.files?.[0];
              setCandidate(undefined);
              setFileName('');
              setError('');
              if (!file) return;
              if (file.size > MAX_CONFIG_BYTES) {
                setError('这份文件太大。请选一份从本工作台下载的备份。');
                return;
              }
              try {
                const parsed = workspaceSchema.safeParse(JSON.parse((await file.text()).replace(/^\uFEFF/u, '')));
                if (request !== fileRead.current) return;
                if (parsed.success) {
                  setCandidate(parsed.data);
                  setFileName(file.name);
                } else setError('无法识别这份备份。请试试本工作台下载的另一份备份。');
              } catch {
                if (request === fileRead.current) setError('打不开这份备份。请试试另一份备份文件。');
              }
            }} /></label>
            {candidate && <>
              <p><strong>{fileName}</strong> · {candidate.courses.length} 门课程</p>
              <button type="button" disabled={disabled} onClick={async () => {
                if (!window.confirm('用这份备份恢复工作台？它会替换现在的课程、任务、布局和外观。若想保留现在的设置，请先下载备份。')) return;
                if (await restore(candidate)) {
                  onImported(candidate);
                  close();
                } else setError('未能恢复。请关闭设置，查看工作台顶部的提示。');
              }}>用这份备份恢复</button>
            </>}
            {error && <p className="error" role="alert">{error}</p>}
          </section>
        </div>}
      </div>}
    </div>)}
  </Dialog>;
}
