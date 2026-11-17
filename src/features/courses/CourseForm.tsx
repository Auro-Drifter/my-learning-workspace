import { useLayoutEffect, useRef, useState } from 'react';
import { titleSchema } from '../../../shared/actions.ts';
import { emptyCourse, navigationPathSchema } from '../../../shared/workspace.ts';
import type { Course } from '../../../shared/workspace.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { message } from '../../services/api.ts';
import { foldersWithParents } from './courseExplorer.ts';

function folderChoices(paths: string[][]) {
  return foldersWithParents(paths)
    .map((path) => [path.join('/'), path] as const)
    .sort(([first], [second]) => first.localeCompare(second, 'zh-CN'));
}

export function CourseForm({ initial, courses, folders = [], defaultFolder, close, save }: {
  initial?: Course; courses: Course[]; folders?: string[][]; defaultFolder?: string[];
  close: () => void; save: (course: Course) => Promise<boolean>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const nameInput = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { nameInput.current?.focus({ preventScroll: true }); }, []);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [folder, setFolder] = useState(initial?.navigationPath ?? defaultFolder ?? []);
  const folderSelect = useRef<HTMLSelectElement>(null);
  const [newFolders, setNewFolders] = useState<string[][]>([]);
  const [folderName, setFolderName] = useState<string>();
  const [folderError, setFolderError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const choices = folderChoices([...courses.map((course) => course.navigationPath), ...folders, ...newFolders, folder]);
  const canCreate = navigationPathSchema.safeParse([...folder, '目录']).success;

  function createFolder() {
    if (folderName === undefined) return;
    const parsed = navigationPathSchema.safeParse([...folder, folderName]);
    if (!parsed.success) {
      setFolderError(canCreate ? '请输入 1–40 字的目录名，目录名不能包含斜杠。' : '分组最多三层，请先选择上一级目录。');
      return;
    }
    if (!choices.some(([path]) => path === parsed.data.join('/'))) {
      setNewFolders((previous) => [...previous, parsed.data]);
    }
    setFolder(parsed.data);
    closeFolderEditor();
  }

  function closeFolderEditor() {
    setFolderName(undefined);
    setFolderError('');
    folderSelect.current?.focus({ preventScroll: true });
  }

  return <Dialog title={initial ? '编辑课程' : '新建课程'} onClose={() => { if (!busy) close(); }}>
    <form className="form" onSubmit={async (event) => {
      event.preventDefault();
      if (folderName !== undefined || busy) return;
      const result = titleSchema.safeParse(name);
      if (!result.success) return setError(result.error.issues[0].message);
      setBusy(true);
      setError('');
      try {
        const course = initial ?? emptyCourse(crypto.randomUUID(), result.data);
        if (await save({ ...course, name: result.data, description, navigationPath: folder })) close();
        else setError('课程未保存。关闭表单后可查看保存状态。');
      } catch (failure) {
        setError(message(failure));
      } finally {
        setBusy(false);
      }
    }}>
      <label>课程名称<input ref={nameInput} required maxLength={120} value={name} disabled={busy}
        onChange={(event) => setName(event.target.value)} /></label>
      <label>课程简介<textarea maxLength={4000} value={description} disabled={busy}
        onChange={(event) => setDescription(event.target.value)} /></label>
      <div className="course-folder-picker">
        <label>课程分组<select ref={folderSelect} value={folder.join('/')} disabled={busy} onChange={(event) => {
          setFolder(choices.find(([key]) => key === event.target.value)?.[1] ?? []);
          setFolderError('');
        }}>
          <option value="">根目录（不分组）</option>
          {choices.map(([key, path]) => <option key={key} value={key}>{path.join(' / ')}</option>)}
        </select></label>
        {folderName === undefined && <button type="button" disabled={busy || !canCreate} onClick={() => setFolderName('')}
          title={!canCreate ? '最多三层，请先选择上一级目录' : undefined}>新建目录</button>}
      </div>
      {folderName !== undefined && <div className="course-new-folder">
        <label>新目录名称
          <input autoFocus maxLength={40} value={folderName} disabled={busy} onChange={(event) => {
            setFolderName(event.target.value);
            setFolderError('');
          }} onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.key !== 'Enter') return;
            event.preventDefault();
            createFolder();
          }} />
        </label>
        <p className="muted">将在「{folder.join(' / ') || '根目录'}」下创建。</p>
        {folderError && <p role="alert" className="error">{folderError}</p>}
        <div className="row">
          <button type="button" disabled={!canCreate || !folderName.trim()} onClick={createFolder}>创建并选中</button>
          <button type="button" className="quiet-button" onClick={closeFolderEditor}>取消新建</button>
        </div>
      </div>}
      {error && <p role="alert" className="error">{error}</p>}
      <button type="submit" className="primary" disabled={busy || folderName !== undefined}>保存课程</button>
    </form>
  </Dialog>;
}
