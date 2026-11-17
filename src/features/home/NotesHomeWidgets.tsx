import { lazy, Suspense } from 'react';
import { BookOpen, CalendarClock, Database, History, RefreshCw } from 'lucide-react';
import { localDay } from '../../../shared/home.ts';
import { homeWidgetCatalog } from '../../../shared/homeWidgets.ts';
import type { ListedFile } from '../../../shared/files.ts';
import { useFileList } from '../resources/FileLibrary.tsx';
import { DirectoryFields, HomeWidgetFrame, NoteLink, WidgetSettings } from './HomeWidgetFrame.tsx';
import type { HomeWidgetContext } from './HomeWidgetFrame.tsx';
import { noteSection, useHomeNote } from './homeNotes.ts';
import { NoteLocationFields } from './StudyHomeWidgets.tsx';

const MarkdownPreview = lazy(() => import('../notes/MarkdownPreview.tsx'));
const icons = { recent: History, stats: Database, onthisday: CalendarClock } as const;

const filename = (file: ListedFile) => file.path.split('/').at(-1)!.replace(/\.md$/iu, '');

const checkedDate = (value: number | undefined) => value && Number.isFinite(value) ? localDay(new Date(value)) : '';

function noteDate(file: ListedFile) {
  const inName = filename(file).match(/(?:^|[^\d])(\d{4}-\d{2}-\d{2})(?!\d)/u)?.[1];
  return inName && Number.isFinite(Date.parse(inName)) ? inName : checkedDate(file.createdAt);
}

export function FolderHomeCard({ kind, context }: { kind: keyof typeof icons; context: HomeWidgetContext }) {
  const { title } = homeWidgetCatalog[kind];
  const config = context.configs[kind] ?? { rootId: '', folder: '' };
  const limit = context.configs.recent?.limit ?? 8;
  const { data, error, refresh } = useFileList(config.rootId, config.folder, kind === 'stats' ? 'all' : 'markdown', '', true);
  const today = localDay(context.now);
  const files = data?.files ?? [];
  const matching = kind === 'onthisday' ? files.filter((file) => {
    const date = noteDate(file);
    return !!date && date.slice(0, 4) < today.slice(0, 4) && date.slice(5) === today.slice(5);
  }).sort((a, b) => noteDate(b).localeCompare(noteDate(a))) : files;
  const folders = new Set(files.flatMap(({ path }) => {
    const parts = path.split('/');
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
  }));
  const notes = files.filter(({ kind }) => kind === 'markdown');
  return <HomeWidgetFrame title={title} icon={icons[kind]} disabled={context.disabled}
    settings={(close) => <WidgetSettings title={title} close={close} initial={{ ...config, limit }}
      save={(draft) => {
        const { rootId, folder, limit } = draft;
        return kind === 'recent' ? context.save(kind, { rootId, folder, limit }) : context.save(kind, { rootId, folder });
      }} fields={(draft, change) => <>
        <DirectoryFields draft={draft} change={change} roots={context.roots} />
        {kind === 'recent' && <label>显示条数<input type="number" min={1} max={30} required value={draft.limit}
          onChange={(event) => change({ ...draft, limit: Number(event.target.value) })} /></label>}
      </>} />}>
    {!config.rootId ? <p className="muted">在卡片设置中选择资料文件夹。</p>
      : error ? <p role="alert" className="error">{error}</p>
      : !data ? <p role="status">正在读取目录…</p>
      : <>
        <div className="home-widget-actions"><button type="button" className="quiet-button" onClick={refresh}>
          <RefreshCw className="tool-icon" aria-hidden="true" />刷新
        </button></div>
        {kind === 'stats' ? <dl className="home-widget-metrics">
          <div><dt>Markdown 笔记</dt><dd>{notes.length}</dd></div>
          <div><dt>PDF</dt><dd>{files.length - notes.length}</dd></div>
          <div><dt>包含资料的子目录</dt><dd>{folders.size}</dd></div>
          <div><dt>今日修改的笔记</dt><dd>{notes.filter((file) => checkedDate(file.modifiedAt) === today).length}</dd></div>
        </dl> : matching.length ? <ul className="plain-list home-widget-list">
          {matching.slice(0, kind === 'recent' ? limit : 12).map((file) => <li key={file.path}>
            <NoteLink title={filename(file)} location={{ rootId: config.rootId, path: file.path }} open={context.openFile} />
            <small className="muted">{kind === 'onthisday' ? noteDate(file) : checkedDate(file.modifiedAt)} · {file.path}</small>
          </li>)}</ul>
          : <p className="muted">{kind === 'onthisday' ? '该目录没有找到往年今天的笔记。' : '该目录还没有 Markdown 笔记。'}</p>}
        {data.limited && <p className="muted">仅展示扫描范围内的前 500 项。可选更具体的子目录。</p>}
      </>}
  </HomeWidgetFrame>;
}

export function EmbeddedNoteCard({ context }: { context: HomeWidgetContext }) {
  const { title } = homeWidgetCatalog.note;
  const config = context.configs.note;
  const { data, error, refresh } = useHomeNote(config?.location);
  const text = data === undefined ? undefined : noteSection(data, config?.heading ?? '');
  return <HomeWidgetFrame title={title} icon={BookOpen} disabled={context.disabled}
    settings={(close) => <WidgetSettings title={title} close={close}
      initial={config ?? { location: { rootId: '', path: '' }, heading: '' }}
      save={(value) => context.save('note', value)} fields={(draft, change) => <>
        <NoteLocationFields location={draft.location} context={context} change={(location) => {
          if (location) change({ ...draft, location });
        }} />
        <label>章节标题（选填）<input value={draft.heading} maxLength={120} placeholder="留空预览整篇"
          onChange={(event) => change({ ...draft, heading: event.target.value })} /></label>
      </>} />}>
    {config ? <>
      <div className="home-widget-actions">
        <NoteLink title="打开原笔记" location={config.location} open={context.openFile} />
        <button type="button" className="quiet-button" onClick={refresh}>刷新预览</button>
      </div>
      {error ? <p role="alert" className="error">{error}</p> : data === undefined ? <p role="status">正在读取笔记…</p>
        : text === undefined ? <p className="muted">没有找到指定章节。</p>
        : text.trim() ? <div className="home-embedded-note"><Suspense fallback={<p role="status">正在加载预览…</p>}>
          <MarkdownPreview text={text} />
        </Suspense></div> : <p className="muted">这篇笔记没有可预览的内容。</p>}
    </> : <p className="muted">在卡片设置中选择要嵌入的笔记。</p>}
  </HomeWidgetFrame>;
}
