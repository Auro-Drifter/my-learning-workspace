import { z } from 'zod';
import { fileLocationSchema, idSchema, relativePathSchema, resourceSchema } from './actions.ts';

export const homeWidgetCatalog = {
  shortcuts: { title: '快捷入口', description: '固定课程、网站和笔记', group: '学习', columns: 6 },
  countdown: { title: '倒计时与纪念日', description: '距离目标日或纪念日的天数', group: '学习', columns: 4 },
  quote: { title: '每日一言', description: '按日期轮换自定义语录', group: '学习', columns: 4 },
  kanban: { title: '任务看板', description: '按状态整理课程任务', group: '学习', columns: 12 },
  recent: { title: '最近笔记', description: '打开授权目录内最近修改的笔记', group: '笔记', columns: 6 },
  stats: { title: '全库统计', description: '统计授权范围内的笔记、PDF 和文件夹', group: '笔记', columns: 6 },
  onthisday: { title: '那年今日', description: '回顾往年同一天的笔记', group: '笔记', columns: 6 },
  note: { title: '笔记嵌入', description: '预览授权笔记或指定标题章节', group: '笔记', columns: 6 },
  duowei: { title: '待办与日程', description: '从多维表格文件读取计划', group: '信息流', columns: 6 },
  annotations: { title: '批注与复习', description: '导入 Mobile Ink 的批注和题库', group: '信息流', columns: 6 },
  wechat: { title: '微信收件箱', description: '读取 WeChat2Ob 日志和收件箱表格', group: '信息流', columns: 6 },
  insights: { title: '聚合信息流', description: '合看日程、批注和微信记录', group: '信息流', columns: 12 },
  media: { title: '主流媒体与 RSS', description: '订阅清单与 RSS、Atom 阅读', group: '信息流', columns: 6 },
} as const;

export type HomeWidgetId = keyof typeof homeWidgetCatalog;
export const homeWidgetIds = Object.keys(homeWidgetCatalog) as HomeWidgetId[];
const day = z.union([z.literal(''), z.iso.date()]);
const optionalId = z.union([z.literal(''), idSchema]);
const folder = z.union([z.literal(''), relativePathSchema]);
const noteLocation = fileLocationSchema.refine(({ path }) => /\.md$/iu.test(path), '请选择 Markdown 笔记');
const directory = z.strictObject({ rootId: idSchema, folder });
export const dashboardEntrySchema = z.strictObject({
  id: z.string().min(1).max(150),
  title: z.string().min(1).max(240),
  body: z.string().max(600).optional(),
  at: z.string().max(32).optional(),
  status: z.string().max(80).optional(),
  path: relativePathSchema.optional(),
  url: z.string().max(1600).optional(),
});
export type DashboardEntry = z.infer<typeof dashboardEntrySchema>;
export const dashboardEntryLimit = 120;
export const publicHomeFeeds = {
  nasa: { title: 'NASA · 最新资讯', url: 'https://www.nasa.gov/feed/' },
  github: { title: 'GitHub · 更新日志', url: 'https://github.blog/changelog/feed/' },
} as const;
export const publicHomeFeedSchema = z.enum(Object.keys(publicHomeFeeds) as (keyof typeof publicHomeFeeds)[]);
const records = z.array(dashboardEntrySchema).max(dashboardEntryLimit)
  .refine((items) => new Set(items.map(({ id }) => id)).size === items.length, '导入记录 ID 重复');
const importConfig = z.strictObject({ source: z.string().min(1).max(240), entries: records, rootId: idSchema.optional() });
export const homeWidgetsSchema = z.strictObject({
  shortcuts: z.array(resourceSchema).max(40).refine((items) => new Set(items.map(({ id }) => id)).size === items.length).optional(),
  countdown: z.strictObject({ title: z.string().trim().min(1).max(120), date: day, elapsed: z.boolean() }).optional(),
  quote: z.strictObject({ text: z.string().max(8000), note: noteLocation.optional() }).optional(),
  kanban: z.strictObject({ courseId: optionalId, showDone: z.boolean() }).optional(),
  recent: directory.extend({ limit: z.number().int().min(1).max(30) }).optional(),
  stats: directory.optional(),
  onthisday: directory.optional(),
  note: z.strictObject({ location: noteLocation, heading: z.string().max(120) }).optional(),
  duowei: importConfig.optional(),
  annotations: importConfig.optional(),
  wechat: importConfig.optional(),
  insights: z.array(z.enum(['duowei', 'annotations', 'wechat'])).max(3)
    .refine((items) => new Set(items).size === items.length).optional(),
  media: z.strictObject({ entries: records, subscriptions: records }).optional(),
});
export type HomeWidgetConfigs = z.infer<typeof homeWidgetsSchema>;
export const insightSources = ['duowei', 'annotations', 'wechat'] as const;
export type InsightSource = typeof insightSources[number];
