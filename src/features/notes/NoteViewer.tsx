import { useEffect, useRef, useState } from 'react';
import { basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import Preview from './MarkdownPreview.tsx';
import type { FileLocation } from '../../../shared/actions.ts';
import type { NoteDocument } from '../../../shared/files.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { ApiError, message } from '../../services/api.ts';
import { loadNote, saveNote } from '../../services/fileApi.ts';
import { useBeforeUnloadWarning } from '../../services/useBeforeUnloadWarning.ts';
import { applyEditorChanges } from './editorText.ts';

function NoteEditor({ initial, writable, update }: {
  initial: string; writable: boolean; update: (text: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    let raw = initial;
    const view = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
          basicSetup,
          markdown(),
          EditorView.lineWrapping,
          EditorState.readOnly.of(!writable),
          EditorView.editable.of(writable),
          EditorView.contentAttributes.of({ 'aria-label': 'Markdown 原文', spellcheck: 'false' }),
          EditorView.updateListener.of((transaction) => {
            if (!transaction.docChanged) return;
            raw = applyEditorChanges(raw, transaction.changes);
            update(raw);
          }),
        ],
      }),
    });
    return () => view.destroy();
  }, [initial, writable, update]);
  return <div className="note-editor" ref={container} />;
}

function ConflictView({ draft, disk }: { draft: string; disk: string }) {
  const draftLines = draft.split(/\r\n|\n|\r/u);
  const diskLines = disk.split(/\r\n|\n|\r/u);
  let start = 0;
  const commonLength = Math.min(draftLines.length, diskLines.length);
  while (start < commonLength && draftLines[start] === diskLines[start]) start++;
  if (start === draftLines.length && start === diskLines.length) {
    return <p className="muted">可见文字一致，磁盘版本或行尾格式发生变化。</p>;
  }
  let suffix = 0;
  while (suffix < commonLength - start && draftLines.at(-1 - suffix) === diskLines.at(-1 - suffix)) suffix++;
  return <div className="comparison">
    <section><h3>编辑器中的更改，第 {start + 1} 行起</h3><pre>{draftLines.slice(start, draftLines.length - suffix).join('\n')}</pre></section>
    <section><h3>磁盘上的更改，第 {start + 1} 行起</h3><pre>{diskLines.slice(start, diskLines.length - suffix).join('\n')}</pre></section>
  </div>;
}

export default function NoteViewer({ location, title, close }: {
  location: FileLocation; title: string; close: () => void;
}) {
  const [loaded, setLoaded] = useState<NoteDocument>();
  const [initial, setInitial] = useState('');
  const [draft, setDraft] = useState('');
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const [disk, setDisk] = useState<NoteDocument>();
  const dirty = !!loaded && draft !== loaded.text;

  function openVersion(note: NoteDocument) {
    setLoaded(note);
    setInitial(note.text);
    setDraft(note.text);
    setGeneration((previous) => previous + 1);
    setDisk(undefined);
    setConflicted(false);
    setError('');
    setFeedback('');
  }

  useEffect(() => {
    let done = false;
    void loadNote(location).then((note) => { if (!done) openVersion(note); }, (failure) => {
      if (!done) setError(message(failure));
    });
    return () => { done = true; };
  }, [location]);

  useBeforeUnloadWarning(dirty);

  async function reload() {
    if (dirty && !window.confirm('放弃编辑器里未保存的修改，并重新读取当前磁盘版本？')) return;
    setBusy(true);
    try {
      openVersion(await loadNote(location));
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!loaded || !dirty || conflicted) return;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const result = await saveNote(location, draft, loaded.version);
      setLoaded(result.note);
      setFeedback('Markdown 已保存。上一个版本备份于 ' + result.backupFile);
    } catch (failure) {
      setError(message(failure));
      if (failure instanceof ApiError && failure.code === 'note_conflict') {
        setConflicted(true);
        setDisk(await loadNote(location).catch(() => undefined));
      }
    } finally {
      setBusy(false);
    }
  }

  return <Dialog title={title} className="reader-dialog" onClose={() => {
    if (!busy && (!dirty || window.confirm('笔记有未保存的修改。放弃修改并返回课程？'))) close();
  }}>
    <div className="file-viewer form">
      <p className="muted preserve-lines">{location.path}</p>
      <div className="row">
        <button type="button" disabled={busy} onClick={() => void reload()}>重新加载笔记</button>
        {loaded && <>
          <button type="button" aria-pressed={showPreview} onClick={() => setShowPreview(!showPreview)}>Markdown 预览</button>
          <button type="button" disabled={busy || !dirty || !loaded.writable || conflicted} onClick={() => void save()}>
            保存 Markdown
          </button>
          <a href={loaded.obsidianUri}>在 Obsidian 定位</a>
          <button type="button" onClick={async () => {
            try {
              await navigator.clipboard.writeText(loaded.obsidianUri);
              setFeedback('已复制 Obsidian 地址');
            } catch {
              setFeedback(loaded.obsidianUri);
            }
          }}>复制 Obsidian 地址</button>
        </>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {feedback && <p role="status" className="preserve-lines">{feedback}</p>}
      {dirty && <span className="muted">有未保存的笔记修改</span>}
      {loaded && <>
        {!loaded.writable && <p className="muted">当前目录仅授权读取。</p>}
        <small className="muted">打开 Obsidian 需要已注册该 URI 协议，且目标文件在已打开或已注册的 Vault 内。</small>
        <NoteEditor key={generation} initial={initial} writable={loaded.writable} update={setDraft} />
        {showPreview && <Preview text={draft} />}
        {conflicted && (disk ? <ConflictView draft={draft} disk={disk.text} />
          : <p className="muted">无法读取磁盘版本。编辑器仍保留你的修改，可复制后重新加载。</p>)}
      </>}
      {!error && !loaded && <p role="status">正在读取笔记…</p>}
    </div>
  </Dialog>;
}
