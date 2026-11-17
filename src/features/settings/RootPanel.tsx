import { useId, useRef, useState } from 'react';
import { DEMO_ROOT_ID, rootSchema } from '../../../shared/files.ts';
import type { RootGrant } from '../../../shared/files.ts';
import { ApiError, api, isPagesDemo } from '../../services/api.ts';
import type { LocalResource } from '../../services/actionRouter.tsx';
import { LocalPickerButton } from '../../components/LocalPickerButton.tsx';
import { useFileList } from '../resources/FileLibrary.tsx';

function FolderFiles({ rootId, openFile }: { rootId: string; openFile: (file: LocalResource) => void }) {
  const [search, setSearch] = useState('');
  const { data, error, refresh } = useFileList(rootId, '', 'all', search);
  return <div className="folder-browser">
    <div className="row">
      <input type="search" aria-label="搜索此文件夹" placeholder="搜索文件名" maxLength={120} value={search}
        onChange={(event) => setSearch(event.target.value)} />
      <button type="button" className="quiet-button" onClick={refresh}>刷新</button>
    </div>
    {error ? <p role="alert" className="error">{error}</p> : !data ? <p role="status">正在读取文件列表…</p> : <>
      {data.limited && <p className="muted">文件较多，仅显示扫描范围内的前 500 项。可搜索文件名缩小范围。</p>}
      {data.files.length === 0 ? <p className="muted">没有匹配的 Markdown 或 PDF 文件。</p>
        : <ul className="resources">{data.files.map(({ path, kind }) => <li key={path}>
          <button type="button" className="resource-open" onClick={() => openFile({
            id: 'folder-file', title: path, icon: '', rootId, path, kind,
          })}><span className="resource-title">{path}</span><small className="muted">{kind === 'markdown' ? 'MD' : 'PDF'}</small></button>
        </li>)}</ul>}
    </>}
  </div>;
}

const errors: Record<string, string> = {
  invalid_directory: '选不到这个文件夹。请重新选择电脑里的一个文件夹，例如「文档」里的资料文件夹。',
  root_exists: '这个文件夹编号已经在使用。请选择另一个编号，或从下面的列表检查已有文件夹。',
  reserved_root: '这个编号留给演示资料使用。请留空，让工作台自动编号。',
  too_many_roots: '最多可添加 40 个文件夹。可以先移除一个用不到的文件夹。',
  data_overlap: '这个位置是工作台存放设置的地方。请选择放学习资料的文件夹。',
};

export function RootPanel({ roots, update, loadError, refresh, missing, openFile }: {
  roots: RootGrant[]; update: (roots: RootGrant[]) => void; loadError: string; refresh: () => void;
  missing: { id: string; labels: string[] }[];
  openFile: (file: LocalResource) => void;
}) {
  const editForm = useRef<HTMLFormElement>(null);
  const permissionHint = useId();
  const [label, setLabel] = useState('');
  const [id, setId] = useState('');
  const [directory, setDirectory] = useState('');
  const [reconnect, setReconnect] = useState<string>();
  const [browsing, setBrowsing] = useState<string>();
  const [writable, setWritable] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const automaticName = directory.trim().split(/[\\/]/u).filter(Boolean).at(-1) || '学习资料';
  const existingConnection = roots.find((root) => root.id === reconnect);
  const missingConnection = missing.find((item) => item.id === reconnect);
  const connection = existingConnection
    ? { id: existingConnection.id, labels: [existingConnection.label] }
    : missingConnection;

  function beginReconnect(rootId: string) {
    const root = roots.find((item) => item.id === rootId);
    setReconnect(rootId);
    setDirectory('');
    setLabel(root?.label ?? '');
    setId('');
    setWritable(root?.writable ?? false);
    setError('');
    setFeedback('');
    editForm.current?.querySelector<HTMLButtonElement>('.folder-selection button')?.focus();
  }

  async function perform(method: 'POST' | 'PUT' | 'DELETE', body: unknown, nextFeedback: string) {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      update(await api<RootGrant[]>('/api/roots', method, body));
      setFeedback(nextFeedback);
      return true;
    } catch (failure) {
      const reason = failure instanceof ApiError ? errors[failure.code] : undefined;
      setError(reason ?? (method === 'DELETE' ? '暂时无法移除文件夹，请稍后重试。'
        : method === 'PUT' ? '暂时无法重新连接文件夹，请稍后重试。'
          : '暂时无法添加文件夹。请检查工作台是否仍在运行，再试一次。'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return <div className="form folder-settings">
    {isPagesDemo ? <p className="muted">体验版自带示例笔记和 PDF。添加电脑里的资料请使用本机完整版。</p> : <section className="panel form">
      <h3>添加资料文件夹</h3>
      <p className="muted">选一个电脑里的文件夹，就能在课程和首页打开里面的 PDF 和笔记。</p>
      {loadError && <div><p role="alert" className="error">暂时读不到已添加的文件夹。请重试，再继续添加。</p>
        <button type="button" onClick={refresh}>重新读取文件夹</button></div>}
      <form ref={editForm} className="form" onSubmit={async (event) => {
        event.preventDefault();
        const parsed = rootSchema.safeParse({
          label: label.trim() || automaticName.slice(0, 120),
          id: connection?.id ?? (id.trim() || 'folder-' + crypto.randomUUID()),
          // The folder picker returns the exact path, including valid trailing Unicode spaces.
          directory,
          writable,
        });
        if (!parsed.success) {
          setError(parsed.error.issues[0].path[0] === 'id'
            ? '文件夹编号可以用英文字母、数字、短横线和下划线，也可以留空。'
            : '请先选择电脑上的资料文件夹。');
          return;
        }
        if (await perform(existingConnection ? 'PUT' : 'POST', parsed.data, connection ? '文件夹已重新连接' : '文件夹已添加，可以直接浏览文件')) {
          setBrowsing(parsed.data.id);
          setLabel('');
          setId('');
          setDirectory('');
          setReconnect(undefined);
          setWritable(false);
        }
      }}>
        {connection && <div className="folder-reconnect-note">
          <p>正在重新连接 <strong>{connection.labels[0]}</strong> 使用的文件夹。请选择这些资料现在所在的位置。</p>
          <button type="button" className="quiet-button" onClick={() => setReconnect(undefined)}>取消重新连接</button>
        </div>}
        <div className="folder-selection">
          <LocalPickerButton label="选择文件夹…" request={{ kind: 'root-folder' }} select={(selection) => {
            if (selection.kind === 'path') {
              setDirectory(selection.path);
              setError('');
              setFeedback('');
            }
          }} />
          <span className="muted preserve-lines">{directory || '还没有选择文件夹'}</span>
        </div>
        {directory && <label>显示名称（选填）<input maxLength={120} placeholder={automaticName} value={label}
          onChange={(event) => setLabel(event.target.value)} /></label>}
        <div>
          <label className="check"><input type="checkbox" checked={writable} aria-describedby={permissionHint}
            onChange={(event) => setWritable(event.target.checked)} />允许在工作台内保存笔记更改</label>
          <small className="muted" id={permissionHint}>默认只查看文件。勾选后，在工作台保存笔记会更新电脑上的原文件。</small>
        </div>
        <div className="row"><button type="submit" className="primary" disabled={busy || !!loadError || !directory.trim()}>
          {connection ? '重新连接文件夹' : '添加文件夹'}
        </button></div>
        <details className="settings-details">
          <summary>手动填写和高级选项</summary>
          <div className="form">
            <label>文件夹位置<input maxLength={1800} placeholder={'例如 C:\\Study\\Notes'} value={directory}
              onChange={(event) => setDirectory(event.target.value)} /></label>
            {!connection && <label>文件夹编号（选填）<input maxLength={80} value={id}
              onChange={(event) => setId(event.target.value)} placeholder="留空自动生成" /></label>}
            <small className="muted">从备份恢复后，优先使用下方的「重新连接」，工作台会自动匹配编号。</small>
          </div>
        </details>
        {error && <p role="alert" className="error">{error}</p>}
        {feedback && <p role="status">{feedback}</p>}
      </form>
    </section>}
    {!isPagesDemo && !loadError && missing.length > 0 && <section className="panel">
      <h3>重新连接以前的文件夹</h3>
      <p className="muted">给下面的资料选一个文件夹，原来的课程入口就能继续使用。</p>
      <ul className="plain-list folder-list">{missing.map(({ id, labels }) => <li key={id}>
        <div><strong>{labels[0]}</strong>{labels.length > 1 && <small className="muted">另有 {labels.length - 1} 项也使用这个文件夹</small>}</div>
        <button type="button" disabled={busy} onClick={() => beginReconnect(id)}>重新连接</button>
      </li>)}</ul>
    </section>}
    {roots.length > 0 && <section className="panel">
      <h3>已添加的文件夹</h3>
      <ul className="plain-list folder-list">{roots.map((root) => <li key={root.id}>
        <div>
          <div className="row"><strong>{root.label}</strong><span className="muted">
            {root.writable ? '可查看和保存笔记' : '仅查看'}</span></div>
          <small className="muted preserve-lines">{root.directory}</small>
          {root.id !== DEMO_ROOT_ID && <details className="settings-details folder-number"><summary>查看文件夹编号</summary>
            <code>{root.id}</code>
          </details>}
        </div>
        <div className="row folder-actions">
          <button type="button" className="quiet-button" aria-expanded={browsing === root.id}
            onClick={() => setBrowsing(browsing === root.id ? undefined : root.id)}>{browsing === root.id ? '收起文件' : '浏览文件'}</button>
          {root.id !== DEMO_ROOT_ID && <>
            <button type="button" className="quiet-button" disabled={busy} onClick={() => beginReconnect(root.id)}>重新连接</button>
            <button type="button" className="quiet-button" disabled={busy} onClick={() => {
              if (window.confirm('移除「' + root.label + '」？工作台会停止访问此文件夹，原文件会继续留在电脑里。')) {
                void perform('DELETE', root.id, '文件夹已移除');
              }
            }}>移除</button>
          </>}
        </div>
        {browsing === root.id && <FolderFiles rootId={root.id} openFile={openFile} />}
      </li>)}</ul>
    </section>}
  </div>;
}
