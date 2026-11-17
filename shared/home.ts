import { z } from 'zod';
import { idSchema } from './actions.ts';
import type { PluginLibrary } from './plugins.ts';
import { homeWidgetCatalog, homeWidgetIds, homeWidgetsSchema } from './homeWidgets.ts';
import type { HomeWidgetId } from './homeWidgets.ts';

const homeBuiltinIds = ['welcome', 'habits', 'focus', 'tasks'] as const;
export type HomeBuiltinId = typeof homeBuiltinIds[number] | HomeWidgetId;
export type HomeCardId = HomeBuiltinId | `plugin:${string}`;
const homeCardIdSchema = z.union([z.enum([...homeBuiltinIds, ...homeWidgetIds]), z.custom<`plugin:${string}`>(
  (value) => typeof value === 'string' && /^plugin:[a-zA-Z0-9_-]{1,80}$/u.test(value),
)]);
const homeLayoutSchema = z.array(z.strictObject({
  id: homeCardIdSchema,
  columns: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(12)]),
  hidden: z.boolean(),
})).max(homeBuiltinIds.length + homeWidgetIds.length + 16).refine((items) => new Set(items.map(({ id }) => id)).size === items.length, '首页组件重复');
export type HomeLayout = z.infer<typeof homeLayoutSchema>;
export type HomeCard = HomeLayout[number];

const defaultHomeLayout: HomeLayout = [
  ...homeBuiltinIds.map((id): HomeCard => ({ id, columns: id === 'welcome' || id === 'habits' ? 12 : 6, hidden: false })),
  ...homeWidgetIds.map((id): HomeCard => ({ id, columns: homeWidgetCatalog[id].columns, hidden: true })),
];

export function pluginHomeId(id: string): `plugin:${string}` {
  return `plugin:${id}`;
}

export function getHomeLayout(layout: HomeLayout | undefined, plugins: PluginLibrary): HomeLayout {
  const installed = plugins.packages.map(({ manifest, showOnHome }): HomeCard => ({
    id: pluginHomeId(manifest.id), columns: 6, hidden: !showOnHome,
  }));
  const defaults = [...defaultHomeLayout, ...installed];
  const available = new Map(defaults.map((card) => [card.id, card]));
  const sorted: HomeLayout = [];
  for (const card of layout ?? []) {
    const fallback = available.get(card.id);
    if (!fallback) continue;
    sorted.push(card.id.startsWith('plugin:') ? { ...card, hidden: fallback.hidden } : card);
    available.delete(card.id);
  }
  return [...sorted, ...available.values()];
}

export const focusDurations = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 } as const;
const modeSchema = z.enum(['focus', 'short', 'long']);
export type FocusMode = z.infer<typeof modeSchema>;
const timerSchema = z.strictObject({
  mode: modeSchema,
  seconds: z.number().int().min(0).max(focusDurations.focus),
  deadline: z.number().int().positive().max(8_640_000_000_000_000).nullable(),
  label: z.string().max(120),
}).refine(({ mode, seconds }) => seconds <= focusDurations[mode]);
export type FocusTimer = z.infer<typeof timerSchema>;

export const homeSchema = z.strictObject({
  name: z.string().trim().max(40),
  layout: homeLayoutSchema.optional(),
  widgets: homeWidgetsSchema.optional(),
  welcome: z.strictObject({ clock: z.boolean(), courseCount: z.boolean() }).optional(),
  habits: z.array(z.strictObject({ id: idSchema, title: z.string().trim().min(1).max(25) })).max(8),
  checkIns: z.record(z.iso.date(), z.array(idSchema).max(8)),
  timer: timerSchema,
  focusHistory: z.record(z.iso.date(), z.number().int().min(1).max(999)),
}).superRefine((home, context) => {
  const ids = new Set(home.habits.map(({ id }) => id));
  if (ids.size !== home.habits.length) context.addIssue({ code: 'custom', message: '习惯 ID 重复', path: ['habits'] });
  if (Object.keys(home.checkIns).length > 3660 || Object.values(home.checkIns).some(
    (items) => new Set(items).size !== items.length || items.some((id) => !ids.has(id)),
  )) context.addIssue({ code: 'custom', message: '打卡记录无效或超过上限', path: ['checkIns'] });
  if (Object.keys(home.focusHistory).length > 3660) context.addIssue({ code: 'custom', message: '专注记录超过上限', path: ['focusHistory'] });
});
export type Home = z.infer<typeof homeSchema>;

export const defaultHome: Home = {
  name: '',
  habits: [{ id: 'read', title: '阅读' }, { id: 'practice', title: '做题' }, { id: 'review', title: '复盘' }],
  checkIns: {},
  timer: { mode: 'focus', seconds: focusDurations.focus, deadline: null, label: '' },
  focusHistory: {},
};

export function localDay(date: Date) {
  return [String(date.getFullYear()).padStart(4, '0'), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
}

export function shiftDay(date: Date, days: number) {
  const result = new Date(date);
  result.setHours(12, 0, 0, 0);
  result.setDate(result.getDate() + days);
  return result;
}

export function streak(home: Home, now: Date) {
  let current = home.checkIns[localDay(now)]?.length ? now : shiftDay(now, -1);
  let days = 0;
  while (home.checkIns[localDay(current)]?.length) {
    days++;
    current = shiftDay(current, -1);
  }
  return days;
}

export function recordDay<T>(history: Record<string, T>, date: string, value: T) {
  const records = { ...history, [date]: value };
  const excess = Object.keys(records).sort().slice(0, Math.max(0, Object.keys(records).length - 3660));
  for (const key of excess) delete records[key];
  return records;
}

export function focusRemaining(timer: FocusTimer, now: number) {
  return timer.deadline === null ? timer.seconds : Math.max(0, Math.ceil((timer.deadline - now) / 1000));
}

export function finishFocus(home: Home, now: number): Home {
  const { timer, focusHistory } = home;
  if (timer.deadline === null || timer.deadline > now) return home;
  const date = localDay(new Date(timer.deadline));
  return {
    ...home,
    timer: { ...timer, deadline: null, seconds: 0 },
    focusHistory: timer.mode === 'focus' ? recordDay(focusHistory, date, Math.min(999, (focusHistory[date] ?? 0) + 1)) : focusHistory,
  };
}
