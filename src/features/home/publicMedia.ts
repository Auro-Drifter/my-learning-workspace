import { dashboardEntryLimit, dashboardEntrySchema } from '../../../shared/homeWidgets.ts';
import type { DashboardEntry } from '../../../shared/homeWidgets.ts';
import { api, isPagesDemo } from '../../services/api.ts';
import { webAddress } from './homeImport.ts';

export const mediaSources = {
  qiushi: { title: '《求是》杂志', url: 'https://www.qstheory.cn/20251231/2d916da295774130ac2fb223fd208895/c.html' },
  zjxc: { title: '浙江宣传', url: 'https://zjnews.zjol.com.cn/zjxc/' },
} as const;

export type MediaSource = keyof typeof mediaSources;
export const mediaSourceIds: MediaSource[] = ['qiushi', 'zjxc'];
const cached = new Map<MediaSource, { entries: DashboardEntry[]; until: number }>();

async function readPage(url: string) {
  const { text } = await api<{ text: string }>('/api/home-pages/public-source', 'POST', { url });
  return text;
}

export async function loadPublicMedia(source: MediaSource, refresh: boolean): Promise<DashboardEntry[]> {
  const definition = mediaSources[source];
  if (isPagesDemo) return [{ id: source, title: definition.title, url: definition.url, status: '前往官方网站' }];
  const previous = cached.get(source);
  if (previous && !refresh && previous.until > Date.now()) return previous.entries;

  const [{ parseQiushiCatalog, parseQiushiIssueArticles, parseZjxcArticles }, page] = await Promise.all([
    import('../../../vendor/home-pages/src/widgets/mediaParsers.ts'), readPage(definition.url),
  ]);
  const issue = source === 'qiushi' ? parseQiushiCatalog(page).find(({ url }) =>
    webAddress(url, definition.url)?.startsWith('https://www.qstheory.cn/')) : undefined;
  const articles = source === 'qiushi'
    ? parseQiushiIssueArticles(issue ? await readPage(new URL(issue.url, definition.url).href) : page, issue?.title)
    : parseZjxcArticles(page);

  const hostname = new URL(definition.url).hostname;
  const entries = new Map<string, DashboardEntry>();
  for (const article of articles) {
    const url = webAddress(article.url, definition.url);
    if (!url || new URL(url).hostname !== hostname) continue;
    const title = article.title.replace(/^浙江宣传\s*[|｜丨]\s*/u, '').trim();
    const date = article.date?.slice(0, 10);
    const parsed = dashboardEntrySchema.safeParse({
      id: url.slice(-150), url, title: title.slice(0, 240),
      at: date && /^\d{4}-\d{2}-\d{2}$/u.test(date) ? date : undefined,
      status: [article.issue ?? article.column, article.author].filter(Boolean).join(' · ').slice(0, 80) || undefined,
    });
    if (parsed.success) entries.set(url, parsed.data);
    if (entries.size === dashboardEntryLimit) break;
  }
  if (!entries.size) throw new Error(definition.title + '暂时没有可显示的文章。');
  const items = [...entries.values()];
  cached.set(source, { entries: items, until: Date.now() + 60 * 60 * 1000 });
  return items;
}
