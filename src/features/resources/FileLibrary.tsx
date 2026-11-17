import { useEffect, useId, useState } from 'react';
import type { FileListing, LibraryQuery, RootGrant } from '../../../shared/files.ts';
import type { Resource } from '../../../shared/actions.ts';
import { api, message } from '../../services/api.ts';
import { LocalPickerButton } from '../../components/LocalPickerButton.tsx';
import { ResourceAction } from '../../services/actionRouter.tsx';
import type { ActionContext } from '../../services/actionRouter.tsx';

export function rootOptions(roots: RootGrant[], current: string) {
  return <>
    <option value="">选择资料文件夹</option>
    {current && !roots.some((root) => root.id === current) && <option value={current}>以前的文件夹（待重新连接）</option>}
    {roots.map((root) => <option key={root.id} value={root.id}>{root.label}</option>)}
  </>;
}

export function useFileList(rootId: string, folder: string, kind: LibraryQuery['kind'], search: string, metadata = false) {
  const [data, setData] = useState<FileListing>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    setData(undefined);
    setError('');
    if (!rootId) return;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ rootId, folder, kind, search });
      if (metadata) params.set('metadata', '1');
      void api<FileListing>('/api/files?' + params).then(
        (value) => { if (!disposed) setData(value); },
        (failure) => { if (!disposed) setError(message(failure)); },
      );
    }, 150);
    return () => { disposed = true; clearTimeout(timer); };
  }, [rootId, folder, kind, search, metadata, attempt]);
  return { data, error, refresh: () => setAttempt((number) => number + 1) };
}

export function FilePicker({ item, roots, updateRoots, update }: {
  item: Extract<Resource, { kind: 'pdf' | 'markdown' }>;
  roots: RootGrant[];
  updateRoots: (roots: RootGrant[]) => void;
  update: (item: Resource) => void;
}) {
  const suggestions = useId();
  const { data } = useFileList(roots.some((root) => root.id === item.rootId) ? item.rootId : '', '', item.kind, '');
  return <>
    <small className="muted">点「浏览文件…」选择电脑上的文件，工作台会填好下面两项。</small>
    <label>资料文件夹<select required value={item.rootId}
      onChange={(event) => update({ ...item, rootId: event.target.value, path: '' })}>
      {rootOptions(roots, item.rootId)}
    </select></label>
    <div className="path-picker">
      <label>文件位置<input required maxLength={1600} list={suggestions} value={item.path} placeholder={'资料/文件.' + (item.kind === 'markdown' ? 'md' : 'pdf')}
        onChange={(event) => update({ ...item, path: event.target.value })} /></label>
      <LocalPickerButton key={item.kind} label="浏览文件…" request={{
        kind: item.kind, rootId: roots.some((root) => root.id === item.rootId) ? item.rootId : undefined,
      }} select={(selection) => {
        if (selection.kind === 'document') {
          updateRoots(selection.roots);
          update({ ...item, ...selection.location });
        }
      }} />
    </div>
    <datalist id={suggestions}>{data?.files.map(({ path }) => <option key={path} value={path} />)}</datalist>
  </>;
}

export function FileLibrary({ config, context }: {
  config: Pick<LibraryQuery, 'rootId' | 'folder' | 'kind'>; context: ActionContext;
}) {
  const [search, setSearch] = useState('');
  const { data, error, refresh } = useFileList(config.rootId, config.folder, config.kind, search);
  if (!config.rootId) return <p className="muted">请在组件设置中选择资料文件夹。</p>;
  return <div>
    <div className="row">
      <input className="file-search" type="search" aria-label="搜索文件名" placeholder="搜索文件名"
        value={search} maxLength={120} onChange={(event) => setSearch(event.target.value)} />
      <button type="button" onClick={refresh}>刷新文件列表</button>
    </div>
    {error ? <p className="error" role="alert">{error}</p> : data ? <>
      {data.limited && <p className="muted">文件较多，只显示一部分。可以搜索文件名，或在组件设置中缩小文件夹范围。</p>}
      {data.files.length === 0 && <p className="muted">没有匹配的 Markdown 或 PDF 文件。</p>}
      <ul className="resources">{data.files.map(({ path, kind }) => <li key={path}>
        <ResourceAction item={{ id: 'directory-file', title: path, icon: '', rootId: config.rootId, path, kind }}
          context={context} />
      </li>)}</ul>
    </> : <p role="status">正在读取文件列表…</p>}
  </div>;
}
