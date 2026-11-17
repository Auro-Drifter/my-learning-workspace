import type { PluginPackage } from '../../../shared/plugins.ts';

export const bundledPlugins: PluginPackage[] = [
  {
    format: 'mlw-plugin', apiVersion: 1, id: 'learning-counter', name: '学习计数器', version: '1.0.0',
    description: '记录练习、页数或本周做过的题。每个组件各自保存计数。',
    fields: [{ key: 'unit', label: '计数单位', kind: 'text', default: '完成次数' }],
    code: [
      "const current = Number(input.state.count ?? 0);",
      "const count = input.action === 'add' ? Math.min(1000000, current + 1) : input.action === 'remove' ? Math.max(0, current - 1) : current;",
      "return { state: { count }, view: [",
      "  { kind: 'metric', value: String(count), label: String(input.settings.unit || '完成次数') },",
      "  { kind: 'button', id: 'add', label: '加一' },",
      "  { kind: 'button', id: 'remove', label: '减一' },",
      "] };",
    ].join('\n'),
  },
  {
    format: 'mlw-plugin', apiVersion: 1, id: 'study-countdown', name: '目标倒计时', version: '1.0.0',
    description: '用真实日期计算距离考试、提交或阅读目标还有几天。',
    fields: [
      { key: 'goal', label: '目标名称', kind: 'text', default: '考试' },
      { key: 'date', label: '目标日期', kind: 'date', default: '' },
    ],
    code: [
      "const date = String(input.settings.date || '');",
      "if (!date) return { view: [{ kind: 'text', text: '请先在组件配置中选择目标日期。' }] };",
      "const now = new Date(input.today);",
      "const from = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());",
      "const days = Math.round((Date.parse(date + 'T00:00:00Z') - from) / 86400000);",
      "if (!Number.isFinite(days)) return { view: [{ kind: 'text', text: '目标日期无效。' }] };",
      "return { view: [{ kind: 'metric', value: String(Math.abs(days)), label: input.settings.goal + (days < 0 ? ' · 已过天数' : ' · 剩余天数') }] };",
    ].join('\n'),
  },
];
