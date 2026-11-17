import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import type { Locator, Route } from 'playwright-core';
import { snapshotSchema } from '../shared/workspace.ts';
import type { Snapshot } from '../shared/workspace.ts';
import { homeWidgetCatalog } from '../shared/homeWidgets.ts';
import type { RootGrant } from '../shared/files.ts';

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}

async function start(directory: string, port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['server/main.ts'], {
    env: { ...process.env, MLW_DATA_DIR: directory, MLW_PORT: String(port) },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr?.on('data', (chunk) => { output += String(chunk); });
  const url = 'http://127.0.0.1:' + port + '/api/workspace';
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) break;
      if (await fetch(url).then((response) => response.ok).catch(() => false)) return child;
      await delay(50);
    }
    throw new Error('本地服务未启动。' + output);
  } catch (error) {
    await stop(child);
    throw error;
  }
}

const bind = (server: ReturnType<typeof createServer>) => new Promise<number>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (typeof address === 'object' && address) resolve(address.port);
    else reject(new Error('Missing port'));
  });
});

let pluginProbeHits = 0;
const fixture = createServer((request, response) => {
  if (request.url === '/plugin-isolation-probe') pluginProbeHits++;
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><title>测试讲义</title><h1>浏览器已打开实际讲义</h1>');
});
const fixturePort = await bind(fixture);
const portReservation = createServer();
const port = await bind(portReservation);
await new Promise<void>((resolve) => portReservation.close(() => resolve()));
const sandbox = await mkdtemp(join(tmpdir(), 'mlw-e2e-'));
const directory = join(sandbox, 'app-data');
// A Windows folder may end in a non-breaking space. Preserve the picker's exact path.
const notesDirectory = join(sandbox, 'test-material\u00a0');
const restoredDirectory = join(sandbox, 'restored-data');
await mkdir(notesDirectory);
const notePath = join(notesDirectory, '测试原文.md');
const noteSource = '\uFEFF---\r\ntitle: 测试原文\n---\r\n\r\n[[双链]]\r\n![[图示.png]]\r\n\r\n- [ ] 示例\r\n\r\n$x^2$';
await writeFile(notePath, noteSource);
const origin = 'http://127.0.0.1:' + port;
const destination = 'http://127.0.0.1:' + fixturePort + '/lecture';
let child: ChildProcess | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

try {
  child = await start(directory, port);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1250 } });
  const page = await context.newPage();
  await page.clock.install({ time: new Date(2026, 10, 16, 21, 48) });
  page.setDefaultTimeout(6000);
  page.on('dialog', (dialog) => void dialog.accept());
  const uncaught: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 400) {
      void response.text().then((body) => console.error(response.request().method(), response.status(), response.url(), body)).catch(() => {});
    }
  });
  page.on('pageerror', (error) => uncaught.push(error.message));
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const treeOption = async (name: string) => {
    await button('课程树选项').click();
    await page.getByRole('menu', { name: '课程树选项', exact: true }).getByRole('menuitem', { name, exact: true }).click();
  };
  const layoutOption = async (name: string) => {
    await button('布局选项').click();
    await page.getByRole('menu', { name: '布局选项', exact: true }).getByRole('menuitem', { name, exact: true }).click();
  };
  const widgetOption = async (widget: Locator, name: string) => {
    const trigger = widget.getByRole('button', { name: /的更多操作$/u });
    const label = (await trigger.getAttribute('aria-label'))!;
    await trigger.click();
    await page.getByRole('menu', { name: label, exact: true }).getByRole('menuitem', { name, exact: true }).click();
  };
  const tab = (name: string) => page.getByRole('tab', { name, exact: true });
  const management = () => button('课程管理');
  const courseMenu = () => page.getByRole('menu', { name: '课程管理' });
  const courseAction = (name: string) => courseMenu().getByRole('menuitem', { name, exact: true });
  const courseLink = (name: string) => page.getByRole('navigation', { name: '课程列表' }).getByRole('link', { name, exact: true });
  const homeLink = () => page.locator('#course-sidebar').getByRole('link', { name: '首页', exact: true });
  const heading = (name: string) => page.getByRole('heading', { name, exact: true });
  const saved = () => page.getByText('已保存', { exact: true }).waitFor();
  const workspaceApi = origin + '/api/workspace';
  const inspectWorkspaceWrite = async (action: () => Promise<void>, inspect: () => Promise<void>) => {
    const release = Promise.withResolvers<void>();
    await page.route(workspaceApi, async (route) => {
      await release.promise;
      await route.continue();
    }, { times: 1 });
    const request = page.waitForRequest((request) => request.url() === workspaceApi && request.method() === 'PUT');
    const [response] = await Promise.all([
      page.waitForResponse((response) => response.url() === workspaceApi && response.request().method() === 'PUT'),
      (async () => {
        try {
          await Promise.all([action(), request]);
          await inspect();
        } finally {
          release.resolve();
        }
      })(),
    ]);
    assert.ok(response.ok());
  };
  const read = async () => snapshotSchema.parse(JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8')));
  const move = async (locator: Locator, dx: number, dy: number, offset = 4, inspect?: () => Promise<void>) => {
    const box = await locator.boundingBox();
    assert.ok(box, 'The layout handle should be visible');
    const x = box.x + offset;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 16 });
    await inspect?.();
    await page.mouse.up();
  };

  await page.goto(origin);
  const nav = page.getByRole('navigation', { name: '课程列表' });
  const math = nav.getByRole('button', { name: '数学基础', exact: true });
  const programming = nav.getByRole('button', { name: '编程入门', exact: true });
  const cDirection = nav.getByRole('button', { name: 'C 方向', exact: true });
  await page.getByRole('heading', { name: '习惯打卡' }).waitFor();
  assert.equal(await nav.locator('.course-nav-course').count(), 5);
  assert.equal(await math.getAttribute('aria-expanded'), 'true');
  assert.equal(await programming.getAttribute('aria-expanded'), 'false');
  await programming.click();
  await cDirection.press('Enter');
  assert.equal(await cDirection.getAttribute('aria-expanded'), 'true');
  assert.equal(await math.getAttribute('aria-expanded'), 'true');
  await programming.click();
  await courseLink('CS50x').waitFor({ state: 'hidden' });
  await page.getByRole('searchbox', { name: '搜索课程' }).fill('CS50x');
  await courseLink('CS50x').waitFor();
  await page.getByRole('searchbox', { name: '搜索课程' }).clear();
  await courseLink('CS50x').waitFor({ state: 'hidden' });
  await programming.click();
  await courseLink('CS50x').waitFor();
  await button('收起课程').click();
  await nav.waitFor({ state: 'hidden' });
  await button('展开课程').click();
  await courseLink('CS50x').waitFor();

  await page.keyboard.press('Control+k');
  const jump = page.getByRole('dialog', { name: '快速跳转' });
  const lookup = jump.getByRole('combobox', { name: '搜索课程' });
  await lookup.fill('编程');
  await lookup.press('ArrowDown');
  const selectedJump = await jump.getByRole('option', { selected: true }).textContent();
  assert.match(selectedJump ?? '', /CS50x/u);
  const saveStatus = page.locator('.save-status');
  const statusPosition = await saveStatus.boundingBox();
  assert.ok(statusPosition);
  const queuedTask = '后台写入期间创建的任务';
  const [taskResponse] = await Promise.all([
    page.waitForResponse((response) => response.url() === workspaceApi
      && response.request().method() === 'PUT' && !!response.request().postData()?.includes(queuedTask)),
    inspectWorkspaceWrite(() => lookup.press('Enter'), async () => {
      await heading('CS50x').waitFor();
      assert.equal(new URL(page.url()).hash, '#course/cs50x');
      await page.waitForFunction(() => document.activeElement?.id === 'workspace-main');
      assert.equal(await saveStatus.textContent(), '已保存');
      assert.deepEqual(await saveStatus.boundingBox(), statusPosition);
      assert.ok(await button('编辑布局').isEnabled());
      await button('编辑布局').click();
      assert.ok(await button('添加组件').isEnabled());
      assert.ok(await button('配置').first().isEnabled());
      const first = page.locator('article').filter({ has: heading('Lecture 与 Problem Sets') });
      const second = page.locator('article').filter({ has: heading('代码工具') });
      const firstPosition = await first.boundingBox();
      const secondPosition = await second.boundingBox();
      assert.ok(firstPosition && secondPosition);
      await move(first.locator('.drag-handle'), secondPosition.x - firstPosition.x, 0, 4, async () => {
        await page.locator('.react-grid-placeholder').waitFor();
        const preview = await first.boundingBox();
        assert.ok(preview && Math.abs(preview.x - secondPosition.x) < 3);
      });
      await page.waitForFunction((left) => {
        const card = [...document.querySelectorAll('article.widget')].find((element) => element.querySelector('h3')?.textContent === '代码工具');
        return card && Math.abs(card.getBoundingClientRect().left - left) < 1;
      }, firstPosition.x);
      assert.ok(Math.abs((await first.boundingBox())!.x - secondPosition.x) < 1);
      await button('撤销').click();
      await widgetOption(first, '隐藏');
      await heading('隐藏的组件').waitFor();
      await button('撤销').click();
      await layoutOption('退出编辑');
      assert.ok(await button('新建任务').isEnabled());
      await button('新建任务').click();
      await page.getByLabel('任务标题').fill(queuedTask);
      await button('保存任务').click();
      await page.getByText('正在保存…', { exact: true }).waitFor();
      assert.equal((await read()).workspace.activeCourseId, 'linear-algebra');
      assert.ok(!(await read()).workspace.courses.find(({ id }) => id === 'cs50x')?.tasks.length);
    }),
  ]);
  assert.ok(taskResponse.ok());
  await saved();
  const afterQueuedTask = (await read()).workspace;
  assert.equal(afterQueuedTask.activeCourseId, 'cs50x');
  assert.equal(afterQueuedTask.courses.find(({ id }) => id === 'cs50x')?.tasks[0].title, queuedTask);

  const vsCode = page.getByRole('link', { name: 'VS Code 网页版', exact: true });
  const copy = button('复制 VS Code 网页版 的地址');
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async (url: string) => { document.body.dataset.copiedAddress = url; },
    });
  });
  const copyPosition = await copy.boundingBox();
  const linkPosition = await vsCode.boundingBox();
  assert.equal(await copy.textContent(), '复制');
  await copy.click();
  await page.getByText('已复制', { exact: true }).waitFor();
  assert.equal(await page.locator('body').getAttribute('data-copied-address'), 'https://vscode.dev/');
  assert.deepEqual(await copy.boundingBox(), copyPosition);
  assert.deepEqual(await vsCode.boundingBox(), linkPosition);
  await page.clock.runFor(1650);
  assert.equal(await copy.textContent(), '复制');
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true, value: async () => { throw new Error('Test: clipboard unavailable'); },
    });
  });
  await copy.click();
  assert.equal(await page.getByRole('textbox', { name: '手动复制地址' }).inputValue(), 'https://vscode.dev/');
  await page.evaluate(() => Reflect.deleteProperty(navigator.clipboard, 'writeText'));
  await page.goBack();
  await heading('习惯打卡').waitFor();
  await page.goForward();
  await heading('CS50x').waitFor();
  await saved();
  await homeLink().click();
  await heading('习惯打卡').waitFor();
  await page.route(workspaceApi, (route) => route.fulfill({
    status: 503, json: { code: 'write_failed', message: '测试：无法写入最近课程' },
  }), { times: 1 });
  await courseLink('线性代数').click();
  await heading('线性代数').waitFor();
  await page.getByRole('alert').getByText('测试：无法写入最近课程').waitFor();
  assert.equal(await saveStatus.textContent(), '有未保存的更改');
  assert.deepEqual(await saveStatus.boundingBox(), statusPosition);
  assert.equal((await read()).workspace.activeCourseId, 'cs50x');
  await inspectWorkspaceWrite(() => button('重试保存').click(), async () => {
    await page.getByText('正在保存…', { exact: true }).waitFor();
    assert.deepEqual(await saveStatus.boundingBox(), statusPosition);
  });
  await saved();
  assert.equal((await read()).workspace.activeCourseId, 'linear-algebra');
  await courseLink('CS50x').click();
  await courseLink('微积分').click();
  await heading('微积分').waitFor();
  assert.equal(await courseLink('微积分').getAttribute('aria-current'), 'page');
  assert.equal(await heading('CS50x').count(), 0);
  await page.goBack();
  await heading('CS50x').waitFor();
  await page.goForward();
  await heading('微积分').waitFor();
  const courseFrames = await courseLink('线性代数').evaluate((link) => {
    const main = document.querySelector('#workspace-main')!;
    const sidebar = document.querySelector('#course-sidebar')!;
    const frames: { title?: string; positions: (number | undefined)[] }[] = [];
    const track = (element: Element | null) => {
      const rect = element?.getBoundingClientRect();
      return [rect?.left, rect?.top, rect?.width];
    };
    (link as HTMLElement).click();
    return new Promise<typeof frames>((resolve) => {
      function recordFrame() {
        const title = main.querySelector('h1');
        frames.push({ title: title?.textContent ?? undefined, positions: [
          ...track(title), ...track(main.querySelector('.widget')), ...track(sidebar),
        ] });
        if (frames.length < 16) requestAnimationFrame(recordFrame);
        else resolve(frames);
      }
      requestAnimationFrame(recordFrame);
    });
  });
  const settled = courseFrames.at(-1)!;
  for (const [index, frame] of courseFrames.entries()) {
    assert.equal(frame.title, '线性代数', 'The new course renders by the first frame');
    for (const [position, value] of frame.positions.entries()) {
      const target = settled.positions[position];
      assert.ok(value !== undefined && target !== undefined && Math.abs(value - target) <= .1,
        'Course frame ' + (index + 1) + ', position ' + position + ' moved from ' + value + ' to ' + target);
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await courseLink('线性代数').evaluate((link) => getComputedStyle(link).transitionProperty), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await saved();
  await homeLink().click();
  await heading('习惯打卡').waitFor();

  await button('首页设置').click();
  await page.getByLabel('称呼（选填）').fill('Auro');
  await button('保存首页设置').click();
  await page.getByRole('heading', { name: /Auro/u }).waitFor();
  await saved();
  await button('阅读').click();
  await saved();
  assert.equal(await button('阅读').getAttribute('aria-pressed'), 'true');
  const cardOrder = () => page.locator('[data-home-card]').evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-home-card')));
  const savedHomeBeforeEdit = (await read()).workspace.home;
  await button('编辑首页').click();
  await button('移动番茄钟').dragTo(page.locator('[data-home-card="habits"]'));
  assert.deepEqual(await cardOrder(), ['welcome', 'focus', 'habits', 'tasks']);
  await button('移动番茄钟').press('ArrowUp');
  assert.deepEqual(await cardOrder(), ['focus', 'welcome', 'habits', 'tasks']);
  await page.getByLabel('番茄钟宽度').selectOption('8');
  await button('移出首页 · 习惯打卡').click();
  assert.deepEqual(await cardOrder(), ['focus', 'welcome', 'tasks']);
  assert.deepEqual((await read()).workspace.home, savedHomeBeforeEdit, 'Homepage editing stays in the draft');
  await courseLink('线性代数').click();
  await heading('线性代数').waitFor();
  await homeLink().click();
  await button('保存首页布局').click();
  await saved();
  await page.reload();
  await heading('番茄钟').waitFor();
  assert.deepEqual(await cardOrder(), ['focus', 'welcome', 'tasks']);
  assert.deepEqual((await read()).workspace.home.layout?.[0], { id: 'focus', columns: 8, hidden: false });
  await button('编辑首页').click();
  await button('添加组件').click();
  await page.getByRole('menuitem', { name: '习惯打卡', exact: true }).click();
  await heading('习惯打卡').waitFor();
  await button('取消').click();
  await heading('习惯打卡').waitFor({ state: 'hidden' });
  await button('编辑首页').click();
  await button('恢复默认布局').click();
  await button('保存首页布局').click();
  await saved();
  assert.deepEqual(await cardOrder(), ['welcome', 'habits', 'focus', 'tasks']);
  assert.equal(await button('阅读').getAttribute('aria-pressed'), 'true');
  await button('欢迎横幅设置').click();
  await page.getByRole('checkbox', { name: '显示时钟' }).uncheck();
  await button('保存首页设置').click();
  await saved();
  await page.reload();
  await heading('欢迎横幅').waitFor();
  assert.equal(await page.locator('.welcome-clock').count(), 0);
  await button('欢迎横幅设置').click();
  await page.getByRole('checkbox', { name: '显示时钟' }).check();
  await button('保存首页设置').click();
  await saved();
  console.log('Edge E2E · 首页拖拽、键盘排序、宽度、移除与添加、跨页草稿、保存和恢复通过。');
  await button('近 30 天').click();
  await page.getByRole('region', { name: '近 30 天的打卡记录' }).waitFor();
  await button('近一年').click();
  await page.getByLabel('这段时间要做什么？').fill('复习线性代数');
  await button('开始').click();
  await button('暂停').waitFor();
  await saved();
  await page.clock.fastForward(60_000);
  await button('暂停').click();
  await saved();
  const paused = (await read()).workspace.home.timer;
  assert.ok(paused.seconds < 1500 && paused.label === '复习线性代数');
  assert.equal(paused.deadline, null);
  await button('继续').click();
  await saved();
  const deadline = (await read()).workspace.home.timer.deadline;
  assert.ok(deadline);
  await page.getByRole('button', { name: /继续学习.*线性代数/u }).click();
  await page.getByRole('heading', { name: '线性代数', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: '线性代数', exact: true }).waitFor();
  await homeLink().click();
  await button('暂停').waitFor();
  assert.equal((await read()).workspace.home.timer.deadline, deadline);
  await page.clock.fastForward(1_501_000);
  await page.getByText('今日 1 · 本周 1', { exact: true }).waitFor();
  await saved();
  assert.equal((await read()).workspace.home.timer.seconds, 0);
  await button('重置').click();
  await saved();

  const getDocumentStyle = () => page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return { background: style.backgroundColor, fontSize: style.fontSize, fontFamily: style.fontFamily };
  });
  const defaultStyle = await getDocumentStyle();
  await button('设置').click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  const fontChoice = page.getByRole('combobox', { name: '字体', exact: true });
  for (const [value, expected] of [['system', 'Segoe UI'], ['sans', 'DengXian'], ['serif', 'Georgia'], ['mono', 'Cascadia Mono']] as const) {
    await fontChoice.selectOption(value);
    const previewStyle = await getDocumentStyle();
    assert.ok(previewStyle.fontFamily.includes(expected), value + ' previews ' + expected);
    assert.equal(await settings.evaluate((element) => getComputedStyle(element).fontFamily), previewStyle.fontFamily);
    assert.equal(await fontChoice.evaluate((element) => getComputedStyle(element).fontFamily), previewStyle.fontFamily);
  }
  await fontChoice.selectOption('system');
  const fontSize = page.getByRole('combobox', { name: '文字大小', exact: true });
  await fontSize.selectOption('16');
  assert.equal((await getDocumentStyle()).fontSize, '16px');
  await fontSize.selectOption('15');
  const glassMedia = await context.newCDPSession(page);
  const glassStyle = () => settings.evaluate((element) => {
    const style = getComputedStyle(element);
    return { opacity: style.getPropertyValue('--glass-opacity').trim(), filter: style.backdropFilter, tint: style.getPropertyValue('--glass-base').trim() };
  });
  const transparency = settings.getByRole('slider', { name: '透明度', exact: true });
  await glassMedia.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  assert.equal(await transparency.inputValue(), '0');
  assert.equal((await glassStyle()).filter, 'none');
  await transparency.press('End');
  assert.match((await glassStyle()).filter, /blur\(18px\)/u);
  await button('跟随系统').click();
  assert.equal(await transparency.inputValue(), '0');
  assert.equal((await glassStyle()).filter, 'none');
  await glassMedia.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] });
  await page.waitForFunction(() => !matchMedia('(prefers-reduced-transparency: reduce)').matches);
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('dialog[open] input[type=range]')?.value === '24');
  await transparency.press('Home');
  assert.equal((await glassStyle()).opacity, '100%');
  assert.equal((await glassStyle()).filter, 'none');
  const selectorHeight = await settings.evaluate((element) => element.clientHeight);
  await tab('外观').press('ArrowRight');
  await page.getByRole('tabpanel', { name: '插件' }).waitFor();
  assert.equal(await tab('插件').getAttribute('aria-selected'), 'true');
  assert.equal(await settings.evaluate((element) => element.clientHeight), selectorHeight);
  await tab('插件').press('End');
  await page.getByRole('tabpanel', { name: '备份与恢复' }).waitFor();
  await tab('备份与恢复').press('Home');
  await button('夜读').click();
  assert.equal((await getDocumentStyle()).background, 'rgb(32, 30, 35)');
  await button('关闭').click();
  assert.deepEqual(await getDocumentStyle(), defaultStyle);
  await button('设置').click();
  await button('夜读').click();
  await page.getByText('输入颜色代码（选填）', { exact: true }).click();
  await page.getByLabel('背景色代码').fill('#211e2a');
  await page.getByLabel('按钮颜色代码').fill('#c8adff');
  const glassSlider = settings.getByRole('slider', { name: '透明度', exact: true });
  await glassSlider.press('End');
  const themeGlass = await glassStyle();
  await settings.getByLabel('弹窗底色', { exact: true }).fill('#132f3b');
  const glassPreview = await glassStyle();
  assert.equal(glassPreview.opacity, '60%');
  assert.match(glassPreview.filter, /blur\(18px\)/u);
  assert.notEqual(glassPreview.tint, themeGlass.tint);
  await button('跟随主题').click();
  assert.deepEqual(await glassStyle(), themeGlass);
  await settings.getByLabel('弹窗底色', { exact: true }).fill('#132f3b');
  await page.getByRole('combobox', { name: '文字大小' }).selectOption('17');
  await page.getByRole('combobox', { name: '字体' }).selectOption('serif');
  await button('保存外观').click();
  await page.getByText('外观已保存', { exact: true }).waitFor();
  await button('关闭').click();
  await page.reload();
  await page.getByRole('heading', { name: /Auro/u }).waitFor();
  assert.equal(await button('阅读').getAttribute('aria-pressed'), 'true');
  const changedStyle = await getDocumentStyle();
  assert.equal(changedStyle.background, 'rgb(33, 30, 42)');
  assert.equal(changedStyle.fontSize, '17px');
  assert.match(changedStyle.fontFamily, /Georgia/u);
  assert.equal((await read()).workspace.appearance.dialogTransparency, 40);
  assert.equal((await read()).workspace.appearance.dialogTint, '#132f3b');
  await button('设置').click();
  assert.deepEqual(await glassStyle(), glassPreview);
  await button('关闭').click();
  const darkRail = await math.evaluate((element) => getComputedStyle(element).color);
  const darkText = await page.evaluate(() => getComputedStyle(document.documentElement).color);
  assert.equal(darkRail, darkText);
  if (process.env.MLW_DARK_PREVIEW) await page.screenshot({
    path: process.env.MLW_DARK_PREVIEW, clip: { x: 0, y: 0, width: 1400, height: 820 },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.ok(await page.locator('.habit-scroll').evaluate((element) => element.scrollWidth > element.clientWidth));
  await button('展开课程').click();
  const drawer = page.getByRole('dialog', { name: '课程导航' });
  await drawer.waitFor();
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'hidden' });
  await button('展开课程').click();
  await courseLink('线性代数').click();
  await drawer.waitFor({ state: 'hidden' });
  await heading('线性代数').waitFor();
  await management().click();
  const menuOnMobile = await courseMenu().boundingBox();
  assert.ok(menuOnMobile && menuOnMobile.x >= 0 && menuOnMobile.x + menuOnMobile.width <= 390);
  await heading('线性代数').click();
  await courseMenu().waitFor({ state: 'hidden' });
  await page.getByRole('link', { name: 'My Learning Workspace 首页' }).click();
  await page.setViewportSize({ width: 1400, height: 1250 });
  await button('设置').click();
  await button('恢复默认外观').click();
  await button('保存外观').click();
  await page.getByText('外观已保存', { exact: true }).waitFor();
  await button('关闭').click();
  assert.deepEqual(await getDocumentStyle(), defaultStyle);
  if (process.env.MLW_LIGHT_PREVIEW) await page.screenshot({
    path: process.env.MLW_LIGHT_PREVIEW, clip: { x: 0, y: 0, width: 1400, height: 820 },
  });
  await button('管理组件').click();
  await settings.getByRole('tab', { name: '插件', exact: true, selected: true }).waitFor();
  await button('安装 学习计数器').click();
  await button('添加到首页').click();
  await page.getByRole('checkbox', { name: '番茄钟', exact: true }).uncheck();
  await saved();
  await button('关闭').click();
  await page.getByRole('heading', { name: '番茄钟' }).waitFor({ state: 'hidden' });
  const homeCounter = page.locator('section.home-card').filter({ has: page.getByRole('heading', { name: '学习计数器' }) });
  await homeCounter.getByText('0', { exact: true }).waitFor();
  await homeCounter.getByRole('button', { name: '加一' }).click();
  await homeCounter.getByText('1', { exact: true }).waitFor();
  await saved();
  await page.reload();
  await homeCounter.getByText('1', { exact: true }).waitFor();
  await button('编辑首页').click();
  await button('移出首页 · 学习计数器').click();
  await button('保存首页布局').click();
  await saved();
  await homeCounter.waitFor({ state: 'hidden' });
  await button('编辑首页').click();
  await button('添加组件').click();
  await page.getByRole('menuitem', { name: '学习计数器', exact: true }).click();
  await button('保存首页布局').click();
  await saved();
  await homeCounter.getByText('1', { exact: true }).waitFor();

  await button('设置').click();
  await tab('插件').click();
  await page.getByRole('checkbox', { name: '番茄钟', exact: true }).check();
  await saved();
  const ownPlugin = {
    format: 'mlw-plugin', apiVersion: 1, id: 'own-plugin-test', name: '隔离测试插件', version: '1.0.0',
    description: '用户导入的自动化测试包',
    fields: [{ key: 'detail', label: '插件文字', kind: 'text', default: '自写组件' }],
    code: [
      'if (input.action === "wait") await new Promise(() => {});',
      'let blocked = false;',
      'try { await fetch("' + 'http://127.0.0.1:' + fixturePort + '/plugin-isolation-probe", { mode: "no-cors" }); } catch { blocked = true; }',
      'return { view: [{ kind: "text", text: input.settings.detail + (blocked ? " · 联网已隔离" : " · 联网未隔离") }, { kind: "button", id: "wait", label: "测试超时" }] };',
    ].join('\n'),
  };
  await page.getByText('从本机安装插件', { exact: true }).click();
  await page.getByLabel('选择插件文件').setInputFiles({
    name: 'own.mlw-plugin.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(ownPlugin)),
  });
  await button('安装插件').click();
  await page.getByText('插件已安装', { exact: true }).waitFor();
  await button('关闭').click();
  await page.getByRole('heading', { name: '番茄钟' }).waitFor();
  await page.getByRole('button', { name: /继续学习.*线性代数/u }).click();
  await page.getByRole('heading', { name: '线性代数', exact: true }).waitFor();
  if (await programming.getAttribute('aria-expanded') === 'false') await programming.click();
  if (await cDirection.getAttribute('aria-expanded') === 'false') await cDirection.click();
  console.log('Edge E2E · 首页、侧栏层级、专注跨页恢复和自定义外观通过。');
  assert.equal(await page.getByRole('link', { name: 'VS Code 网页版' }).count(), 0);
  await courseLink('CS50x').click();
  await page.getByRole('link', { name: 'VS Code 网页版' }).waitFor();
  await saved();
  const cs50Before = (await read()).workspace.courses.find((course) => course.id === 'cs50x');
  await courseLink('线性代数').click();
  await button('编辑布局').click();
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: '课程资源', exact: true }) });
  const widgetId = await card.getAttribute('data-widget-id');
  const layout = async () => (await read()).workspace.courses[0].widgets.find((entry) => entry.id === widgetId)!.layout;
  const before = await layout();
  const header = card.locator('.drag-handle');
  await move(header, 0, 830, 14);
  await page.getByText('更改尚未保存', { exact: true }).waitFor();
  assert.deepEqual(await layout(), before);
  await courseLink('CS50x').click();
  await heading('CS50x').waitFor();
  await page.goBack();
  await page.getByRole('region', { name: '布局编辑工具' }).waitFor();
  await page.getByText('更改尚未保存', { exact: true }).waitFor();
  assert.deepEqual(await layout(), before);

  await card.locator('.react-resizable-handle-se').scrollIntoViewIfNeeded();
  const beforeResize = await card.boundingBox();
  assert.ok(beforeResize);
  const waitCardHeight = (taller: boolean) => page.waitForFunction(({ widgetId, target, taller }) => {
    const element = document.querySelector('[data-widget-id="' + widgetId + '"]');
    if (!element) return false;
    const height = element.getBoundingClientRect().height;
    return taller ? height > target + 10 : Math.abs(height - target) < 1;
  }, { widgetId, target: beforeResize.height, taller });
  await move(card.locator('.react-resizable-handle-se'), 100, 55, 12);
  await waitCardHeight(true);
  await button('撤销').click();
  await waitCardHeight(false);
  await header.press('Shift+ArrowDown');
  await waitCardHeight(true);
  assert.deepEqual(await layout(), before);


  await button('添加组件').click();
  const gallery = page.getByRole('dialog', { name: '组件库' });
  await gallery.getByRole('searchbox', { name: '搜索组件' }).fill('课程网址');
  await gallery.getByRole('button', { name: '快捷入口', exact: true }).click();
  await page.getByLabel('组件标题').fill('独立入口');
  await button('新增快捷入口').click();
  const entry = page.getByRole('group', { name: '快捷入口 1' });
  await entry.getByLabel('标题', { exact: true }).fill('本地测试讲义');
  const lectureEntry = page.getByRole('group', { name: '本地测试讲义', exact: true });
  const icon = lectureEntry.getByRole('combobox', { name: '图标', exact: true });
  assert.equal(await icon.inputValue(), '');
  await icon.selectOption('custom');
  await lectureEntry.getByLabel('自定义图标').fill('★');
  assert.equal(await lectureEntry.getByLabel('自定义图标').inputValue(), '★');
  await icon.selectOption({ label: '📘 课程或教材' });
  await lectureEntry.getByLabel('自定义图标').waitFor({ state: 'hidden' });
  await page.getByLabel('网页地址').fill(destination);
  await button('保存组件').click();
  if (process.env.MLW_LAYOUT_PREVIEW) {
    await page.locator('.workspace').evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: process.env.MLW_LAYOUT_PREVIEW, clip: { x: 0, y: 0, width: 1400, height: 880 } });
  }
  await widgetOption(card, '隐藏');
  await heading('隐藏的组件').waitFor();
  assert.equal((await read()).workspace.courses[0].widgets.find((widget) => widget.id === widgetId)?.enabled, true);
  await button('保存布局').click();
  await saved();
  const resized = await layout();
  assert.ok(resized.y > before.y && resized.h > before.h);
  const localLecture = page.getByRole('link', { name: '本地测试讲义' });
  assert.equal((await localLecture.locator('[aria-hidden="true"]').textContent())?.trim(), '📘');
  const [popup] = await Promise.all([page.waitForEvent('popup'), localLecture.click()]);
  await popup.getByRole('heading', { name: '浏览器已打开实际讲义' }).waitFor();
  assert.equal(popup.url(), destination);
  await popup.close();
  assert.equal((await read()).workspace.courses[0].widgets.find((widget) => widget.id === widgetId)?.enabled, false);
  await button('编辑布局').click();
  await layoutOption('恢复默认布局');
  await page.getByText('更改尚未保存', { exact: true }).waitFor();
  await layoutOption('放弃更改');
  assert.deepEqual(await layout(), resized);

  await courseLink('C 语言').click();
  await heading('C 语言').waitFor();
  await saved();
  const readC = async () => (await read()).workspace.courses.find((course) => course.id === 'c')!;
  const freed = page.locator('article').filter({ has: heading('课程资源') });
  await freed.getByRole('button', { name: '添加入口', exact: true }).click();
  const resourcesEditor = page.getByRole('dialog', { name: '配置快捷入口' });
  await resourcesEditor.getByLabel('标题', { exact: true }).fill('课程直达练习');
  await resourcesEditor.getByLabel('网页地址').fill(destination);
  await resourcesEditor.getByRole('button', { name: '保存组件', exact: true }).click();
  await resourcesEditor.waitFor({ state: 'hidden' });
  const directWidget = (await readC()).widgets.find((widget) => widget.type === 'quickLinks' && widget.title === '课程资源');
  assert.equal(directWidget?.type === 'quickLinks' && directWidget.config.items[0].title, '课程直达练习');
  await freed.getByRole('link', { name: '课程直达练习' }).waitFor();
  await freed.getByRole('button', { name: '编辑入口', exact: true }).click();
  await resourcesEditor.getByLabel('标题', { exact: true }).fill('课程直达讲义');
  await resourcesEditor.getByRole('button', { name: '保存组件', exact: true }).click();
  await resourcesEditor.waitFor({ state: 'hidden' });
  await freed.getByRole('link', { name: '课程直达讲义' }).waitFor();
  const cBefore = await readC();
  const moving = page.locator('article').filter({ has: heading('编程工具') });
  await button('编辑布局').click();
  const oldSlot = await freed.boundingBox();
  const toolId = await moving.getAttribute('data-widget-id');
  assert.ok(oldSlot && toolId);
  await widgetOption(freed, '移除');
  await freed.waitFor({ state: 'detached' });
  await page.waitForFunction(({ id, left }) => {
    const target = document.querySelector('[data-widget-id="' + id + '"]');
    return target && Math.abs(target.getBoundingClientRect().left - left) < 1;
  }, { id: toolId, left: oldSlot.x });
  assert.deepEqual((await readC()).widgets, cBefore.widgets);
  await button('撤销').click();
  await freed.waitFor();
  await widgetOption(freed, '移除');
  await button('保存布局').click();
  await saved();
  assert.equal((await readC()).widgets.some((widget) => widget.title === '课程资源'), false);
  assert.equal((await readC()).widgets.find((widget) => widget.id === toolId)?.layout.x, 0);

  await courseLink('CS50x').click();
  await saved();
  assert.deepEqual((await read()).workspace.courses.find((course) => course.id === 'cs50x'), cs50Before);
  await button('新建课程').click();
  await page.getByLabel('课程名称').fill('操作系统（测试）');
  await page.getByLabel('课程简介').fill('测试真实持久化');
  const folder = page.getByRole('combobox', { name: '课程分组', exact: true });
  await folder.selectOption('编程入门');
  await button('新建目录').click();
  await page.getByLabel('新目录名称').fill('系统课程');
  await page.getByLabel('新目录名称').press('Enter');
  assert.equal(await folder.inputValue(), '编程入门/系统课程');
  await button('保存课程').click();
  await heading('操作系统（测试）').waitFor();
  await saved();
  const newCourse = (await read()).workspace.courses.at(-1)!;
  assert.deepEqual(newCourse.navigationPath, ['编程入门', '系统课程']);
  assert.equal(decodeURIComponent(new URL(page.url()).hash), '#course/操作系统-测试');
  await page.goto(origin + '/#course/' + newCourse.id);
  await heading('操作系统（测试）').waitFor();
  assert.equal(decodeURIComponent(new URL(page.url()).hash), '#course/操作系统-测试');
  await page.reload();
  await heading('操作系统（测试）').waitFor();
  const mathGroup = button('数学基础');
  if (await mathGroup.getAttribute('aria-expanded') === 'false') await mathGroup.click();
  await management().press('ArrowDown');
  await courseMenu().waitFor();
  assert.equal(await courseMenu().evaluate((element) =>
    element.closest('[data-radix-popper-content-wrapper]')?.parentElement === document.body), true);
  assert.ok(await courseAction('课程上移').isDisabled());
  assert.ok(await courseAction('课程下移').isDisabled());
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '编辑课程');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '归档');
  await page.keyboard.press('Escape');
  await courseMenu().waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '课程管理');

  const courseEditor = page.getByRole('dialog', { name: '编辑课程', exact: true });
  await management().click();
  await courseAction('编辑课程').click();
  await courseEditor.waitFor();
  await courseMenu().waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.closest('label')?.textContent?.trim() === '课程名称');
  assert.ok(await courseEditor.evaluate((element) =>
    element.matches(':modal') && element.parentElement === document.body
    && element.contains(document.elementFromPoint(innerWidth / 2, innerHeight / 2))));
  await page.keyboard.press('Escape');
  await courseEditor.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '课程管理');

  await courseLink('微积分').click();
  const systemsCourse = courseLink('操作系统（测试）');
  const treeMenu = page.getByRole('menu', { name: '课程树菜单', exact: true });
  await systemsCourse.click({ button: 'right' });
  await treeMenu.getByRole('menuitem', { name: '编辑课程', exact: true }).click();
  const editorName = courseEditor.getByLabel('课程名称', { exact: true });
  assert.equal(await editorName.inputValue(), '操作系统（测试）');
  assert.equal(await page.evaluate(() => location.hash), await systemsCourse.getAttribute('href'));
  await page.keyboard.press('Escape');
  await courseEditor.waitFor({ state: 'hidden' });
  assert.equal(await systemsCourse.evaluate((element) => element === document.activeElement), true);

  const cGroup = button('C 方向');
  await cGroup.click({ button: 'right' });
  await treeMenu.getByRole('menuitem', { name: '编辑组内课程', exact: true }).press('ArrowRight');
  await page.getByRole('menuitem', { name: 'C 语言', exact: true }).click();
  await treeMenu.waitFor({ state: 'hidden' });
  assert.equal(await editorName.inputValue(), 'C 语言');
  await page.keyboard.press('Escape');
  await courseEditor.waitFor({ state: 'hidden' });
  assert.equal(await cGroup.evaluate((element) => element === document.activeElement), true);

  await systemsCourse.press('Shift+F10');
  await treeMenu.getByRole('menuitem', { name: '编辑课程', exact: true }).click();
  await editorName.fill('操作系统复习');
  await folder.selectOption('编程入门');
  await button('保存课程').click();
  await heading('操作系统复习').waitFor();
  await saved();
  assert.equal(decodeURIComponent(new URL(page.url()).hash), '#course/操作系统复习');
  assert.deepEqual((await read()).workspace.courses.at(-1)?.navigationPath, ['编程入门']);
  await management().click();
  await courseAction('课程上移').click();
  await saved();
  assert.equal((await read()).workspace.courses.at(-2)?.name, '操作系统复习');
  await management().click();
  await courseAction('归档').click();
  await saved();
  assert.equal((await read()).workspace.courses.at(-2)?.archived, true);
  await page.getByText('已归档（1）', { exact: true }).click();
  await button('恢复课程').click();
  await saved();
  assert.equal((await read()).workspace.courses.at(-2)?.archived, false);
  await stop(child);
  child = await start(directory, port);
  await page.reload();
  await page.getByRole('heading', { name: '操作系统复习' }).waitFor();
  await page.getByText('测试真实持久化').waitFor();
  assert.equal(await programming.getAttribute('aria-expanded'), 'true');
  if (await math.getAttribute('aria-expanded') === 'false') await math.click();
  await courseLink('线性代数').click();
  await page.getByRole('link', { name: '本地测试讲义' }).waitFor();
  await saved();
  assert.deepEqual(await layout(), resized);
  assert.equal(await card.count(), 0);
  await page.setViewportSize({ width: 580, height: 850 });
  await page.locator('.grid-host .stack').waitFor();
  assert.deepEqual(await layout(), resized);
  await page.setViewportSize({ width: 1400, height: 1250 });
  console.log('Edge E2E · A/B 通过：五门课程、独立组件、拖拽缩放、隐藏、真实新标签、课程创建和服务重启。');

  await button('设置').click();
  await tab('资料文件夹').click();
  await page.getByText('添加资料文件夹', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('文件夹编号（选填）').isVisible(), false);
  assert.equal(await page.getByRole('checkbox', { name: '允许在工作台内保存笔记更改' }).isChecked(), false);
  if (process.env.MLW_FOLDER_SETTINGS_PREVIEW) await page.screenshot({ path: process.env.MLW_FOLDER_SETTINGS_PREVIEW, animations: 'disabled' });
  const localPickerApi = origin + '/api/local-picker';
  const allowSelection = Promise.withResolvers<void>();
  const folderPicker = button('选择文件夹…');
  const initialPickerBox = await folderPicker.boundingBox();
  await page.route(localPickerApi, async (route) => {
    assert.deepEqual(route.request().postDataJSON(), { kind: 'root-folder' });
    await allowSelection.promise;
    await route.fulfill({ json: { selection: { kind: 'path', path: notesDirectory } } });
  }, { times: 1 });
  await folderPicker.click();
  try {
    await folderPicker.getByText('选择中…', { exact: true }).waitFor();
    assert.equal(await folderPicker.isDisabled(), true);
    assert.equal(await folderPicker.getAttribute('aria-busy'), 'true');
    assert.deepEqual(await folderPicker.boundingBox(), initialPickerBox);
  } finally {
    allowSelection.resolve();
  }
  await page.getByText(notesDirectory, { exact: true }).waitFor();
  assert.equal(await folderPicker.isEnabled(), true);
  const folderName = await page.getByLabel('显示名称（选填）').getAttribute('placeholder');
  assert.equal(folderName, 'test-material');
  await page.getByRole('checkbox', { name: '允许在工作台内保存笔记更改' }).check();
  await button('添加文件夹').click();
  await page.getByRole('status').getByText('文件夹已添加，可以直接浏览文件', { exact: true }).waitFor();
  const grants = await (await page.request.get(origin + '/api/roots')).json() as RootGrant[];
  const canonicalNotesDirectory = await realpath(notesDirectory);
  const firstGrant = grants.find((root) => root.directory === canonicalNotesDirectory);
  assert.equal(firstGrant?.label, folderName);
  assert.match(firstGrant?.id ?? '', /^folder-/u);
  const grantedRootId = firstGrant!.id;
  await page.getByRole('button', { name: /测试原文\.md/u }).click();
  await page.getByLabel('Markdown 原文', { exact: true }).waitFor();
  await page.getByRole('dialog', { name: '测试原文.md', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  await heading('已添加的文件夹').waitFor();
  await button('关闭').click();

  await button('编辑布局').click();
  await button('添加组件').click();
  await page.getByRole('dialog', { name: '组件库' }).getByRole('button', { name: '隔离测试插件', exact: true }).click();
  await page.getByRole('dialog', { name: '配置隔离测试插件' }).waitFor();
  await page.getByLabel('插件文字').fill('用户自己的组件');
  await button('保存组件').click();
  await button('保存布局').click();
  await page.getByText('用户自己的组件 · 联网已隔离', { exact: true }).waitFor();
  assert.equal(pluginProbeHits, 0);
  await button('测试超时').click();
  await page.getByText('插件执行超时，运行已终止。', { exact: true }).waitFor();
  await saved();
  console.log('Edge E2E · 安装附带和用户自写插件、独立启停、跨刷新保存及隔离联网通过。');
  await button('编辑布局').click();
  const shortcuts = page.locator('article').filter({ has: page.getByRole('heading', { name: '独立入口', exact: true }) });
  await shortcuts.getByRole('button', { name: '配置', exact: true }).click();
  await button('新增快捷入口').click();
  const noteEntry = page.locator('fieldset').nth(1);
  await noteEntry.getByLabel('标题', { exact: true }).fill('测试笔记');
  await noteEntry.getByLabel('入口类型', { exact: true }).selectOption('markdown');
  const pickedRoots = [...grants, { id: 'picked-folder', label: '新选择的文件夹', directory: notesDirectory, writable: false }];
  await page.route(localPickerApi, async (route) => {
    assert.deepEqual(route.request().postDataJSON(), { kind: 'markdown' });
    await route.fulfill({ json: { selection: { kind: 'document', location: { rootId: grantedRootId, path: '测试原文.md' }, roots: pickedRoots } } });
  }, { times: 1 });
  await noteEntry.getByRole('button', { name: '浏览文件…', exact: true }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('input')).some((input) => input.value === '测试原文.md'));
  assert.equal(await noteEntry.getByLabel('资料文件夹').inputValue(), grantedRootId);
  assert.ok((await noteEntry.getByLabel('资料文件夹').locator('option').allTextContents()).includes('新选择的文件夹'));
  await button('新增快捷入口').click();
  const vscode = page.locator('fieldset').nth(2);
  await vscode.getByLabel('标题', { exact: true }).fill('本机 VS Code 测试');
  await vscode.getByLabel('入口类型', { exact: true }).selectOption('vscode');
  await vscode.getByLabel('文件或项目文件夹的位置').fill('C:\\测试目录\\a #1.c');
  await button('新增快捷入口').click();
  const obsidian = page.locator('fieldset').nth(3);
  await obsidian.getByLabel('标题', { exact: true }).fill('Obsidian URI 测试');
  await obsidian.getByLabel('入口类型', { exact: true }).selectOption('obsidian');
  await page.route(localPickerApi, async (route) => {
    assert.deepEqual(route.request().postDataJSON(), { kind: 'obsidian-vault' });
    await route.fulfill({ status: 404, json: { message: 'Route POST:/api/local-picker not found' } });
  }, { times: 1 });
  await obsidian.getByRole('button', { name: '选择笔记库…', exact: true }).click();
  await obsidian.getByRole('alert').getByText(/当前服务版本缺少本机文件选择功能/u).waitFor();
  await page.route(localPickerApi, async (route) => {
    assert.deepEqual(route.request().postDataJSON(), { kind: 'obsidian-note' });
    await route.fulfill({ status: 409, json: { code: 'picker_open', message: '本机选择窗口已经打开，请完成或取消该窗口后再试。' } });
  }, { times: 1 });
  const notePicker = obsidian.locator('.path-picker').filter({ has: page.getByRole('button', { name: '选择笔记…', exact: true }) });
  await notePicker.getByRole('button', { name: '选择笔记…', exact: true }).click();
  await notePicker.getByRole('status').getByText('本机选择窗口已经打开，请完成或取消该窗口后再试。', { exact: true }).waitFor();
  assert.equal(await notePicker.getByRole('alert').count(), 0);
  await page.route(localPickerApi, async (route) => {
    assert.deepEqual(route.request().postDataJSON(), { kind: 'obsidian-note' });
    await route.fulfill({ json: { selection: { kind: 'obsidian', vault: 'Test Vault', file: '笔记/文件.md' } } });
  }, { times: 1 });
  await obsidian.getByRole('button', { name: '选择笔记…', exact: true }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('input')).some((input) => input.value === '笔记/文件.md'));
  assert.equal(await obsidian.getByLabel('笔记库名称').inputValue(), 'Test Vault');
  await button('保存组件').click();
  await button('保存布局').click();
  await saved();
  assert.equal(await page.getByRole('link', { name: '本机 VS Code 测试', exact: true }).getAttribute('href'),
    'vscode://file/C:/%E6%B5%8B%E8%AF%95%E7%9B%AE%E5%BD%95/a%20%231.c');
  assert.equal(await page.getByRole('link', { name: 'Obsidian URI 测试', exact: true }).getAttribute('href'),
    'obsidian://open?vault=Test%20Vault&file=%E7%AC%94%E8%AE%B0%2F%E6%96%87%E4%BB%B6.md');
  assert.equal(await page.getByText(/需要已安装的应用/u).count(), 0);
  const nativeRow = page.getByRole('link', { name: 'Obsidian URI 测试', exact: true }).locator('..');
  assert.ok(await nativeRow.getByRole('button', { name: '复制 Obsidian URI 测试 的地址', exact: true }).isVisible());



  await button('测试笔记').click();
  const editor = page.getByLabel('Markdown 原文', { exact: true });
  await editor.waitFor();
  await button('Markdown 预览').click();
  await page.locator('.markdown-preview .katex').waitFor();
  await page.locator('.markdown-preview input[type="checkbox"]').waitFor();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n新写入');
  await button('保存 Markdown').click();
  await page.getByText(/Markdown 已保存/).waitFor();
  const savedText = noteSource + '\r\n新写入';
  assert.equal(await readFile(notePath, 'utf8'), savedText);
  const relativeBackup = (await page.getByText(/Markdown 已保存/).textContent())!.split('备份于 ')[1];
  assert.equal(await readFile(join(directory, relativeBackup), 'utf8'), noteSource);

  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n编辑器中的测试草稿');
  await writeFile(notePath, savedText + '\r\n独立磁盘更改');
  await button('保存 Markdown').click();
  await page.getByText(/磁盘上的文件已变化/).waitFor();
  await page.locator('.comparison pre').filter({ hasText: '独立磁盘更改' }).waitFor();
  assert.ok(await button('保存 Markdown').isDisabled());
  assert.equal(await readFile(notePath, 'utf8'), savedText + '\r\n独立磁盘更改');
  await button('重新加载笔记').click();
  await editor.getByText('独立磁盘更改').waitFor();
  await button('关闭').click();

  await button('教材示例.pdf').click();
  await page.getByText('第 1 / 2 页', { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return false;
    const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels?.some((value, index) => index % 4 === 3 && value > 0) ?? false;
  });
  await button('下一页').click();
  await page.getByText('第 2 / 2 页', { exact: true }).waitFor();
  const renderedPdf = page.locator('.pdf-page[aria-busy="false"] canvas[aria-label="PDF 第 2 页"]');
  await renderedPdf.waitFor();
  const baseWidth = await renderedPdf.evaluate((canvas) => (canvas as HTMLCanvasElement).width);
  await saved();
  await button('放大').click();
  await page.getByText('125%', { exact: true }).waitFor();
  await renderedPdf.waitFor();
  assert.ok(await renderedPdf.evaluate((canvas) => (canvas as HTMLCanvasElement).width) > baseWidth);
  await button('关闭').click();
  await button('教材示例.pdf').click();
  await page.getByText('第 2 / 2 页', { exact: true }).waitFor();
  await button('关闭').click();

  await button('新建任务').click();
  await page.getByLabel('任务标题').fill('验证课后习题');
  await page.getByLabel('任务备注').fill('使用本地测试笔记');
  await page.getByLabel('截止日期').fill('2026-12-01');
  await page.getByLabel('关联资源').selectOption({ label: '测试笔记' });
  await button('保存任务').click();
  await saved();
  const taskStatus = page.getByLabel('验证课后习题状态');
  await taskStatus.selectOption('done');
  await saved();
  await page.setViewportSize({ width: 1280, height: 620 });
  const workspaceScroll = page.locator('.workspace');
  await workspaceScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  assert.ok(await workspaceScroll.evaluate((element) => element.scrollTop > 0));
  await button('填写进度').click();
  const bounds = await page.getByRole('dialog', { name: '手动学习进度' }).boundingBox();
  assert.ok(bounds);
  assert.ok(Math.abs(bounds.x + bounds.width / 2 - 640) < 1, 'The dialog is horizontally centered in the viewport');
  assert.ok(Math.abs(bounds.y + bounds.height / 2 - 310) < 1, 'The dialog is vertically centered in the viewport');
  assert.ok(await page.locator('.workspace').evaluate((element) => element.scrollTop > 0));
  await page.setViewportSize({ width: 1400, height: 1250 });
  await page.getByLabel('当前章节').fill('线性映射');
  await page.getByLabel('下一步').fill('计算矩阵的秩');
  await page.getByLabel('待巩固').fill('标准基下的表示');
  await button('保存进度').click();
  await saved();

  await stop(child);
  child = await start(directory, port);
  await page.reload();
  await page.getByText('验证课后习题', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('验证课后习题状态').inputValue(), 'done');
  await page.getByText('标准基下的表示', { exact: false }).waitFor();
  await button('教材示例.pdf').click();
  await page.getByText('第 2 / 2 页', { exact: true }).waitFor();
  await button('关闭').click();
  console.log('Edge E2E · C/D 通过：授权目录、两种原生 URI、Markdown 写入和对照冲突、PDF 页码、任务与进度重启。');

  const qiushiCatalog = 'https://www.qstheory.cn/20251231/2d916da295774130ac2fb223fd208895/c.html';
  const qiushiIssue = 'https://www.qstheory.cn/20261116/qiushi-issue/c.html';
  const qiushiArticle = 'https://www.qstheory.cn/20261116/magazine-article/c.html';
  const zjxcHome = 'https://zjnews.zjol.com.cn/zjxc/';
  const zjxcArticle = 'https://zjnews.zjol.com.cn/zjxc/202611/t20261116_1234567.shtml';
  let zjxcTitle = '浙江宣传测试文章';
  const servePublisher = async (route: Route) => {
    const { url } = route.request().postDataJSON();
    const pages = new Map([
      [qiushiCatalog, '<a href="' + qiushiIssue + '"><span>《求是》2026年第22期</span></a>'],
      [qiushiIssue, '<p><a href="' + qiushiArticle + '">求是测试文章</a> /测试作者</p>'],
      [zjxcHome, '<li class="listLi"><span class="listSpan">2026年11月16日08时</span><a href="' + zjxcArticle
        + '">浙江宣传丨' + zjxcTitle + '</a></li>'],
    ]);
    assert.ok(pages.has(url), 'unexpected publisher address: ' + url);
    await route.fulfill({ json: { text: pages.get(url), status: 200 } });
  };
  let publishersAvailable = false;
  const homePages = await browser.newPage();
  await homePages.route(origin + '/api/home-pages/public-source', (route) => publishersAvailable
    ? servePublisher(route)
    : route.fulfill({ status: 502, json: { code: 'source_unavailable', message: '资讯来源暂时无法访问。' } }));
  await homePages.goto(origin + '/home-pages.html');
  const mainMedia = homePages.locator('.hp-card').filter({ has: homePages.getByText('主流媒体', { exact: true }) });
  await mainMedia.locator('.hp-card-subtitle').getByText('暂无文章', { exact: true }).waitFor();
  assert.equal(await mainMedia.locator('.hp-media-skeleton').count(), 0);
  publishersAvailable = true;
  await mainMedia.getByRole('button', { name: '立即刷新', exact: true }).click();
  await mainMedia.getByText('求是测试文章', { exact: true }).waitFor();
  await mainMedia.getByText('浙江宣传丨' + zjxcTitle, { exact: true }).waitFor();
  await homePages.close();
  console.log('Edge E2E · Home Pages 媒体来源失败后结束占位，刷新可恢复两个频道。');

  await page.route(origin + '/api/home-pages/public-source', servePublisher);
  await homeLink().click();
  await button('编辑首页').click();
  await button('添加组件').click();
  if (process.env.MLW_HOME_WIDGET_MENU) await page.screenshot({ path: process.env.MLW_HOME_WIDGET_MENU, animations: 'disabled' });
  const catalog = Object.entries(homeWidgetCatalog);
  for (const [index, [, { title }]] of catalog.entries()) {
    if (index > 0) await button('添加组件').click();
    await page.getByRole('menuitem', { name: title, exact: true }).click();
    await heading(title).waitFor();
  }
  await button('保存首页布局').click();
  await saved();
  const dialog = (title: string) => page.getByRole('dialog', { name: '配置' + title, exact: true });
  const configureHome = async (title: string) => {
    await button('配置' + title).click();
    return dialog(title);
  };
  const saveCard = async (title: string) => {
    await dialog(title).getByRole('button', { name: '保存组件配置' }).click();
    await dialog(title).waitFor({ state: 'hidden' });
    await saved();
  };
  const noteName = '2025-11-16 往年例子.md';
  await writeFile(join(notesDirectory, noteName), '## 复习章节\n首页嵌入验证句\n## 另一节\n另一节不应出现');
  for (const title of ['最近笔记', '全库统计', '那年今日']) {
    await (await configureHome(title)).getByLabel('资料文件夹').selectOption(grantedRootId);
    await saveCard(title);
  }
  const within = (title: string) => page.getByRole('region', { name: title, exact: true });
  await within('最近笔记').getByRole('button', { name: '2025-11-16 往年例子' }).waitFor();
  await within('全库统计').getByText('Markdown 笔记', { exact: true }).waitFor();
  await within('那年今日').getByRole('button', { name: '2025-11-16 往年例子' }).waitFor();
  const embedded = await configureHome('笔记嵌入');
  await embedded.getByLabel('资料文件夹').selectOption(grantedRootId);
  await embedded.getByLabel('文件位置').fill(noteName);
  await embedded.getByLabel('章节标题（选填）').fill('复习章节');
  await saveCard('笔记嵌入');
  await within('笔记嵌入').getByText('首页嵌入验证句', { exact: true }).waitFor();
  assert.equal(await within('笔记嵌入').getByText('另一节不应出现').count(), 0);

  const countdown = await configureHome('倒计时与纪念日');
  await countdown.getByLabel('目标名称').fill('矩阵复习日');
  await countdown.getByLabel('目标日期').fill('2026-11-20');
  await saveCard('倒计时与纪念日');
  await within('倒计时与纪念日').getByText('矩阵复习日', { exact: true }).waitFor();
  const quote = await configureHome('每日一言');
  await quote.getByLabel('自定义语录（每行一条）').fill('测试语录');
  await saveCard('每日一言');
  await within('每日一言').getByText('测试语录', { exact: true }).waitFor();

  const links = await configureHome('快捷入口');
  await links.getByRole('button', { name: '新增快捷入口' }).click();
  await links.getByLabel('标题', { exact: true }).fill('首页测试讲义');
  await links.getByLabel('网页地址').fill(destination);
  await saveCard('快捷入口');
  assert.equal(await within('快捷入口').getByRole('link', { name: '首页测试讲义' }).getAttribute('href'), destination);

  const board = within('任务看板');
  await board.getByRole('button', { name: '新建看板任务' }).click();
  const boardTask = page.getByRole('dialog', { name: '看板任务' });
  await boardTask.getByLabel('课程').selectOption('linear-algebra');
  await boardTask.getByLabel('任务标题').fill('看板新增测试');
  await boardTask.getByRole('button', { name: '保存看板任务' }).click();
  await saved();
  await board.getByLabel('看板新增测试看板状态').selectOption('doing');
  await saved();
  const boardTaskStatus = async () => (await read()).workspace.courses
    .find(({ id }) => id === 'linear-algebra')?.tasks.find(({ title }) => title === '看板新增测试')?.status;
  assert.equal(await boardTaskStatus(), 'doing');
  await board.locator('li').filter({ hasText: '看板新增测试' })
    .dragTo(board.getByRole('region', { name: '完成', exact: true }), { sourcePosition: { x: 5, y: 5 } });
  await saved();
  assert.equal(await boardTaskStatus(), 'done');

  const sourceFixtures = [
    { title: '待办与日程', name: '计划.duowei', data: { fields: [{ id: 'title', name: '标题' }], records: [{ id: 'row', values: { title: '桌面计划测试' } }] }, rendered: '桌面计划测试' },
    { title: '批注与复习', name: 'question-bank.json', data: { questions: { q1: { stem: '桌面批注测试', review: { mastered: false } } } }, rendered: '桌面批注测试' },
    { title: '微信收件箱', name: 'journal.json', data: { key: 'msg1', message: { title: '桌面微信测试', receivedAt: '2026-11-16T12:00:00Z' } }, rendered: '桌面微信测试' },
  ];
  for (const { title, name, data, rendered } of sourceFixtures) {
    const settings = await configureHome(title);
    await settings.getByLabel('选取来源文件').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await settings.getByRole('status').getByText(/1 条/u).waitFor();
    await saveCard(title);
    await within(title).getByText(rendered, { exact: true }).waitFor();
    await within('聚合信息流').getByText(rendered, { exact: true }).waitFor();
  }
  const media = await configureHome('主流媒体与 RSS');
  await media.getByLabel('导入 RSS、Atom 或 OPML').setInputFiles([
    { name: 'fixture.rss', mimeType: 'application/rss+xml',
      buffer: Buffer.from('<rss version="2.0"><channel><title>测试来源</title><item><title>测试文章</title><link>https://example.org/article</link></item></channel></rss>') },
    { name: 'fixture.opml', mimeType: 'text/xml',
      buffer: Buffer.from('<opml><body><outline text="测试订阅" xmlUrl="https://example.org/feed"/></body></opml>') },
  ]);
  await media.getByText(/文章 1 篇 · 订阅 1 个/u).waitFor();
  await saveCard('主流媒体与 RSS');
  const mediaCard = within('主流媒体与 RSS');
  const channel = mediaCard.getByRole('combobox', { name: '媒体频道' });
  assert.equal(await channel.inputValue(), 'all');
  assert.equal(await mediaCard.getByRole('link', { name: '求是测试文章' }).getAttribute('href'), qiushiArticle);
  assert.equal(await mediaCard.getByRole('link', { name: '浙江宣传测试文章' }).getAttribute('href'), zjxcArticle);
  assert.equal(await mediaCard.getByRole('link', { name: '测试文章', exact: true }).count(), 0);
  await channel.selectOption('qiushi');
  await mediaCard.getByRole('link', { name: '求是测试文章' }).waitFor();
  assert.equal(await mediaCard.getByRole('link', { name: '浙江宣传测试文章' }).count(), 0);
  await channel.selectOption('zjxc');
  await mediaCard.getByRole('link', { name: '浙江宣传测试文章' }).waitFor();
  zjxcTitle = '浙江宣传刷新文章';
  await mediaCard.getByRole('button', { name: '刷新媒体来源' }).click();
  await mediaCard.getByRole('link', { name: '浙江宣传刷新文章' }).waitFor();
  await channel.selectOption('subscriptions');
  await mediaCard.getByRole('link', { name: '测试订阅' }).waitFor();
  await mediaCard.getByRole('link', { name: '《求是》杂志', exact: true }).waitFor();
  await mediaCard.getByRole('link', { name: '浙江宣传', exact: true }).waitFor();

  await page.reload();
  await mediaCard.getByRole('link', { name: '浙江宣传刷新文章' }).waitFor();
  await channel.selectOption('imports');
  await mediaCard.getByRole('link', { name: '测试文章' }).waitFor();
  await within('聚合信息流').getByText('桌面微信测试', { exact: true }).waitFor();
  const savedCards = (await read()).workspace.home.layout ?? [];
  assert.ok(catalog.every(([id]) => savedCards.some((card) => card.id === id && !card.hidden)));
  await courseLink('线性代数').click();
  await heading('线性代数').waitFor();
  console.log('Edge E2E · 13 种新增首页组件可添加，真实文件、任务联动、导入和刷新持久化通过。');

  await button('设置').click();
  await tab('备份与恢复').click();
  const [backupDownload] = await Promise.all([
    page.waitForEvent('download'), button('下载备份').click(),
  ]);
  const backupPath = join(sandbox, 'export.json');
  await backupDownload.saveAs(backupPath);
  const exported = await readFile(backupPath, 'utf8');
  assert.equal(exported.includes('独立磁盘更改'), false);
  assert.equal(exported.includes('roots'), false);
  assert.deepEqual(JSON.parse(exported), (await read()).workspace);
  await page.getByLabel('选择备份文件').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"bad":') });
  await page.getByRole('dialog', { name: '设置' }).getByRole('alert').waitFor();
  assert.equal(await button('用这份备份恢复').count(), 0);
  await button('关闭').click();

  await page.goto('about:blank');
  await stop(child);
  child = await start(restoredDirectory, port);
  await page.goto(origin + '/#course/calculus');
  await heading('微积分').waitFor();
  await saved();
  assert.equal(await page.getByText('验证课后习题', { exact: true }).count(), 0);
  await button('设置').click();
  await tab('备份与恢复').click();
  await page.getByLabel('选择备份文件').setInputFiles(backupPath);
  await button('用这份备份恢复').click();
  await page.getByText('验证课后习题', { exact: true }).waitFor();
  await saved();
  const restored = snapshotSchema.parse(JSON.parse(await readFile(join(restoredDirectory, 'workspace.json'), 'utf8')));
  assert.deepEqual(restored.workspace, JSON.parse(exported));
  await page.getByRole('button', { name: '测试笔记', exact: true }).first().click();
  await page.getByText(/请到「设置 → 资料文件夹」添加或重新连接文件夹/u).waitFor();
  await button('关闭').click();
  await button('设置').click();
  await tab('资料文件夹').click();
  await heading('重新连接以前的文件夹').waitFor();
  await button('重新连接').click();
  await page.route(localPickerApi, async (route) => {
    assert.deepEqual(route.request().postDataJSON(), { kind: 'root-folder' });
    await route.fulfill({ json: { selection: { kind: 'path', path: notesDirectory } } });
  }, { times: 1 });
  await button('选择文件夹…').click();
  await page.getByText(notesDirectory, { exact: true }).waitFor();
  await button('重新连接文件夹').click();
  await page.getByRole('status').getByText('文件夹已重新连接', { exact: true }).waitFor();
  const restoredGrants = await (await page.request.get(origin + '/api/roots')).json() as RootGrant[];
  assert.equal(restoredGrants.find(({ id }) => id === grantedRootId)?.directory, canonicalNotesDirectory);
  assert.equal(restoredGrants.find(({ id }) => id === grantedRootId)?.writable, false);
  await button('关闭').click();
  await page.getByRole('button', { name: '测试笔记', exact: true }).first().click();
  await page.getByRole('button', { name: 'Markdown 预览', exact: true }).waitFor();
  await button('关闭').click();
  assert.deepEqual(uncaught, []);
  console.log('Edge E2E · E 通过：损坏导入拒绝，配置在独立数据目录恢复，恢复后用文件夹选择器重新连接原资料。');
  if (await programming.getAttribute('aria-expanded') === 'false') await programming.click();
  if (await cDirection.getAttribute('aria-expanded') === 'true') await cDirection.click();
  const cs61a = courseLink('CS61A');
  assert.equal(await cs61a.getAttribute('draggable'), 'false');
  const beginTreeDrag = async (item: Locator) => {
    await item.scrollIntoViewIfNeeded();
    const box = (await item.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 9, y, { steps: 4 });
    await page.locator('.course-drag-preview').waitFor();
  };
  const hoverTreeTarget = async (item: Locator) => {
    const box = (await item.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 9 });
  };
  const finishTreeMove = async () => {
    const response = page.waitForResponse((reply) => reply.url() === workspaceApi && reply.request().method() === 'PUT');
    await page.mouse.up();
    assert.equal((await response).status(), 200);
    await page.locator('.course-drag-preview').waitFor({ state: 'hidden' });
    await saved();
  };
  const readTree = async () => snapshotSchema.parse(await (await page.request.get(workspaceApi)).json()).workspace;
  const treeBefore = await readTree();
  await beginTreeDrag(cs61a);
  assert.equal((await page.locator('.course-drag-preview').textContent())?.trim(), 'CS61A');
  await hoverTreeTarget(cDirection);
  await page.waitForFunction(() => document.querySelector('[data-folder-drag="编程入门/C 方向"]')?.getAttribute('data-drop-active') === 'true');
  await page.waitForFunction(() => document.querySelector('[data-folder-drag="编程入门/C 方向"]')?.getAttribute('aria-expanded') === 'true');
  await finishTreeMove();
  assert.deepEqual((await readTree()).courses.find(({ id }) => id === 'cs61a')?.navigationPath, ['编程入门', 'C 方向']);
  assert.equal((await readTree()).activeCourseId, treeBefore.activeCourseId);

  const rootDrop = page.locator('.course-root-drop');
  await beginTreeDrag(cDirection);
  await hoverTreeTarget(rootDrop);
  assert.equal(await rootDrop.getAttribute('data-drop-active'), 'true');
  await finishTreeMove();
  const afterTreeMove = await readTree();
  const moved = afterTreeMove.courses.filter(({ id }) => ['cs61a', 'c', 'cs50x'].includes(id));
  assert.deepEqual(moved.map(({ navigationPath }) => navigationPath), [['C 方向'], ['C 方向'], ['C 方向']]);
  for (const course of moved) assert.deepEqual({ ...course, navigationPath: [] },
    { ...treeBefore.courses.find(({ id }) => id === course.id), navigationPath: [] });
  await page.reload();
  await page.getByRole('button', { name: 'C 方向', exact: true }).waitFor();
  await beginTreeDrag(page.getByRole('button', { name: 'C 方向', exact: true }));
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.locator('.course-drag-preview').waitFor({ state: 'hidden' });
  assert.deepEqual(await readTree(), afterTreeMove);
  console.log('Edge E2E · 课程与文件夹拖放、悬停展开、移动到根目录、Esc 取消及持久化通过。');

  await treeOption('新建文件夹');
  const newFolder = page.getByRole('textbox', { name: '新文件夹名称', exact: true });
  await newFolder.fill('测试资料夹');
  await newFolder.press('Enter');
  await button('测试资料夹').waitFor();
  await saved();
  await button('测试资料夹').press('F2');
  const folderRename = page.getByRole('textbox', { name: '重命名文件夹', exact: true });
  await folderRename.fill('临时筛选目录');
  await folderRename.press('Enter');
  await button('临时筛选目录').waitFor();
  await saved();
  await page.reload();
  await button('临时筛选目录').waitFor();
  await button('C 方向').click();
  await cs61a.click({ button: 'right' });
  await treeMenu.getByRole('menuitem', { name: '创建副本', exact: true }).click();
  const copyLink = courseLink('CS61A 副本');
  await copyLink.waitFor();
  await saved();
  await copyLink.press('F2');
  const courseRename = page.getByRole('textbox', { name: '重命名课程', exact: true });
  await courseRename.fill('课程副本测试');
  await courseRename.press('Enter');
  const renamedCopy = courseLink('课程副本测试');
  await renamedCopy.waitFor();
  await saved();
  await renamedCopy.click({ button: 'right' });
  await treeMenu.getByRole('menuitem', { name: '移动到…', exact: true }).click();
  const moveDialog = page.getByRole('dialog', { name: '移动到文件夹', exact: true });
  await moveDialog.getByLabel('目标文件夹').selectOption('临时筛选目录');
  await moveDialog.getByRole('button', { name: '确认移动', exact: true }).click();
  await moveDialog.waitFor({ state: 'hidden' });
  await saved();
  assert.deepEqual((await readTree()).courses.find(({ name }) => name === '课程副本测试')?.navigationPath, ['临时筛选目录']);
  await renamedCopy.press('Delete');
  await page.getByText('回收站（1）', { exact: true }).click();
  await button('恢复').click();
  await renamedCopy.waitFor();
  await saved();
  await button('临时筛选目录').press('Delete');
  await page.getByText('回收站（1）', { exact: true }).click();
  await button('永久删除').click();
  await button('确认永久删除').click();
  await page.getByRole('dialog', { name: '永久删除', exact: true }).waitFor({ state: 'hidden' });
  assert.ok((await readTree()).courses.every(({ name }) => name !== '课程副本测试'));
  assert.ok((await readTree()).courseExplorer?.folders.every((path) => path.join('/') !== '临时筛选目录'));
  await page.clock.runFor(100);
  await treeOption('新建文件夹');
  await newFolder.fill('B 后建');
  await newFolder.press('Enter');
  await button('B 后建').waitFor();
  await saved();
  await page.clock.runFor(100);
  await treeOption('新建文件夹');
  await newFolder.fill('A 最新');
  await newFolder.press('Enter');
  await button('A 最新').waitFor();
  await saved();
  const opts = button('课程树选项');
  const sortRadio = (name: string) => page.getByRole('menuitemradio', { name, exact: true });
  const folderOrder = () => page.locator('.course-nav-list > li > [data-folder-drag]').evaluateAll((folders) =>
    folders.map((element) => element.textContent?.trim()).filter((name) => name === 'A 最新' || name === 'B 后建'));
  await opts.click();
  await sortRadio('创建日期（由旧到新）').click();
  assert.deepEqual(await folderOrder(), ['B 后建', 'A 最新']);
  await page.reload();
  await button('A 最新').waitFor();
  assert.deepEqual(await folderOrder(), ['B 后建', 'A 最新']);
  await opts.click();
  await sortRadio('手动顺序').click();
  await button('A 最新').click({ modifiers: ['Alt'] });
  await button('B 后建').click({ modifiers: ['Alt'] });
  await page.getByText('2 项已选', { exact: true }).waitFor();
  await beginTreeDrag(button('A 最新'));
  assert.match((await page.locator('.course-drag-preview').textContent()) ?? '', /2 项/u);
  await hoverTreeTarget(button('C 方向'));
  await finishTreeMove();
  assert.ok((await readTree()).courseExplorer?.folders.some((path) => path.join('/') === 'C 方向/A 最新'));
  assert.ok((await readTree()).courseExplorer?.folders.some((path) => path.join('/') === 'C 方向/B 后建'));
  await button('C 方向').click({ button: 'right' });
  await treeMenu.getByRole('menuitem', { name: '添加书签', exact: true }).click();
  await page.getByText('书签', { exact: true }).waitFor();
  await saved();
  assert.ok((await readTree()).courseExplorer?.bookmarks.includes('folder:C 方向'));
  await treeOption('展开全部');
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('[data-folder-drag]'))
    .some((row) => row.getAttribute('aria-expanded') === 'false'));
  await treeOption('折叠全部');
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('[data-folder-drag]'))
    .some((row) => row.getAttribute('aria-expanded') === 'true'));
  await button('C 方向').click();
  await page.waitForFunction(() => !document.getAnimations().some((animation) => animation instanceof CSSTransition
    && animation.playState === 'running' && animation.transitionProperty === 'grid-template-rows'));
  await beginTreeDrag(button('A 最新'));
  await page.keyboard.down('Control');
  await hoverTreeTarget(rootDrop);
  await page.locator('.course-drag-copy').waitFor();
  assert.equal(await rootDrop.getAttribute('data-drop-active'), 'true');
  await finishTreeMove();
  await page.keyboard.up('Control');
  const copiedTree = await readTree();
  assert.ok(copiedTree.courseExplorer?.folders.some((path) => path.join('/') === 'C 方向/A 最新'));
  assert.ok(copiedTree.courseExplorer?.folders.some((path) => path.join('/') === 'A 最新 副本'));
  console.log('Edge E2E · 展开与折叠全部，Ctrl 拖拽复制且保留原位通过。');
  console.log('Edge E2E · 日期排序跨刷新、Alt 多选批量拖放和文件夹书签通过。');
  console.log('Edge E2E · 空文件夹持久化、课程与文件夹就地改名、右键复制和移动、回收站恢复及永久删除通过。');

  const compatibility = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  compatibility.setDefaultTimeout(6000);
  const settingsButton = compatibility.getByRole('button', { name: '设置', exact: true });
  const legacySettings = compatibility.getByRole('dialog', { name: '设置', exact: true });
  const legacyTransparency = legacySettings.getByRole('slider', { name: '透明度', exact: true });
  const legacyTint = legacySettings.getByLabel('弹窗底色', { exact: true });
  let legacy = true;
  let remote: Snapshot = {
    revision: crypto.randomUUID(),
    workspace: {
      ...restored.workspace,
      activeCourseId: 'linear-algebra',
      appearance: { ...restored.workspace.appearance, dialogTransparency: null, dialogTint: null },
    },
  };
  await compatibility.route(workspaceApi, async (route) => {
    if (route.request().method() === 'PUT') {
      const data = route.request().postDataJSON();
      if (legacy && (Object.hasOwn(data.workspace.appearance, 'dialogTransparency') || Object.hasOwn(data.workspace.appearance, 'dialogTint'))) {
        await route.fulfill({ status: 400, json: {
          code: 'invalid_workspace',
          message: '配置无效，字段 appearance。Unrecognized keys: "dialogTransparency", "dialogTint"',
        } });
        return;
      }
      if (data.revision !== remote.revision) {
        await route.fulfill({ status: 409, json: { code: 'stale_revision', message: '磁盘上已有更新。' } });
        return;
      }
      remote = { revision: crypto.randomUUID(), workspace: snapshotSchema.parse(data).workspace };
    }
    const { dialogTransparency, dialogTint, ...appearance } = remote.workspace.appearance;
    await route.fulfill({ json: legacy ? { ...remote, workspace: { ...remote.workspace, appearance } } : remote });
  });
  const waitForSave = () => compatibility.waitForResponse((response) =>
    response.url() === workspaceApi && response.request().method() === 'PUT');
  const legacyCourseLink = (name: string) => compatibility.getByRole('navigation', { name: '课程列表' }).getByRole('link', { name, exact: true });
  await compatibility.goto(origin + '/#course/linear-algebra');
  const [oldNavigation] = await Promise.all([waitForSave(), legacyCourseLink('微积分').click()]);
  assert.equal(oldNavigation.status(), 200);
  assert.equal(remote.workspace.activeCourseId, 'calculus');
  await compatibility.getByRole('button', { name: '编辑布局', exact: true }).click();

  await settingsButton.click();
  await legacyTransparency.press('End');
  await legacyTint.fill('#145f5d');
  await legacySettings.getByRole('button', { name: '保存外观', exact: true }).click();
  await legacySettings.getByRole('status').getByText('外观已保存', { exact: true }).waitFor();
  assert.equal(remote.workspace.appearance.dialogTint, null);
  await legacySettings.getByRole('button', { name: '关闭', exact: true }).click();
  await compatibility.reload();
  await settingsButton.click();
  assert.equal(await legacyTransparency.inputValue(), '40');
  assert.equal(await legacyTint.inputValue(), '#145f5d');
  await legacySettings.getByRole('button', { name: '关闭', exact: true }).click();

  legacy = false;
  await compatibility.reload();
  await settingsButton.click();
  assert.equal(await legacyTint.inputValue(), '#145f5d');
  await legacySettings.getByRole('button', { name: '关闭', exact: true }).click();
  const [newNavigation] = await Promise.all([waitForSave(), legacyCourseLink('线性代数').click()]);
  assert.equal(newNavigation.status(), 200);
  assert.equal(remote.workspace.appearance.dialogTint, '#145f5d');
  assert.equal(remote.workspace.appearance.dialogTransparency, 40);
  await compatibility.close();
  console.log('Edge E2E · 旧后台可切课与编辑，玻璃设置刷新后保留，升级后随工作区保存。');

} finally {
  await browser?.close();
  if (child) await stop(child);
  fixture.close();
  await rm(sandbox, { recursive: true, force: true });
}
