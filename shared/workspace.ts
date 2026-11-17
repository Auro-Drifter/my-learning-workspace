import { z } from 'zod';
import { appearanceSchema, defaultAppearance } from './appearance.ts';
import { defaultHome, homeSchema } from './home.ts';
import { defaultPluginLibrary, pluginLibrarySchema, pluginWidgetConfigSchema } from './plugins.ts';
import { fileLocationSchema, idSchema, relativePathSchema, resourceSchema, titleSchema } from './actions.ts';

const taskSchema = z.strictObject({
  id: idSchema, title: titleSchema, notes: z.string().max(4000),
  dueAt: z.union([z.literal(''), z.iso.date()]),
  status: z.enum(['todo', 'doing', 'done']), resourceId: idSchema.nullable(),
});
const studySchema = z.strictObject({
  currentTopic: z.string().max(500), nextAction: z.string().max(1000), review: z.string().max(4000),
});
const pdfPositionSchema = fileLocationSchema.extend({ page: z.number().int().min(1).max(1000000) });
export type Task = z.infer<typeof taskSchema>;
export type StudyState = z.infer<typeof studySchema>;

export const SCHEMA_VERSION = 1;
export const GRID_COLUMNS = 12;
export const MAX_LAYOUT_ROWS = 1000;
export const MAX_CONFIG_BYTES = 2 * 1024 * 1024;

const layoutSchema = z.strictObject({
  x: z.number().int().min(0).max(GRID_COLUMNS - 1),
  y: z.number().int().min(0).max(MAX_LAYOUT_ROWS - 1),
  w: z.number().int().min(2).max(GRID_COLUMNS),
  h: z.number().int().min(2).max(24),
}).refine(({ x, y, w, h }) => x + w <= GRID_COLUMNS && y + h <= MAX_LAYOUT_ROWS, '组件位置超出布局范围');

const widgetBase = { id: idSchema, courseId: idSchema, title: titleSchema, enabled: z.boolean(), layout: layoutSchema };
export const widgetSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...widgetBase, type: z.literal('quickLinks'),
    config: z.strictObject({ items: z.array(resourceSchema).max(40) }),
  }),
  z.strictObject({
    ...widgetBase, type: z.literal('text'),
    config: z.strictObject({ text: z.string().max(8000) }),
  }),
  z.strictObject({
    ...widgetBase, type: z.literal('fileLibrary'),
    config: z.strictObject({
      rootId: z.union([z.literal(''), idSchema]),
      folder: z.union([z.literal(''), relativePathSchema]),
      kind: z.enum(['all', 'markdown', 'pdf']),
    }),
  }),
  z.strictObject({ ...widgetBase, type: z.literal('tasks'), config: z.strictObject({}) }),
  z.strictObject({ ...widgetBase, type: z.literal('study'), config: z.strictObject({}) }),
  z.strictObject({ ...widgetBase, type: z.literal('plugin'), config: pluginWidgetConfigSchema }),
]);

export const navigationPathSchema = z.array(
  z.string().trim().min(1).max(40).regex(/^[^/\x00-\x1f\x7f]+$/u),
).max(3, '课程分组最多三层');

const demoNavigationPaths = new Map([
  ['linear-algebra', ['数学基础']],
  ['calculus', ['数学基础']],
  ['c', ['编程入门', 'C 方向']],
  ['cs50x', ['编程入门', 'C 方向']],
  ['cs61a', ['编程入门']],
]);

function defaultNavigationPath(id: string): string[] {
  return [...(demoNavigationPaths.get(id) ?? [])];
}

const courseSchema = z.strictObject({
  id: idSchema,
  name: titleSchema,
  description: z.string().max(4000),
  archived: z.boolean(),
  widgets: z.array(widgetSchema).max(40),
  tasks: z.array(taskSchema).max(300).default([]),
  study: studySchema.default({ currentTopic: '', nextAction: '', review: '' }),
  navigationPath: navigationPathSchema.optional(),
}).transform((course) => ({ ...course, navigationPath: course.navigationPath ?? defaultNavigationPath(course.id) }));

const explorerDatesSchema = z.strictObject({
  created: z.iso.datetime().optional(),
  modified: z.iso.datetime(),
});
export type ExplorerDates = z.infer<typeof explorerDatesSchema>;

export const workspaceSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  appearance: appearanceSchema.default(defaultAppearance),
  home: homeSchema.default(defaultHome),
  plugins: pluginLibrarySchema.default(defaultPluginLibrary),
  courseExplorer: z.strictObject({
    folders: z.array(navigationPathSchema.min(1)).max(800)
      .refine((paths) => new Set(paths.map((path) => path.join('/'))).size === paths.length, '文件夹重复'),
    trash: z.array(z.strictObject({
      id: idSchema, title: titleSchema, courses: z.array(idSchema).max(200),
      folders: z.array(navigationPathSchema.min(1)).max(800),
    })).max(800),
    bookmarks: z.array(z.string().min(1).max(160)).max(1000),
    dates: z.record(z.string().max(160).regex(/^(course|folder):.+$/u), explorerDatesSchema).optional(),
  }).optional(),
  activeCourseId: idSchema.nullable(),
  courses: z.array(courseSchema).max(200),
  pdfPositions: z.array(pdfPositionSchema).max(500).default([]),
}).superRefine((state, context) => {
  const courseIds = new Set(state.courses.map(({ id }) => id));
  if (courseIds.size !== state.courses.length) context.addIssue({ code: 'custom', message: '课程 ID 重复' });
  if (state.activeCourseId === null ? state.courses.some((course) => !course.archived)
    : !state.courses.some((course) => course.id === state.activeCourseId && !course.archived)) {
    context.addIssue({ code: 'custom', message: '当前课程无效', path: ['activeCourseId'] });
  }
  if (state.courseExplorer) {
    const trashIds = new Set<string>();
    const removed = new Set<string>();
    const archived = new Set(state.courses.filter((course) => course.archived).map(({ id }) => id));
    for (const record of state.courseExplorer.trash) {
      if (trashIds.has(record.id) || record.courses.some((id) => !archived.has(id) || removed.has(id))
        || new Set(record.courses).size !== record.courses.length) {
        context.addIssue({ code: 'custom', message: '回收站记录重复或课程状态不正确', path: ['courseExplorer', 'trash'] });
        break;
      }
      trashIds.add(record.id);
      record.courses.forEach((id) => removed.add(id));
    }
  }
  const widgetIds = new Set<string>();
  const resourceIds = new Set<string>();
  const taskIds = new Set<string>();
  const pdfKeys = state.pdfPositions.map(({ rootId, path }) => rootId + '/' + path);
  if (new Set(pdfKeys).size !== pdfKeys.length || state.pdfPositions.some(({ path }) => !/\.pdf$/iu.test(path))) {
    context.addIssue({ code: 'custom', message: 'PDF 阅读位置重复或文件类型错误', path: ['pdfPositions'] });
  }
  for (const course of state.courses) {
    const enabled = course.widgets.filter((widget) => widget.enabled);
    const courseResources = new Set<string>();
    for (const [index, widget] of course.widgets.entries()) {
      if (widget.courseId !== course.id || widgetIds.has(widget.id)) {
        context.addIssue({ code: 'custom', message: '组件 ID 重复或所属课程错误', path: ['courses', course.id, 'widgets', index] });
      }
      widgetIds.add(widget.id);
      if (widget.enabled && enabled.some((other) => other !== widget && overlaps(other.layout, widget.layout))) {
        context.addIssue({ code: 'custom', message: '可见组件的位置重叠', path: ['courses', course.id, 'widgets', index, 'layout'] });
      }
      if (widget.type !== 'quickLinks') continue;
      for (const item of widget.config.items) {
        if (resourceIds.has(item.id) || (item.kind === 'internal' && !courseIds.has(item.courseId))) {
          context.addIssue({ code: 'custom', message: '快捷入口 ID 重复或目标课程不存在', path: ['courses', course.id, 'widgets', index] });
        }
        resourceIds.add(item.id);
        courseResources.add(item.id);
      }
    }
    for (const [index, task] of course.tasks.entries()) {
      if (taskIds.has(task.id) || (task.resourceId && !courseResources.has(task.resourceId))) {
        context.addIssue({ code: 'custom', message: '任务 ID 重复或关联资源不存在', path: ['courses', course.id, 'tasks', index] });
      }
      taskIds.add(task.id);
    }
  }
});

export const snapshotSchema = z.strictObject({ revision: z.uuid(), workspace: workspaceSchema });
export type Workspace = z.infer<typeof workspaceSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Course = z.infer<typeof courseSchema>;
export type Widget = z.infer<typeof widgetSchema>;
export type WidgetType = Widget['type'];
export type WidgetLayout = Widget['layout'];

export function courseResources(course: Course) {
  return course.widgets.flatMap((widget) => widget.type === 'quickLinks' ? widget.config.items : []);
}

export function emptyCourse(id: string, name: string, description = ''): Course {
  return {
    id, name, description, archived: false, widgets: [], tasks: [],
    study: { currentTopic: '', nextAction: '', review: '' },
    navigationPath: defaultNavigationPath(id),
  };
}

export function overlaps(a: WidgetLayout, b: WidgetLayout) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function firstFreePosition(w: number, h: number, occupied: WidgetLayout[], start?: Pick<WidgetLayout, 'x' | 'y'>): WidgetLayout {
  for (let y = start?.y ?? 0; y <= MAX_LAYOUT_ROWS - h; y++) {
    for (let x = y === start?.y ? start.x : 0; x <= GRID_COLUMNS - w; x++) {
      const position = { x, y, w, h };
      if (!occupied.some((item) => overlaps(position, item))) return position;
    }
  }
  throw new Error('布局已满。请删除组件或缩小组件。');
}

export function replaceCourse(state: Workspace, replacement: Course): Workspace {
  return { ...state, courses: state.courses.map((course) => course.id === replacement.id ? replacement : course) };
}

export function moveItem<T>(items: T[], index: number, shift: -1 | 1): T[] {
  const next = index + shift;
  if (index < 0 || index >= items.length || next < 0 || next >= items.length) return items;
  const result = [...items];
  [result[index], result[next]] = [result[next], result[index]];
  return result;
}
