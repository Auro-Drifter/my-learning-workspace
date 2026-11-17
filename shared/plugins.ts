import { z } from 'zod';
import { idSchema, titleSchema } from './actions.ts';

export const builtinPlugins = {
  welcome: '首页欢迎横幅',
  habits: '习惯打卡',
  focus: '番茄钟',
  quickLinks: '快捷入口',
  text: '学习备注',
  fileLibrary: '文件目录',
  tasks: '作业与任务',
  study: '手动学习进度',
} as const;

export type BuiltinPlugin = keyof typeof builtinPlugins;
const builtinSchema = z.enum(Object.keys(builtinPlugins) as [BuiltinPlugin, ...BuiltinPlugin[]]);

const dataKeySchema = idSchema.refine((key) => !['__proto__', 'prototype', 'constructor'].includes(key), '字段名保留');
const fieldBase = { key: dataKeySchema, label: titleSchema };
const fieldSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...fieldBase, kind: z.literal('text'), default: z.string().max(500) }),
  z.strictObject({ ...fieldBase, kind: z.literal('number'), default: z.number().finite().min(-1e9).max(1e9) }),
  z.strictObject({ ...fieldBase, kind: z.literal('checkbox'), default: z.boolean() }),
  z.strictObject({ ...fieldBase, kind: z.literal('date'), default: z.union([z.literal(''), z.iso.date()]) }),
]);

export const pluginPackageSchema = z.strictObject({
  format: z.literal('mlw-plugin'),
  apiVersion: z.literal(1),
  id: idSchema,
  name: titleSchema,
  version: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/u),
  description: z.string().max(800),
  fields: z.array(fieldSchema).max(12),
  code: z.string().trim().min(1).max(24_000),
}).refine(({ fields }) => new Set(fields.map((field) => field.key)).size === fields.length, '插件字段名重复');
export type PluginPackage = z.infer<typeof pluginPackageSchema>;

export const pluginValuesSchema = z.record(dataKeySchema, z.union([
  z.string().max(1200), z.number().finite().min(-1e9).max(1e9), z.boolean(),
])).refine((values) => Object.keys(values).length <= 32, '插件数据字段超过上限');
export type PluginValues = z.infer<typeof pluginValuesSchema>;

const slotSchema = z.strictObject({ settings: pluginValuesSchema, state: pluginValuesSchema });
export type PluginSlot = z.infer<typeof slotSchema>;

export const pluginLibrarySchema = z.strictObject({
  disabledBuiltins: z.array(builtinSchema).max(Object.keys(builtinPlugins).length)
    .refine((items) => new Set(items).size === items.length),
  packages: z.array(z.strictObject({
    manifest: pluginPackageSchema,
    enabled: z.boolean(),
    showOnHome: z.boolean(),
    home: slotSchema,
  })).max(16).refine((items) => new Set(items.map(({ manifest }) => manifest.id)).size === items.length, '插件 ID 重复'),
});
export type PluginLibrary = z.infer<typeof pluginLibrarySchema>;
export type InstalledPlugin = PluginLibrary['packages'][number];

export const defaultPluginLibrary: PluginLibrary = { packages: [], disabledBuiltins: [] };

export const pluginWidgetConfigSchema = slotSchema.extend({ pluginId: idSchema });

export function defaultSlot(plugin: PluginPackage): PluginSlot {
  return { settings: Object.fromEntries(plugin.fields.map(({ key, default: value }) => [key, value])), state: {} };
}

export function installPlugin(manifest: PluginPackage): InstalledPlugin {
  return { manifest, enabled: true, showOnHome: false, home: defaultSlot(manifest) };
}

const viewNode = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), text: z.string().max(1200) }),
  z.strictObject({ kind: z.literal('metric'), value: z.string().max(80), label: z.string().max(120) }),
  z.strictObject({ kind: z.literal('button'), id: idSchema, label: titleSchema }),
]);
export const pluginResultSchema = z.strictObject({
  view: z.array(viewNode).max(15),
  state: pluginValuesSchema.optional(),
});
export type PluginResult = z.infer<typeof pluginResultSchema>;
