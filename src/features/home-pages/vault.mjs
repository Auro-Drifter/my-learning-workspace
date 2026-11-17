// Maps the upstream vault view to one folder explicitly chosen from the workbench's grants.
import { api } from '../../services/api.ts';
import { loadNote, pdfResourceUrl, saveNote } from '../../services/fileApi.ts';
import { TFile, TFolder, normalizePath } from './obsidian.mjs';

const parentPath = (path) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

function events() {
  const callbacks = new Map();
  return {
    on(name, callback) {
      const handlers = callbacks.get(name) ?? new Set();
      callbacks.set(name, handlers);
      handlers.add(callback);
      return () => handlers.delete(callback);
    },
    trigger(name, ...args) {
      for (const callback of callbacks.get(name) ?? []) callback(...args);
    },
  };
}

export function createVaultBridge(open, rootId) {
  const root = new TFolder('');
  const files = new Map([['', root]]);
  const metadata = new Map();
  const vaultEvents = events();
  const metadataEvents = events();
  let refreshVersion = 0;
  let activeRoot = rootId;
  function folder(path) {
    if (files.has(path)) return files.get(path);
    const parent = folder(parentPath(path));
    const created = new TFolder(path, parent);
    parent.children.push(created);
    files.set(path, created);
    return created;
  }
  async function refresh() {
    const revision = ++refreshVersion;
    const data = activeRoot ? await api('/api/files?' + new URLSearchParams({
      rootId: activeRoot, folder: '', kind: 'all', search: '', metadata: '1',
    })) : { files: [] };
    if (revision !== refreshVersion) return;
    root.children.length = 0;
    files.clear();
    metadata.clear();
    files.set('', root);
    for (const entry of data.files) {
      const parent = folder(parentPath(entry.path));
      const item = new TFile(entry.path, parent, { ctime: entry.createdAt ?? 0, mtime: entry.modifiedAt ?? 0, size: entry.bytes ?? 0 });
      files.set(entry.path, item);
      parent.children.push(item);
    }
    metadataEvents.trigger('resolved');
  }
  async function read(path) {
    if (!activeRoot) throw new Error('请先选择资料文件夹。');
    const result = await loadNote({ rootId: activeRoot, path });
    const tags = [...result.text.matchAll(/(?:^|\s)(#[\p{L}\p{N}_/-]+)/gu)].map((hit) => ({ tag: hit[1] }));
    metadata.set(path, { tags });
    return result;
  }
  async function edit(path, change) {
    const rootId = activeRoot;
    if (!rootId) throw new Error('请先选择资料文件夹。');
    const location = { rootId, path };
    const before = await loadNote(location);
    if (!before.writable) throw new Error('这个资料文件夹只允许查看笔记。');
    const next = await saveNote(location, change(before.text), before.version);
    vaultEvents.trigger('modify', files.get(path));
    return next.note.text;
  }
  const readText = async (file) => (await read(file.path)).text;
  const vault = {
    ...vaultEvents,
    configDir: '.obsidian',
    getRoot: () => root,
    getFiles: () => [...files.values()].filter((item) => item instanceof TFile),
    getMarkdownFiles: () => vault.getFiles().filter((file) => file.extension === 'md'),
    getAllLoadedFiles: () => [...files.values()],
    getAbstractFileByPath: (path) => files.get(normalizePath(path)) ?? null,
    getResourcePath: (item) => vault.adapter.getResourcePath(item.path),
    read: readText,
    cachedRead: readText,
    modify: (file, text) => edit(file.path, () => text),
    process: (file, change) => edit(file.path, change),
    async create() { throw new Error('在工作台的文件夹设置中先建立所需的 Markdown 文件。'); },
    async createFolder() { throw new Error('请在资源管理器里新建文件夹。'); },
    adapter: {
      exists: async (path) => files.has(normalizePath(path)),
      list: async (path) => {
        const current = files.get(normalizePath(path));
        const children = current instanceof TFolder ? current.children : [];
        return {
          files: children.filter((item) => item instanceof TFile).map((item) => item.path),
          folders: children.filter((item) => item instanceof TFolder).map((item) => item.path),
        };
      },
      async read(path) {
        if (!files.has(normalizePath(path))) throw new Error('此文件未出现在所选的资料文件夹中。');
        return (await read(path)).text;
      },
      write: (path, text) => edit(path, () => text),
      getResourcePath: (path) => activeRoot && /\.pdf$/iu.test(path)
        ? pdfResourceUrl({ rootId: activeRoot, path }) : '',
    },
  };
  const openPath = (path) => {
    const file = files.get(normalizePath(path.split('#')[0]))
      ?? vault.getMarkdownFiles().find(({ basename }) => basename === path);
    if (activeRoot && file instanceof TFile) open(activeRoot, file);
  };
  const leaf = { openFile: (file) => openPath(file.path) };
  const app = {
    vault,
    metadataCache: {
      ...metadataEvents,
      getFileCache: (file) => metadata.get(file.path) ?? null,
      getFirstLinkpathDest: (path) => files.get(normalizePath(path)) ?? null,
    },
    workspace: { ...events(), getLeaf: () => leaf, openLinkText: openPath },
    plugins: { plugins: Object.create(null) },
    commands: { commands: Object.create(null), executeCommandById: () => false },
    fileManager: { async trashFile() { throw new Error('请在资源管理器里移除文件。'); } },
  };
  return { app, refresh, select: (id) => { activeRoot = id; return refresh(); } };
}
