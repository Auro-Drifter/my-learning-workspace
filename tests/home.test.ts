import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appearanceSchema, defaultAppearance } from '../shared/appearance.ts';
import { defaultHome, finishFocus, focusRemaining, getHomeLayout, homeSchema, localDay, recordDay, streak } from '../shared/home.ts';
import { homeWidgetIds } from '../shared/homeWidgets.ts';
import { parseDashboardImport } from '../src/features/home/homeImport.ts';
import { noteSection } from '../src/features/home/homeNotes.ts';
import { defaultPluginLibrary, installPlugin } from '../shared/plugins.ts';
import { emptyCourse, workspaceSchema } from '../shared/workspace.ts';
import { appearanceVariables, contrast, fonts } from '../src/features/settings/appearanceStyle.ts';

test('old workspace configuration opens with presentation and home defaults', () => {
  const { navigationPath: previousPath, ...legacyCourse } = emptyCourse('linear-algebra', '线性代数');
  assert.deepEqual(previousPath, ['数学基础']);
  const legacy = { schemaVersion: 1, activeCourseId: legacyCourse.id, courses: [legacyCourse] };
  const valid = workspaceSchema.parse(legacy);
  assert.deepEqual(valid.courses[0].navigationPath, ['数学基础']);
  assert.deepEqual(valid.appearance, defaultAppearance);
  assert.deepEqual(valid.home, defaultHome);
  valid.courses[0].navigationPath = [];
  assert.deepEqual(workspaceSchema.parse(valid).courses[0].navigationPath, []);
  valid.courses[0].navigationPath = ['非法/层级'];
  assert.equal(workspaceSchema.safeParse(valid).success, false);
});

test('home layout preserves card choices and validates persisted entries', () => {
  const plugin = installPlugin({
    format: 'mlw-plugin', apiVersion: 1, id: 'counter', name: '计数器', version: '1.0.0',
    description: '', fields: [], code: 'return { view: [] };',
  });
  const library = { ...defaultPluginLibrary, packages: [plugin] };
  const layout = getHomeLayout(undefined, library);
  assert.deepEqual(layout.map(({ id }) => id), ['welcome', 'habits', 'focus', 'tasks', ...homeWidgetIds, 'plugin:counter']);
  assert.equal(homeWidgetIds.length, 13);
  assert.ok(layout.slice(4).every(({ hidden }) => hidden));
  assert.equal(layout.at(-1)?.hidden, true);
  const options = { ...defaultHome, layout: [{ id: 'habits', columns: 8, hidden: true }, ...layout.filter(({ id }) => id !== 'habits')] };
  const restored = homeSchema.parse(JSON.parse(JSON.stringify(options)));
  assert.deepEqual(restored, options);
  assert.deepEqual(getHomeLayout(restored.layout, { ...library, packages: [{ ...plugin, showOnHome: true }] }).at(-1),
    { id: 'plugin:counter', columns: 6, hidden: false });
  assert.equal(homeSchema.safeParse({ ...options, layout: [...layout, layout[0]] }).success, false);
  assert.equal(homeSchema.safeParse({ ...options, layout: [{ ...layout[0], columns: 13 }] }).success, false);
});

test('homepage imports actual field shapes from the three Obsidian integration sources', () => {
  const parse = (kind: Parameters<typeof parseDashboardImport>[0], value: unknown) =>
    parseDashboardImport(kind, [{ name: 'fixture.json', text: JSON.stringify(value) }]);
  const schedule = parse('duowei', { fields: [
    { id: 'title', name: '任务' }, { id: 'date', name: '截止日期' },
    { id: 'state', name: '状态', options: [{ id: 'closed', name: '已完成' }] },
  ], records: [{ id: 'x', values: { title: '复习矩阵', date: '2026-11-18', state: 'closed' }, notePath: '复习/矩阵.md' }] });
  assert.deepEqual(schedule.entries.map(({ title, at, status, path }) => [title, at, status, path]),
    [['复习矩阵', '2026-11-18', '已完成', '复习/矩阵.md']]);
  const questions = parse('annotations', { questions: { q1: {
    stem: '说明特征值', answer: '示例答案', review: { dueAt: 1_800_000_000_000 }, sources: [{ path: '../private.md' }],
  } } });
  assert.equal(questions.entries[0].status, '待复习');
  assert.equal(questions.entries[0].path, undefined);
  const inbox = parse('wechat', { key: 'receipt1', message: { title: '今日学习', transcript: '录音文本', receivedAt: '2026-11-16T13:00:00Z' },
    receipts: { 'notes:a': { path: '收件箱/今天.md' } } });
  assert.equal(inbox.entries[0].body, '录音文本');
  assert.equal(inbox.entries[0].path, '收件箱/今天.md');
  assert.throws(() => parse('wechat', { bogus: [] }), /WeChat2Ob/u);
  const saved = homeSchema.parse({ ...defaultHome, widgets: {
    countdown: { title: '期末', date: '2026-12-01', elapsed: false },
    wechat: { source: 'fixture.json', entries: inbox.entries },
  } });
  assert.equal(saved.widgets?.wechat?.entries[0].title, '今日学习');
});

test('embedded note selects the correct section and preserves fenced heading text', () => {
  const note = ['---', 'title: tags', '---', '# 上一节', '文本', '## 目标', '```md', '## 示例标题', '```', '### 例子', '正文', '## 下一节'].join('\n');
  assert.equal(noteSection(note, '目标'), ['## 目标', '```md', '## 示例标题', '```', '### 例子', '正文'].join('\n'));
  assert.equal(noteSection(note, '示例标题'), undefined);
  assert.equal(noteSection(note, '')?.startsWith('# 上一节'), true);
});

test('home validates habit references and calculates its streak from real local dates', () => {
  const now = new Date(2026, 10, 16, 12);
  const home = structuredClone(defaultHome);
  home.checkIns = recordDay(home.checkIns, '2026-11-14', ['read']);
  home.checkIns = recordDay(home.checkIns, '2026-11-15', ['practice']);
  assert.equal(streak(home, now), 2);
  home.checkIns = recordDay(home.checkIns, localDay(now), ['review']);
  assert.equal(streak(home, now), 3);
  assert.equal(homeSchema.safeParse(home).success, true);
  home.checkIns = recordDay(home.checkIns, localDay(now), ['missing']);
  assert.equal(homeSchema.safeParse(home).success, false);
});

test('focus completion uses the saved deadline and counts each focus session once', () => {
  const home = structuredClone(defaultHome);
  const end = new Date(2026, 10, 16, 12).getTime();
  home.timer = { ...home.timer, deadline: end, label: '复习' };
  assert.equal(focusRemaining(home.timer, end - 35_100), 36);
  assert.equal(finishFocus(home, end - 1), home);
  const completed = finishFocus(home, end + 1000);
  assert.equal(completed.focusHistory['2026-11-16'], 1);
  assert.equal(finishFocus(completed, end + 1000), completed);
  assert.equal(completed.timer.seconds, 0);
  const breakTimer = { ...completed, timer: { ...completed.timer, mode: 'short' as const, deadline: end } };
  assert.deepEqual(finishFocus(breakTimer, end + 1000).focusHistory, completed.focusHistory);
});

test('appearance font choices have distinct Chinese faces before their shared fallbacks', () => {
  assert.equal(new Set(Object.values(fonts).map(({ stack }) => stack)).size, 4);
  for (const [key, family] of Object.entries({ system: '"Microsoft YaHei UI"', sans: 'DengXian', serif: 'SimSun', mono: 'SimHei' })) {
    const stack = fonts[key as keyof typeof fonts].stack;
    assert.ok(stack.includes(family), key + ' includes ' + family);
    const sharedFallback = stack.indexOf('"Microsoft YaHei UI"');
    if (key !== 'system' && sharedFallback >= 0) assert.ok(stack.indexOf(family) < sharedFallback, key + ' uses its Chinese face first');
  }
});

test('appearance text and buttons retain contrast on custom light and dark colors', () => {
  for (const background of ['#f6f5f1', '#13151a', '#777777', '#787878', '#ff0000', '#003911']) {
    const variables = appearanceVariables({ ...defaultAppearance, background, accent: background });
    for (const color of [variables['--text'], variables['--muted'], variables['--accent'], variables['--danger']]) {
      for (const surface of ['--canvas', '--surface', '--sidebar', '--input', '--accent-soft'] as const) {
        assert.ok(contrast(color, variables[surface]) >= 4.5, color + ' on ' + variables[surface]);
      }
    }
    assert.ok(contrast(variables['--primary'], variables['--primary-text']) >= 4.5);
  }
});

test('older appearance settings receive glass defaults with their existing color and font', () => {
  const previous = { background: '#211e2a', accent: '#b59cf6', fontFamily: 'serif', fontSize: 17 };
  assert.deepEqual(appearanceSchema.parse(previous), { ...previous, dialogTransparency: null, dialogTint: null });
  assert.equal(appearanceSchema.safeParse({ ...previous, dialogTransparency: 41 }).success, false);
  assert.equal(appearanceSchema.safeParse({ ...previous, dialogTint: 'transparent' }).success, false);
});

test('glass dialog foreground colors retain contrast at maximum transparency', () => {
  for (const background of ['#f6f5f1', '#13151a', '#777777', '#787878']) {
    for (const dialogTint of [null, '#000000', '#ffffff', '#b419fa']) {
      const variables = appearanceVariables({ ...defaultAppearance, background, dialogTint, dialogTransparency: 40 });
      assert.equal(variables['--glass-opacity'], '60%');
      const dark = variables['--scheme'] === 'dark';
      const glassBase = variables['--glass-base'];
      const [red, green, blue, amount] = variables['--glass-scrim'].match(/[\d.]+/gu)!.map(Number);
      const throughGlass = '#' + [red, green, blue].map((scrimChannel, index) => {
        const base = parseInt(glassBase.slice(1 + index * 2, 3 + index * 2), 16);
        const backdrop = Math.round(scrimChannel * amount + (dark ? 255 * (1 - amount) : 0));
        const blended = Math.round(base * .6 + backdrop * .4);
        return Math.round(dark ? blended * .93 + 255 * .07 : blended).toString(16).padStart(2, '0');
      }).join('');
      for (const color of ['--glass-text', '--glass-muted', '--glass-accent', '--glass-danger'] as const) {
        assert.ok(contrast(variables[color], throughGlass) >= 4.5, color + ' on ' + throughGlass);
      }
    }
  }
});
