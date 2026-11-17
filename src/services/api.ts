import { z } from 'zod';
import { appearanceSchema } from '../../shared/appearance.ts';
import { snapshotSchema } from '../../shared/workspace.ts';
import type { Snapshot, Workspace } from '../../shared/workspace.ts';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const isPagesDemo = import.meta.env?.MODE === 'pages';

export async function api<T>(url: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  if (isPagesDemo) {
    const { demoRequest } = await import('./pagesDemo.ts');
    return await demoRequest(url, method, body, signal) as T;
  }
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    signal,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.message ?? '本地服务请求失败。', response.status, data?.code ?? 'request_failed');
  return data as T;
}

const legacyDialogKey = 'mlw-dialog-appearance';
const legacyDialogSchema = appearanceSchema.pick({ dialogTransparency: true, dialogTint: true }).extend({ revision: z.uuid() });
type DialogAppearance = Pick<Workspace['appearance'], 'dialogTransparency' | 'dialogTint'>;

export type WorkspaceSnapshot = Snapshot & {
  supportsDialogAppearance: boolean;
  dialogAppearanceTemporary?: boolean;
};

function readSnapshot(value: unknown): WorkspaceSnapshot {
  const snapshot = snapshotSchema.parse(value);
  // The parsed schema fills in defaults, so capability detection uses the actual response.
  const appearance = (value as { workspace: { appearance?: object } }).workspace.appearance;
  return {
    ...snapshot,
    supportsDialogAppearance: !!appearance && Object.hasOwn(appearance, 'dialogTransparency') && Object.hasOwn(appearance, 'dialogTint'),
  };
}

function withDialogAppearance(snapshot: WorkspaceSnapshot, appearance: DialogAppearance): WorkspaceSnapshot {
  const { dialogTransparency, dialogTint } = appearance;
  return {
    ...snapshot,
    workspace: { ...snapshot.workspace, appearance: { ...snapshot.workspace.appearance, dialogTransparency, dialogTint } },
  };
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  const snapshot = readSnapshot(await api('/api/workspace'));
  const { dialogTransparency, dialogTint } = snapshot.workspace.appearance;
  if (dialogTransparency !== null || dialogTint !== null) return snapshot;
  try {
    const saved = legacyDialogSchema.safeParse(JSON.parse(localStorage.getItem(legacyDialogKey) ?? 'null'));
    // The revision also lets the same workspace keep its settings after the backend is upgraded.
    if (saved.success && saved.data.revision === snapshot.revision) return withDialogAppearance(snapshot, saved.data);
  } catch { /* Storage is optional for reading the workspace. */ }
  return snapshot;
}

export async function saveWorkspace(workspace: Workspace, previous: WorkspaceSnapshot): Promise<WorkspaceSnapshot> {
  const { dialogTransparency, dialogTint, ...legacyAppearance } = workspace.appearance;
  const payload = previous.supportsDialogAppearance ? workspace : { ...workspace, appearance: legacyAppearance };
  const snapshot = readSnapshot(await api('/api/workspace', 'PUT', { workspace: payload, revision: previous.revision }));
  if (previous.supportsDialogAppearance || (dialogTransparency === null && dialogTint === null)) return snapshot;

  const settings = { dialogTransparency, dialogTint };
  const merged = withDialogAppearance(snapshot, settings);
  try {
    localStorage.setItem(legacyDialogKey, JSON.stringify({ ...settings, revision: snapshot.revision }));
    return merged;
  } catch {
    // The server already saved other changes. Keep its new revision even if the browser blocks local storage.
    return { ...merged, dialogAppearanceTemporary: true };
  }
}

export function message(error: unknown): string {
  if (error instanceof ApiError && ['root_not_granted', 'root_changed', 'root_unavailable'].includes(error.code)) {
    return '暂时打不开这个文件。请到「设置 → 资料文件夹」添加或重新连接文件夹。';
  }
  return error instanceof Error ? error.message : '操作失败，请重试。';
}
