import { DEMO_ROOT_ID } from '../../shared/files.ts';
import type { ListedFile, RootGrant } from '../../shared/files.ts';
import { MAX_CONFIG_BYTES, snapshotSchema, workspaceSchema } from '../../shared/workspace.ts';
import type { Snapshot, Workspace } from '../../shared/workspace.ts';
import { ApiError } from './api.ts';

const storageKey = 'mlw-pages-workspace:' + new URL(import.meta.env.BASE_URL, document.baseURI).pathname;
const root: RootGrant = { id: DEMO_ROOT_ID, label: '演示资料', directory: '网页自带的示例文件', writable: false };
const files: ListedFile[] = [
  { path: '线性代数.md', kind: 'markdown' },
  { path: '教材示例.pdf', kind: 'pdf' },
];
let fixture: Promise<Workspace> | undefined;
const workspaceAsset = () => import.meta.env.BASE_URL + 'demo-workspace.json';

function loadSaved(): Snapshot | undefined {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved === null ? undefined : snapshotSchema.parse(JSON.parse(saved));
  } catch {
    throw new ApiError('无法读取这台浏览器的体验数据。请检查站点存储设置。', 500, 'read_failed');
  }
}

function saveSnapshot(snapshot: Snapshot) {
  const encoded = JSON.stringify(snapshot);
  if (new TextEncoder().encode(encoded).length > MAX_CONFIG_BYTES) {
    throw new ApiError('工作台配置过大。', 413, 'config_too_large');
  }
  try {
    localStorage.setItem(storageKey, encoded);
  } catch {
    throw new ApiError('无法保存到浏览器。请检查站点存储空间。', 507, 'write_failed');
  }
  return snapshot;
}

async function loadWorkspace() {
  const saved = loadSaved();
  if (saved) return saved;
  fixture ??= fetch(workspaceAsset()).then(async (response) => {
    if (!response.ok) throw new Error('暂时无法下载示例课程，请刷新重试。');
    return workspaceSchema.parse(await response.json());
  }).catch((error: unknown) => {
    fixture = undefined;
    throw error;
  });
  const workspace = await fixture;
  return loadSaved() ?? saveSnapshot({ workspace, revision: crypto.randomUUID() });
}

export async function demoRequest(url: string, method: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  const { pathname, searchParams } = new URL(url, window.location.origin);
  if (pathname === '/api/workspace' && method === 'GET') return loadWorkspace();
  if (pathname === '/api/workspace' && method === 'PUT') {
    const updated = snapshotSchema.safeParse(body);
    if (!updated.success) throw new ApiError('无法保存这份配置。', 400, 'invalid_workspace');
    const save = () => {
      if (loadSaved()?.revision !== updated.data.revision) {
        throw new ApiError('其他标签页已经保存更改。请导出当前草稿，再重新读取配置。', 409, 'stale_revision');
      }
      return saveSnapshot({ workspace: updated.data.workspace, revision: crypto.randomUUID() });
    };
    return navigator.locks ? navigator.locks.request(storageKey, save) : save();
  }
  if (pathname === '/api/roots' && method === 'GET') return [root];
  if (pathname === '/api/files' || pathname === '/api/note') {
    if (searchParams.get('rootId') !== DEMO_ROOT_ID) {
      throw new ApiError('体验版仅提供网页自带的示例资料。', 404, 'demo_file_only');
    }
    if (pathname === '/api/files' && method === 'GET') {
      const search = searchParams.get('search')?.toLowerCase() ?? '';
      const kind = searchParams.get('kind') ?? 'all';
      const matching = searchParams.get('folder') ? [] : files.filter((file) =>
        (kind === 'all' || kind === file.kind) && file.path.toLowerCase().includes(search));
      return { files: matching, limited: false };
    }
    if (pathname === '/api/note' && method === 'GET' && searchParams.get('path') === files[0].path) {
      const response = await fetch(import.meta.env.BASE_URL + 'demo-note.txt', { signal });
      if (!response.ok) throw new ApiError('示例笔记暂时无法打开。', response.status, 'demo_file_missing');
      return { text: await response.text(), version: '0'.repeat(64), writable: false, obsidianUri: '' };
    }
  }
  const feature = pathname === '/api/home-pages/public-source' ? '实时文章抓取' : '访问电脑里的文件';
  throw new ApiError('请在本机完整版使用' + feature + '。', 400, 'demo_unavailable');
}
