import '../../../vendor/home-pages/styles.css';
import './web-host.css';
import '../../dialog-glass.css';
import { HomeView } from '../../../vendor/home-pages/src/view.ts';
import { HomePagesSettingTab, sanitizeSettings } from '../../../vendor/home-pages/src/settings.ts';
import { AddWidgetModal } from '../../../vendor/home-pages/src/ui/modals.ts';
import { renderEmpty } from '../../../vendor/home-pages/src/ui/dom.ts';
import { createWidgetInstance } from '../../../vendor/home-pages/src/widgets/registry.ts';
import { mediaWidget } from '../../../vendor/home-pages/src/widgets/media.ts';
import { createApi } from '../../../vendor/home-pages/src/api.ts';
import { resumePomodoroTimers } from '../../../vendor/home-pages/src/widgets/pomodoro.ts';
import { Component, Modal, Notice } from './obsidian.mjs';
import { createVaultBridge } from './vault.mjs';
import { api, isPagesDemo, loadWorkspace, message } from '../../services/api.ts';
import { pdfResourceUrl } from '../../services/fileApi.ts';
import { appearanceVariables } from '../settings/appearanceStyle.ts';
import { appearanceSchema } from '../../../shared/appearance.ts';
import { mediaSources } from '../home/publicMedia.ts';

const demoKeySuffix = isPagesDemo ? ':' + new URL('./', document.baseURI).pathname : '';
const layoutKey = 'mlw-home-pages-v0.3.1' + demoKeySuffix;
const rootKey = 'mlw-home-pages-root' + demoKeySuffix;
const status = document.getElementById('web-status');
const select = document.getElementById('web-root');

if (isPagesDemo) {
  mediaWidget.render = (body, ctx) => {
    ctx.setSubtitle('官网入口');
    const empty = renderEmpty(body, {
      icon: 'newspaper',
      text: '在线体验版提供官网入口。文章列表可在本机完整版刷新。',
    });
    for (const { title, url } of Object.values(mediaSources)) {
      empty.createEl('a', { cls: 'hp-pill', text: title, attr: { href: url, target: '_blank', rel: 'noopener noreferrer' } });
    }
  };
}

class BrowserHomeView extends HomeView {
  promptAddWidget() {
    new AddWidgetModal(this.app, (kind) => this.insertWidget(kind)).open();
  }
  promptPasteWidget() {
    new Notice('网页中的自定义插件从工作台的「设置 → 插件」安装。');
  }
}

function initialLayout(workspace) {
  const config = sanitizeSettings(null);
  const page = config.pages[0];
  config.activePageId = page.id;
  const name = workspace.home.name;
  page.widgets = [
    createWidgetInstance('hero', { w: 12, h: 4, config: { name, showWeather: false } }),
    createWidgetInstance('habit', { w: 7, h: 8, config: { habits: workspace.home.habits.map(({ title }) => title) } }),
    createWidgetInstance('pomodoro', { w: 5, h: 8 }),
    ...(!isPagesDemo ? [createWidgetInstance('media', { w: 7, h: 8 })] : []),
    createWidgetInstance('recent', { w: 5, h: 8 }),
    createWidgetInstance('stats', { w: 4, h: 6 }),
    createWidgetInstance('countdown', { w: 4, h: 6 }),
    createWidgetInstance('onthisday', { w: 4, h: 6 }),
  ];
  return config;
}

class BrowserHomePages extends Component {
  constructor(app, settings) {
    super();
    this.settings = settings;
    this.app = app;
    this.api = createApi(this);
    this.customWidgetManager = {
      hasKind: () => false, getLoadedWidgets: () => [], loadAll: async () => 0,
      createDemoTemplate: async () => { new Notice('在工作台的「设置 → 插件」安装自定义插件。'); },
    };
  }
  getActivePage() { return this.settings.pages.find(({ id }) => id === this.settings.activePageId) ?? this.settings.pages[0]; }
  getActiveHomeView() { return this.view; }
  async saveSettings() {
    try {
      localStorage.setItem(layoutKey, JSON.stringify(this.settings));
    } catch {
      new Notice('首页布局未能保存。请检查浏览器本地存储空间。');
    }
  }
  refreshViews(options) {
    if (options?.layoutOnly) this.view.applyLayout();
    else if (options?.kind) this.view.refreshKind(options.kind);
    else this.view.render();
  }
  openSettings() {
    const host = new Modal(this.app);
    host.titleEl.setText('Home Pages 设置');
    const tab = new HomePagesSettingTab(this.app, this);
    host.contentEl.append(tab.containerEl);
    tab.display();
    host.open();
  }
}

function applyAppearance(appearance) {
  const variables = appearanceVariables(appearance);
  const elements = {
    ...Object.fromEntries(Object.entries(variables).filter(([name]) => name.startsWith('--glass-'))),
    '--background-secondary': variables['--canvas'], '--background-primary': variables['--surface'],
    '--background-modifier-border': variables['--border'], '--text-normal': variables['--text'],
    '--background-modifier-form-field': variables['--input'], '--text-muted': variables['--muted'],
    '--font-text': variables['--font-ui'], '--interactive-accent': variables['--primary'], '--text-on-accent': variables['--primary-text'],
    '--background-modifier-hover': variables['--accent-soft'], '--font-ui-medium': variables['--font-size'],
  };
  for (const [key, value] of Object.entries(elements)) document.documentElement.style.setProperty(key, value);
  document.body.classList.toggle('theme-dark', variables['--scheme'] === 'dark');
  document.documentElement.style.colorScheme = variables['--scheme'];
}

let embeddedAppearance;
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin || event.source !== window.parent || event.data?.kind !== 'home-pages-appearance') return;
  const parsed = appearanceSchema.safeParse(event.data.appearance);
  if (!parsed.success) return;
  embeddedAppearance = parsed.data;
  applyAppearance(embeddedAppearance);
});

async function start() {
  if (isPagesDemo) document.querySelector('.web-home-back').href = './#home';
  const [snapshot, roots] = await Promise.all([loadWorkspace(), api('/api/roots')]);
  applyAppearance(embeddedAppearance ?? snapshot.workspace.appearance);
  select.add(new Option('选择资料文件夹', ''));
  for (const root of roots) select.add(new Option(root.label, root.id));
  const preferred = localStorage.getItem(rootKey);
  select.value = roots.some(({ id }) => id === preferred) ? preferred : isPagesDemo ? roots[0]?.id ?? '' : '';
  const bridge = createVaultBridge((rootId, file) => {
    if (window.parent !== window) {
      window.parent.postMessage({ kind: 'home-pages-open', rootId, path: file.path }, window.location.origin);
    } else if (file.extension === 'pdf') {
      const url = pdfResourceUrl({ rootId, path: file.path });
      if (url) window.open(url, '_blank', 'noopener');
    } else if (isPagesDemo) {
      window.open(import.meta.env.BASE_URL + 'demo-note.txt', '_blank', 'noopener');
    } else {
      const root = roots.find(({ id }) => id === rootId);
      if (root) window.location.assign('obsidian://open?path=' + encodeURIComponent(root.directory + '/' + file.path));
    }
  }, select.value);
  await bridge.refresh();
  const persisted = localStorage.getItem(layoutKey);
  const layout = persisted ? sanitizeSettings(JSON.parse(persisted)) : initialLayout(snapshot.workspace);
  const plugin = new BrowserHomePages(bridge.app, layout);
  plugin.view = new BrowserHomeView({
    app: bridge.app, contentEl: document.getElementById('web-home'), actions: document.getElementById('web-view-actions'),
  }, plugin);
  resumePomodoroTimers(plugin);
  await plugin.view.onOpen();
  status.hidden = true;
  select.addEventListener('change', async () => {
    const next = select.value;
    try {
      await bridge.select(next);
      localStorage.setItem(rootKey, next);
      plugin.view.refreshWidgets();
    } catch (error) { new Notice(message(error)); }
  });
  window.addEventListener('pagehide', () => {
    void plugin.view.onClose();
    plugin.view.unload();
    plugin.unload();
  }, { once: true });
}

void start().catch((error) => { status.textContent = '首页加载失败。' + message(error); console.error(error); });
