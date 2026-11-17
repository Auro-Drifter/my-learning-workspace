import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_CONFIG_BYTES, snapshotSchema, workspaceSchema } from '../shared/workspace.ts';
import type { Snapshot, Workspace } from '../shared/workspace.ts';
import { AppError, atomicWrite, hasCode, withWriteLock } from './filesystem.ts';
import { createDemo } from './demo.ts';

export function stringifyJson(value: unknown) {
  return JSON.stringify(value, null, 2) + '\n';
}

export function createStore(directory: string) {
  const primary = join(directory, 'workspace.json');
  const backup = join(directory, 'workspace.json.bak');
  const lock = join(directory, 'workspace.lock');

  async function read(): Promise<{ snapshot: Snapshot; bytes: Buffer } | null> {
    const bytes = await readFile(primary).catch((error: unknown) => {
      if (hasCode(error, 'ENOENT')) return null;
      throw error;
    });
    if (!bytes) return null;
    try {
      const snapshot = snapshotSchema.parse(JSON.parse(bytes.toString('utf8')));
      return { snapshot, bytes };
    } catch {
      throw new AppError(500, 'corrupt_workspace', 'workspace.json 无法解析或版本不支持。原文件已保留，请按 README 从备份恢复。');
    }
  }

  async function load(): Promise<Snapshot> {
    const existing = await read();
    if (existing) return existing.snapshot;
    return withWriteLock(lock, async () => {
      const current = await read();
      if (current) return current.snapshot;
      const hasBackup = await stat(backup).then(() => true, (error: unknown) => {
        if (hasCode(error, 'ENOENT')) return false;
        throw error;
      });
      if (hasBackup) throw new AppError(500, 'missing_workspace', '主配置缺失，检测到备份。请按 README 恢复。');
      const snapshot = { revision: randomUUID(), workspace: workspaceSchema.parse(createDemo()) };
      await atomicWrite(primary, stringifyJson(snapshot));
      return snapshot;
    });
  }

  async function save(workspace: Workspace, revision: string): Promise<Snapshot> {
    const checked = workspaceSchema.safeParse(workspace);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      throw new AppError(400, 'invalid_workspace', '配置无效，字段 ' + (issue.path.join('.') || '根') + '。' + issue.message);
    }
    return withWriteLock(lock, async () => {
      const previous = await read();
      if (!previous || previous.snapshot.revision !== revision) {
        throw new AppError(409, 'stale_revision', '磁盘上已有更新。请导出当前草稿，再重新读取配置。');
      }
      const snapshot = { revision: randomUUID(), workspace: checked.data };
      const encoded = stringifyJson(snapshot);
      if (Buffer.byteLength(encoded) > MAX_CONFIG_BYTES) {
        throw new AppError(413, 'config_too_large', '配置文件过大。');
      }
      await atomicWrite(backup, previous.bytes);
      await atomicWrite(primary, encoded);
      return snapshot;
    });
  }

  return { load, save };
}
