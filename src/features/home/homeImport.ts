import { relativePathSchema } from '../../../shared/actions.ts';
import { dashboardEntryLimit, dashboardEntrySchema } from '../../../shared/homeWidgets.ts';
import type { DashboardEntry, InsightSource } from '../../../shared/homeWidgets.ts';

type Dict = Record<string, unknown>;
const object = (value: unknown): Dict | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Dict : undefined;
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const first = (...values: unknown[]) => values.map(string).find(Boolean) ?? '';

export function webAddress(value: string, base?: string) {
  try {
    const url = new URL(value, base);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.href.length <= 1600) {
      return url.href;
    }
  } catch {
    return undefined;
  }
}

function dateValue(value: unknown) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(value))) return value;
  const timestamp = typeof value === 'number' ? value : Date.parse(string(value));
  return Number.isFinite(timestamp) && Math.abs(timestamp) <= 8.64e15 ? new Date(timestamp).toISOString() : undefined;
}

function notePath(value: unknown) {
  const path = string(value).replaceAll('\\', '/');
  return /\.md$/iu.test(path) && relativePathSchema.safeParse(path).success ? path : undefined;
}

function entry(id: string, title: string, body = '', date?: unknown, status = '', path?: unknown): DashboardEntry | undefined {
  if (!title) return;
  const candidate = {
    id: id.slice(0, 150), title: title.slice(0, 240), body: body.slice(0, 600) || undefined, at: dateValue(date),
    status: status.slice(0, 80) || undefined, path: notePath(path),
  };
  const parsed = dashboardEntrySchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function tableEntries(doc: Dict, wechat: boolean) {
  if (!Array.isArray(doc.fields) || !Array.isArray(doc.records)) throw new Error('请选择有效的 .duowei 表格。');
  const fields = doc.fields.map(object).filter((field) => field && string(field.id));
  const find = (pattern: RegExp) => fields.find((field) => pattern.test(first(field?.name, field?.id)));
  const title = find(wechat ? /标题|内容|消息|title|content/iu : /标题|任务|事项|title|task/iu)
    ?? fields.find((field) => field?.id === doc.titleFieldId) ?? fields.find((field) => field?.type === 'text') ?? fields[0];
  const status = find(/状态|整理|status/iu);
  const date = find(/截止|到期|日期|时间|due|date|time/iu) ?? fields.find((field) => field?.type === 'date');
  const body = find(/备注|说明|摘要|转写|description|notes|transcript/iu);
  const valueOf = (row: Dict, field?: Dict) => field ? row[string(field.id)] : undefined;
  const label = (row: Dict, field?: Dict) => {
    const value = valueOf(row, field);
    return first(array(field?.options).map(object).find((option) => option?.id === value)?.name, value);
  };
  return doc.records.flatMap((value, index) => {
    const row = object(value);
    const values = object(row?.values);
    if (!row || !values) return [];
    const item = entry(first(row.id) || 'row-' + index, label(values, title), label(values, body),
      valueOf(values, date) ?? row.updatedAt ?? row.createdAt, label(values, status), row.notePath);
    return item ? [item] : [];
  });
}

function annotationEntries(doc: Dict) {
  const records = object(doc.records);
  const questions = object(doc.questions);
  const annotations = Array.isArray(doc.annotations) ? doc.annotations : undefined;
  if (!records && !questions && !annotations) throw new Error('请选择批注中心 index.json、question-bank.json 或原文批注 JSON。');
  const results: DashboardEntry[] = [];
  function add(item?: DashboardEntry) { if (item) results.push(item); }
  for (const [id, raw] of Object.entries(records ?? {})) {
    const row = object(raw);
    if (!row) continue;
    const excerpt = object(array(row.savedExcerpts)[0]);
    add(entry(id, first(row.userNote, row.ocrText, excerpt?.title, excerpt?.originalText, row.aiSummary, id),
      first(row.ocrText, row.aiSummary), row.updatedAt ?? row.createdAt, first(row.status, '批注'), excerpt?.sourcePath ?? row.cardPath));
  }
  for (const [id, raw] of Object.entries(questions ?? {})) {
    const row = object(raw);
    if (!row) continue;
    const review = object(row.review);
    add(entry('question-' + id, string(row.stem), string(row.answer), review?.dueAt ?? row.updatedAt,
      review?.mastered === true ? '已掌握' : '待复习', object(array(row.sources)[0])?.path));
  }
  for (const [index, raw] of (annotations ?? []).entries()) {
    const row = object(raw);
    if (row) add(entry(first(row.id, 'annotation-' + index), first(row.selectedText, row.note), string(row.note),
      row.updatedAt ?? row.createdAt, '原文批注', doc.sourcePath));
  }
  return results;
}

function wechatEntries(doc: Dict) {
  if (Array.isArray(doc.fields)) return tableEntries(doc, true);
  const message = object(doc.message);
  if (!message) throw new Error('请选择 WeChat2Ob 消息日志 JSON，或微信收件箱 .duowei 文件。');
  const path = Object.entries(object(doc.receipts) ?? {}).find(([key]) => key.startsWith('notes:'));
  const item = entry(first(doc.key, message.receivedAt, message.title, message.content) || 'message',
    first(message.title, message.content, message.transcript, '微信消息'),
    first(message.transcript, message.content), message.receivedAt, first(message.kind, '微信'), object(path?.[1])?.path);
  return item ? [item] : [];
}

export function parseDashboardImport(kind: InsightSource, sources: { name: string; text: string }[]) {
  const results = new Map<string, DashboardEntry>();
  for (const [index, source] of sources.entries()) {
    const doc = object(JSON.parse(source.text));
    if (!doc) throw new Error(source.name + ' 的 JSON 结构无效。');
    const rows = kind === 'duowei' ? tableEntries(doc, false) : kind === 'wechat' ? wechatEntries(doc) : annotationEntries(doc);
    for (const row of rows) {
      const id = (index + ':' + row.id).slice(0, 150);
      results.set(id, { ...row, id });
    }
  }
  const all = [...results.values()];
  all.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  return { entries: all.slice(0, dashboardEntryLimit), total: all.length };
}

export function parseFeed(text: string): { subscriptions: DashboardEntry[]; entries: DashboardEntry[] } {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length || xml.doctype) throw new Error('请选择有效的 RSS、Atom 或 OPML 文件。');
  const root = xml.documentElement.localName.toLowerCase();
  const read = (node: Element, key: string) => [...node.children].find((child) => child.localName === key)?.textContent?.trim() ?? '';
  if (root === 'opml') {
    const subscriptions = [...xml.getElementsByTagName('outline')].flatMap((node, index) => {
      const url = webAddress(node.getAttribute('xmlUrl') ?? '');
      if (!url) return [];
      const title = first(node.getAttribute('title'), node.getAttribute('text'), url);
      return [{ id: 'source-' + index, url, title: title.slice(0, 240) }];
    });
    return { subscriptions: subscriptions.slice(0, dashboardEntryLimit), entries: [] };
  }
  if (!['rss', 'feed', 'rdf'].includes(root)) throw new Error('请选择 RSS、Atom 或 OPML 文件。');
  const parent = xml.getElementsByTagName('channel')[0] ?? xml.documentElement;
  const feedLink = [...parent.children].filter((node) => node.localName === 'link')
    .map((node) => first(node.getAttribute('href'), node.textContent)).find((link) => webAddress(link));
  const items = [...xml.getElementsByTagNameNS('*', root === 'feed' ? 'entry' : 'item')];
  const entries = items.slice(0, dashboardEntryLimit).flatMap((node, index) => {
    const href = [...node.children].find((child) => child.localName === 'link' && !['self', 'enclosure'].includes(child.getAttribute('rel') ?? ''));
    const url = webAddress(first(href?.getAttribute('href'), href?.textContent), feedLink);
    const body = first(read(node, 'description'), read(node, 'summary')).replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ').trim();
    const item = entry('article-' + index, first(read(node, 'title'), url, 'RSS 文章'), body,
      first(read(node, 'published'), read(node, 'updated'), read(node, 'pubDate')));
    return item ? [{ ...item, url }] : [];
  });
  return { subscriptions: [], entries };
}
