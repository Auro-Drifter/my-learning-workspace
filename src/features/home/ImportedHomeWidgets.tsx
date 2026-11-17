import { useEffect, useState } from 'react';
import { CalendarCheck, Highlighter, Inbox, MessageCircle, RefreshCw, Rss } from 'lucide-react';
import { localDay } from '../../../shared/home.ts';
import { dashboardEntryLimit, homeWidgetCatalog, insightSources } from '../../../shared/homeWidgets.ts';
import type { DashboardEntry, HomeWidgetConfigs, InsightSource } from '../../../shared/homeWidgets.ts';
import { rootOptions } from '../resources/FileLibrary.tsx';
import { message } from '../../services/api.ts';
import { HomeWidgetFrame, NoteLink, WidgetSettings } from './HomeWidgetFrame.tsx';
import type { HomeWidgetContext } from './HomeWidgetFrame.tsx';
import { parseDashboardImport, parseFeed, webAddress } from './homeImport.ts';
import { loadPublicMedia, mediaSourceIds, mediaSources } from './publicMedia.ts';
import type { MediaSource } from './publicMedia.ts';

const sources = {
  duowei: { icon: CalendarCheck, formats: '.duowei', instructions: '选择多维表格 .duowei 文件。卡片会识别标题、截止日期、状态和备注字段。' },
  annotations: { icon: Highlighter, formats: '.json', instructions: '选择 Mobile Ink 批注中心 index.json、question-bank.json 或原文批注 JSON。' },
  wechat: { icon: MessageCircle, formats: '.json,.duowei', instructions: '选择 WeChat2Ob 消息日志 JSON 或微信收件箱 .duowei 文件。' },
} as const;

type ImportData = NonNullable<HomeWidgetConfigs[InsightSource]>;
const entryDate = (entry: DashboardEntry) => entry.at?.slice(0, 10) ?? '';

function ImportFiles({ label, accept, parse }: {
  label: string; accept: string; parse: (files: { name: string; text: string }[]) => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <>
    <label>{label}<input type="file" accept={accept} multiple disabled={busy} onChange={async (event) => {
      const input = event.currentTarget;
      const files = Array.from(input.files ?? []);
      input.value = '';
      if (!files.length) return;
      setError('');
      setBusy(true);
      try {
        if (files.length > 120 || files.reduce((size, file) => size + file.size, 0) > 8 * 1024 * 1024) {
          throw new Error('每次最多选择 120 个文件，合计不超过 8 MiB。');
        }
        parse(await Promise.all(files.map(async (file) => ({ name: file.name, text: await file.text() }))));
      } catch (failure) {
        setError(message(failure));
      } finally {
        setBusy(false);
      }
    }} /></label>
    {busy && <span role="status" className="muted">正在读取文件…</span>}
    {error && <p className="error" role="alert">{error}</p>}
  </>;
}

function Entries({ entries, context }: {
  entries: { entry: DashboardEntry; rootId?: string; source?: string }[]; context: HomeWidgetContext;
}) {
  return <ul className="plain-list home-widget-list home-import-list">
    {entries.map(({ entry, rootId, source }) => {
      const url = webAddress(entry.url ?? '');
      return <li key={entry.id}>
        {rootId && entry.path ? <NoteLink location={{ rootId, path: entry.path }} title={entry.title} open={context.openFile} />
          : url ? <a href={url} target="_blank" rel="noopener noreferrer">{entry.title}</a> : <strong>{entry.title}</strong>}
        {(source || entryDate(entry) || entry.status) && <small className="muted">
          {[source, entryDate(entry), entry.status].filter(Boolean).join(' · ')}
        </small>}
        {entry.body && entry.body !== entry.title && <p>{entry.body}</p>}
      </li>;
    })}
  </ul>;
}

export function ImportedHomeCard({ kind, context }: { kind: InsightSource; context: HomeWidgetContext }) {
  const { title } = homeWidgetCatalog[kind];
  const source = sources[kind];
  const config = context.configs[kind];
  const [onlyOpen, setOnlyOpen] = useState(false);
  const today = localDay(context.now);
  const isDone = (item: DashboardEntry) => /^(?:已完成|完成|已整理|已归档|已掌握|done|completed|archived|resolved)$/iu.test(item.status ?? '');
  const entries = config?.entries ?? [];
  const visible = onlyOpen ? entries.filter((item) => !isDone(item)) : entries;
  const due = kind === 'duowei' || kind === 'annotations' ? entries.filter((item) =>
    !!entryDate(item) && entryDate(item) <= today && !isDone(item) && (kind !== 'annotations' || item.status === '待复习')).length : 0;
  return <HomeWidgetFrame title={title} icon={source.icon} disabled={context.disabled}
    settings={(close) => <WidgetSettings title={title} close={close}
      initial={config ?? { source: '', entries: [] } as ImportData}
      save={(value) => context.save(kind, value.source ? value : undefined)}
      fields={(draft, change) => <>
        <p className="muted">{source.instructions}</p>
        <ImportFiles label="选取来源文件" accept={source.formats} parse={(files) => {
          const { entries, total } = parseDashboardImport(kind, files);
          const names = files.length > 1 ? files[0].name + ' 等 ' + files.length + ' 个文件' : files[0].name;
          const summary = total > entries.length ? names + '（保留 ' + dashboardEntryLimit + '／' + total + ' 条）' : names;
          change((current) => ({ ...current, entries, source: summary.slice(0, 240) }));
        }} />
        <label>关联笔记目录（选填）<select value={draft.rootId ?? ''}
          onChange={(event) => change({ ...draft, rootId: event.target.value || undefined })}>
          {rootOptions(context.roots, draft.rootId ?? '')}
        </select></label>
        {draft.source && <p className="muted" role="status">{draft.source} · {draft.entries.length} 条</p>}
        {draft.source && <button type="button" onClick={() => change({ source: '', entries: [], rootId: draft.rootId })}>清除导入数据</button>}
      </>} />}>
    {config ? <>
      <div className="home-widget-actions">
        <small className="muted">{config.source} · {entries.length} 条{due > 0 ? ' · ' + due + ' 条到期' : ''}</small>
        <button className="quiet-button" type="button" aria-pressed={onlyOpen} onClick={() => setOnlyOpen(!onlyOpen)}>仅显示待处理</button>
      </div>
      {visible.length ? <Entries entries={visible.map((entry) => ({ entry, rootId: config.rootId }))} context={context} />
        : <p className="muted">当前筛选下没有记录。</p>}
    </> : <p className="muted">{source.instructions}</p>}
  </HomeWidgetFrame>;
}

export function InsightsCard({ context }: { context: HomeWidgetContext }) {
  const { title } = homeWidgetCatalog.insights;
  const enabled = context.configs.insights ?? [...insightSources];
  const [filter, setFilter] = useState<InsightSource | 'all'>('all');
  const visible = filter === 'all' || !enabled.includes(filter) ? enabled : [filter];
  const entries = visible.flatMap((source) => {
    const config = context.configs[source];
    return (config?.entries ?? []).map((item) => ({
      entry: { ...item, id: source + ':' + item.id }, source: homeWidgetCatalog[source].title, rootId: config?.rootId,
    }));
  }).sort((a, b) => (b.entry.at ?? '').localeCompare(a.entry.at ?? ''));
  return <HomeWidgetFrame title={title} icon={Inbox} disabled={context.disabled}
    settings={(close) => <WidgetSettings title={title} initial={enabled} close={close}
      save={(value) => context.save('insights', value)} fields={(draft, change) => <fieldset className="resource-form"><legend>显示来源</legend>
        {insightSources.map((kind) => <label className="check" key={kind}><input type="checkbox" checked={draft.includes(kind)}
          onChange={(event) => change(event.target.checked ? [...draft, kind] : draft.filter((item) => item !== kind))} />{homeWidgetCatalog[kind].title}</label>)}
      </fieldset>} />}>
    {!!enabled.length && <div className="segmented" aria-label="信息流来源">
      <button type="button" aria-pressed={visible === enabled} onClick={() => setFilter('all')}>全部</button>
      {enabled.map((kind) => <button key={kind} type="button" aria-pressed={visible.length === 1 && filter === kind}
        onClick={() => setFilter(kind)}>{homeWidgetCatalog[kind].title}</button>)}
    </div>}
    {entries.length ? <Entries entries={entries.slice(0, 40)} context={context} />
      : <p className="muted">从待办与日程、批注与复习或微信收件箱卡片导入资料后，这里会合并显示。</p>}
  </HomeWidgetFrame>;
}

type FeedConfig = NonNullable<HomeWidgetConfigs['media']>;
const entryKey = (entry: DashboardEntry) => entry.url || entry.title + ':' + entry.at;

function mergeFeeds(current: FeedConfig, updates: FeedConfig[]): FeedConfig {
  function merge(kind: keyof FeedConfig) {
    const indexed = new Map(current[kind].map((entry) => [entryKey(entry), entry]));
    for (const entry of updates.flatMap((item) => item[kind])) {
      const key = entryKey(entry);
      indexed.set(key, { ...entry, id: indexed.get(key)?.id ?? crypto.randomUUID() });
    }
    return [...indexed.values()].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')).slice(0, dashboardEntryLimit);
  }
  return { entries: merge('entries'), subscriptions: merge('subscriptions') };
}

type MediaChannel = MediaSource | 'all' | 'imports' | 'subscriptions';
type MediaResult = { entries: DashboardEntry[]; pending: boolean; error?: string };
const emptyFeed = { entries: [], subscriptions: [] };
const pendingMedia = { entries: [], pending: true };

export function FeedCard({ context }: { context: HomeWidgetContext }) {
  const { title } = homeWidgetCatalog.media;
  const config = context.configs.media ?? emptyFeed;
  const [channel, setChannel] = useState<MediaChannel>('all');
  const [refresh, setRefresh] = useState(0);
  const [media, setMedia] = useState<Record<MediaSource, MediaResult>>({ qiushi: pendingMedia, zjxc: pendingMedia });

  useEffect(() => {
    let active = true;
    for (const source of mediaSourceIds) {
      void loadPublicMedia(source, refresh > 0).then((entries) => {
        if (active) setMedia((current) => ({ ...current, [source]: { entries, pending: false } }));
      }, (failure) => {
        if (active) setMedia((current) => ({ ...current, [source]: { ...current[source], pending: false, error: message(failure) } }));
      });
    }
    return () => { active = false; };
  }, [refresh]);

  const viewingMedia = channel !== 'imports' && channel !== 'subscriptions';
  const shownSources = channel === 'all' ? mediaSourceIds : viewingMedia ? [channel] : [];
  const pending = shownSources.some((source) => media[source].pending);
  const refreshing = mediaSourceIds.some((source) => media[source].pending);
  const failed = shownSources.filter((source) => media[source].error);
  const articles = shownSources.flatMap((source) => media[source].entries.map((entry) => ({ entry, source: mediaSources[source].title })))
    .sort((a, b) => (b.entry.at ?? '').localeCompare(a.entry.at ?? ''));
  const subscriptions = [
    ...mediaSourceIds.map((id) => ({ id, ...mediaSources[id] })),
    ...config.subscriptions,
  ];

  return <HomeWidgetFrame title={title} icon={Rss} disabled={context.disabled}
    settings={(close) => <WidgetSettings title={title} close={close} initial={config}
      save={(value) => context.save('media', value)} fields={(draft, change) => <>
        <ImportFiles label="导入 RSS、Atom 或 OPML" accept=".xml,.rss,.atom,.opml" parse={(files) => {
          const imports = files.map(({ text }) => parseFeed(text));
          change((current) => mergeFeeds(current, imports));
        }} />
        <p className="muted">已导入文章 {draft.entries.length} 篇 · 订阅 {draft.subscriptions.length} 个。</p>
        {!!(draft.entries.length || draft.subscriptions.length) && <button type="button" onClick={() => change(emptyFeed)}>清除已导入内容</button>}
      </>} />}>
    <div className="row">
      <select aria-label="媒体频道" value={channel} onChange={(event) => setChannel(event.target.value as MediaChannel)}>
        <option value="all">全部聚合</option>
        {mediaSourceIds.map((source) => <option key={source} value={source}>{mediaSources[source].title}</option>)}
        {!!config.entries.length && <option value="imports">已导入文章</option>}
        <option value="subscriptions">订阅</option>
      </select>
      {viewingMedia && <button type="button" className="quiet-button home-icon-button" aria-label="刷新媒体来源" title="刷新媒体来源"
        disabled={refreshing} onClick={() => {
          setMedia(({ qiushi, zjxc }) => ({ qiushi: { ...qiushi, pending: true, error: undefined }, zjxc: { ...zjxc, pending: true, error: undefined } }));
          setRefresh((previous) => previous + 1);
        }}><RefreshCw className="tool-icon" aria-hidden="true" /></button>}
      {pending && <span role="status" className="muted">正在加载…</span>}
    </div>
    {viewingMedia ? <>
      {!!failed.length && <p className="muted" role="status">{failed.map((source) => mediaSources[source].title).join('、')}暂时无法刷新，可稍后重试。</p>}
      {!!articles.length && <Entries entries={articles} context={context} />}
    </> : <Entries entries={(channel === 'subscriptions' ? subscriptions : config.entries).map((entry) => ({ entry }))} context={context} />}
  </HomeWidgetFrame>;
}
