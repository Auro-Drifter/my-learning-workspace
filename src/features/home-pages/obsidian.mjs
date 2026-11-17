// Browser implementations of the Obsidian APIs used by the vendored Home Pages view.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server.browser';
import { icons } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../services/api.ts';

function element(tag, options = {}) {
  const node = document.createElement(tag);
  if (options.cls) node.classList.add(...(Array.isArray(options.cls) ? options.cls : options.cls.split(/\s+/u).filter(Boolean)));
  if (options.text !== undefined) node.textContent = options.text;
  if (options.type) node.setAttribute('type', options.type);
  if (options.value !== undefined) node.value = options.value;
  for (const [key, value] of Object.entries(options.attr ?? {})) node.setAttribute(key, value);
  return node;
}

function append(parent, tag, options, configure) {
  const node = element(tag, options);
  parent.append(node);
  configure?.(node);
  return node;
}

Object.assign(globalThis, {
  createDiv: (options, configure) => { const node = element('div', options); configure?.(node); return node; },
  createEl: element,
});

function createSvg(tag, options = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (options.cls) node.classList.add(...String(options.cls).split(/\s+/u).filter(Boolean));
  for (const [name, value] of Object.entries(options.attr ?? {})) node.setAttribute(name, value);
  this.append(node);
  return node;
}

Object.assign(SVGElement.prototype, {
  createSvg,
  setAttr(key, value) { this.setAttribute(key, String(value)); },
});
Object.assign(HTMLElement.prototype, {
  createSvg,
  createEl(tag, options, configure) { return append(this, tag, options, configure); },
  createDiv(options, configure) { return append(this, 'div', options, configure); },
  createSpan(options, configure) { return append(this, 'span', options, configure); },
  empty() { this.replaceChildren(); },
  setText(text) { this.textContent = text; },
  addClass(...classes) { this.classList.add(...classes); },
  removeClass(...classes) { this.classList.remove(...classes); },
  toggleClass(name, value) { return this.classList.toggle(name, !!value); },
  hasClass(name) { return this.classList.contains(name); },
  setAttr(key, value) { this.setAttribute(key, String(value)); },
  setCssProps(props) { for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value); },
  onClickEvent(callback) { this.addEventListener('click', callback); },
  hide() { this.hidden = true; },
  show() { this.hidden = false; },
});

export function setIcon(node, name) {
  const key = String(name).replace(/^lucide-/u, '').split('-').map((part) => part.replace(/^./u, (first) => first.toUpperCase())).join('');
  const Icon = icons[key] ?? icons.Circle;
  const svg = renderToStaticMarkup(createElement(Icon, { size: 16, 'aria-hidden': true }));
  node.replaceChildren(new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement);
}

export class Component {
  cleanups = [];
  register(cleanup) { this.cleanups.push(cleanup); }
  registerEvent(off) { if (typeof off === 'function') this.register(off); }
  registerInterval(id) { this.register(() => clearInterval(id)); return id; }
  registerDomEvent(el, name, handler, options) {
    el.addEventListener(name, handler, options);
    this.register(() => el.removeEventListener(name, handler, options));
  }
  addChild(child) { this.register(() => child.unload()); child.load(); return child; }
  removeChild(child) { child.unload(); return child; }
  load() { this.onload?.(); }
  unload() { this.onunload?.(); for (const cleanup of this.cleanups.splice(0).reverse()) cleanup(); }
}

export class ItemView extends Component {
  constructor(leaf) { super(); this.leaf = leaf; this.app = leaf.app; this.contentEl = leaf.contentEl; }
  addAction(icon, text, action) {
    const node = append(this.leaf.actions, 'button', { cls: 'clickable-icon', attr: { type: 'button', title: text, 'aria-label': text } });
    setIcon(node, icon);
    node.addEventListener('click', action);
    return node;
  }
}

export class PluginSettingTab {
  constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = element('div'); }
}

const noticeHost = append(document.body, 'div', { cls: 'web-notices', attr: { 'aria-live': 'polite' } });
export class Notice {
  constructor(text, duration = 3500) {
    this.noticeEl = append(noticeHost, 'div', { cls: 'web-notice' });
    this.setMessage(text);
    if (duration > 0) setTimeout(() => this.hide(), duration);
  }
  setMessage(text) { this.noticeEl.replaceChildren(text instanceof DocumentFragment ? text : String(text)); return this; }
  hide() { this.noticeEl.remove(); }
}

export class Modal {
  constructor(app) {
    this.app = app;
    this.modalEl = element('dialog', { cls: 'modal glass-dialog' });
    const headingId = 'modal-' + crypto.randomUUID();
    this.modalEl.setAttribute('aria-labelledby', headingId);
    this.titleEl = append(this.modalEl, 'h2', { cls: 'modal-title', attr: { id: headingId } });
    const close = append(this.modalEl, 'button', { cls: 'modal-close-button clickable-icon', attr: { type: 'button', 'aria-label': '关闭' } });
    setIcon(close, 'x');
    close.addEventListener('click', () => this.close());
    this.contentEl = append(this.modalEl, 'div', { cls: 'modal-content' });
    this.modalEl.addEventListener('close', () => { this.onClose?.(); this.modalEl.remove(); });
  }
  open() { document.body.append(this.modalEl); this.onOpen?.(); this.modalEl.showModal(); }
  close() { this.modalEl.close(); }
  setTitle(title) { this.titleEl.setText(title); return this; }
}

class Control {
  constructor(el, type) { this.inputEl = el; this.selectEl = el; this.buttonEl = el; this.type = type; }
  setValue(value) { if (this.type === 'toggle') this.inputEl.checked = !!value; else this.inputEl.value = value; this.output?.replaceChildren(this.inputEl.value); return this; }
  getValue() { return this.type === 'toggle' ? this.inputEl.checked : this.inputEl.value; }
  setPlaceholder(value) { this.inputEl.placeholder = value; return this; }
  setButtonText(value) { this.buttonEl.textContent = value; this.buttonEl.removeAttribute('aria-label'); return this; }
  setTooltip(value) { this.inputEl.title = value; this.inputEl.setAttribute('aria-label', value); return this; }
  setIcon(value) { setIcon(this.buttonEl, value); return this; }
  setCta() { this.buttonEl.classList.add('mod-cta'); return this; }
  setWarning() { this.buttonEl.classList.add('mod-warning'); return this; }
  setDisabled(value) { this.inputEl.disabled = value; return this; }
  setLimits(min, max, step) { Object.assign(this.inputEl, { min, max, step }); return this; }
  setDynamicTooltip() {
    this.output = element('output', { text: this.inputEl.value });
    this.inputEl.before(this.output);
    this.inputEl.addEventListener('input', () => { this.output.value = this.inputEl.value; });
    return this;
  }
  addOption(value, text) { this.selectEl.add(new Option(text, value)); return this; }
  addOptions(options) { for (const [value, text] of Object.entries(options)) this.addOption(value, text); return this; }
  onChange(handler) {
    this.inputEl.addEventListener(this.type === 'toggle' || this.type === 'dropdown' ? 'change' : 'input', () =>
      handler(this.type === 'slider' ? Number(this.inputEl.value) : this.getValue()));
    return this;
  }
  onClick(handler) { this.buttonEl.addEventListener('click', handler); return this; }
}

export class Setting {
  constructor(parent) {
    this.settingEl = append(parent, 'div', { cls: 'setting-item' });
    this.infoEl = append(this.settingEl, 'div', { cls: 'setting-item-info' });
    this.nameEl = append(this.infoEl, 'div', { cls: 'setting-item-name' });
    this.descEl = append(this.infoEl, 'div', { cls: 'setting-item-description' });
    this.controlEl = append(this.settingEl, 'div', { cls: 'setting-item-control' });
  }
  setName(value) { this.nameEl.replaceChildren(value); return this; }
  setDesc(value) { this.descEl.replaceChildren(value); return this; }
  setHeading() { this.settingEl.classList.add('setting-item-heading'); return this; }
  setClass(name) { this.settingEl.classList.add(name); return this; }
  add(type, tag, attr, callback) {
    const el = append(this.controlEl, tag, { attr: { 'aria-label': this.nameEl.textContent || '设置', ...attr } });
    const control = new Control(el, type);
    callback(control);
    return this;
  }
  addText(callback) { return this.add('text', 'input', { type: 'text' }, callback); }
  addTextArea(callback) { return this.add('text', 'textarea', {}, callback); }
  addDropdown(callback) { return this.add('dropdown', 'select', {}, callback); }
  addToggle(callback) { return this.add('toggle', 'input', { type: 'checkbox', role: 'switch', class: 'checkbox-container' }, callback); }
  addSlider(callback) { return this.add('slider', 'input', { type: 'range' }, callback); }
  addButton(callback) { return this.add('button', 'button', { type: 'button' }, callback); }
  addExtraButton(callback) { return this.add('button', 'button', { type: 'button', class: 'clickable-icon' }, callback); }
}

export class Menu {
  constructor() { this.el = element('div', { cls: 'menu', attr: { role: 'menu' } }); }
  addSeparator() { append(this.el, 'hr'); return this; }
  addItem(configure) {
    const node = append(this.el, 'button', { cls: 'menu-item', attr: { type: 'button', role: 'menuitem' } });
    const icon = append(node, 'span');
    const text = append(node, 'span');
    const item = {
      setTitle: (value) => { text.textContent = value; return item; },
      setIcon: (value) => { setIcon(icon, value); return item; },
      setDisabled: (value) => { node.disabled = value; return item; },
      onClick: (callback) => { node.addEventListener('click', (event) => { this.hide(); callback(event); }); return item; },
    };
    configure(item);
    return this;
  }
  showAtMouseEvent(event) { this.showAtPosition({ x: event.clientX, y: event.clientY }); }
  showAtPosition({ x, y }) {
    document.body.append(this.el);
    this.el.style.left = Math.max(0, Math.min(x, innerWidth - this.el.offsetWidth - 8)) + 'px';
    this.el.style.top = Math.max(0, Math.min(y, innerHeight - this.el.offsetHeight - 8)) + 'px';
    this.dismiss = (event) => { if (event.key === 'Escape' || (event.type === 'pointerdown' && !this.el.contains(event.target))) this.hide(); };
    document.addEventListener('pointerdown', this.dismiss);
    document.addEventListener('keydown', this.dismiss);
  }
  hide() { this.el.remove(); document.removeEventListener('pointerdown', this.dismiss); document.removeEventListener('keydown', this.dismiss); }
}

export class AbstractInputSuggest {
  constructor(app, inputEl) {
    this.app = app;
    this.inputEl = inputEl;
    const list = element('div', { cls: 'suggestion-container hidden', attr: { role: 'listbox' } });
    inputEl.after(list);
    this.list = list;
    const refresh = async () => {
      const value = inputEl.value;
      const options = await this.getSuggestions(value);
      if (document.activeElement !== inputEl || inputEl.value !== value) return;
      list.empty();
      for (const option of options.slice(0, 25)) {
        const item = append(list, 'button', { cls: 'suggestion-item', attr: { type: 'button' } });
        this.renderSuggestion(option, item);
        item.addEventListener('pointerdown', (event) => event.preventDefault());
        item.addEventListener('click', () => this.selectSuggestion(option));
      }
      list.hidden = !options.length;
      list.classList.remove('hidden');
    };
    inputEl.addEventListener('input', refresh);
    inputEl.addEventListener('focus', refresh);
    inputEl.addEventListener('blur', () => this.close());
    inputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.list.hidden) { event.preventDefault(); event.stopPropagation(); this.close(); }
    });
  }
  setValue(value) { this.inputEl.value = value; }
  close() { this.list.hidden = true; }
}

export class FuzzySuggestModal extends Modal {}
export class App {}
export class WorkspaceLeaf {}
export class Plugin extends Component {}

export class TAbstractFile {
  constructor(path, parent = null) { this.path = path; this.name = path.split('/').at(-1) ?? ''; this.parent = parent; }
}
export class TFile extends TAbstractFile {
  constructor(path, parent, stat) {
    super(path, parent);
    const dot = this.name.lastIndexOf('.');
    this.extension = dot > 0 ? this.name.slice(dot + 1) : '';
    this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
    this.stat = stat;
  }
}
export class TFolder extends TAbstractFile {
  children = [];
  isRoot() { return !this.parent; }
}

export const normalizePath = (path) => path.replaceAll('\\', '/').replace(/\/{2,}/gu, '/').replace(/^\/|\/$/gu, '');
export const Keymap = { isModEvent: (event) => event.ctrlKey || event.metaKey };

export const MarkdownRenderer = {
  async render(_app, markdown, node, _path, _owner) {
    node.classList.add('markdown-rendered');
    const rendered = renderToStaticMarkup(createElement(Markdown, {
      skipHtml: true, remarkPlugins: [remarkGfm], urlTransform: (url) => /^https?:\/\//iu.test(url) ? url : '',
      components: { img: ({ alt }) => createElement('span', null, alt || '图片'),
        a: ({ href, children }) => href ? createElement('a', { href, target: '_blank', rel: 'noopener noreferrer' }, children)
          : createElement('span', null, children) },
    }, markdown));
    node.replaceChildren(...new DOMParser().parseFromString(rendered, 'text/html').body.childNodes);
  },
};

export async function requestUrl(input) {
  const url = typeof input === 'string' ? input : input.url;
  const { text, status } = await api('/api/home-pages/public-source', 'POST', { url });
  return { text, status, get json() { return JSON.parse(text); } };
}
