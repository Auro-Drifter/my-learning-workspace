import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

export async function atomicWrite(target: string, data: string | Uint8Array, mode = 0o600, beforeReplace?: () => Promise<void>) {
  const temporary = join(dirname(target), '.mlw-' + randomUUID() + '.tmp');
  const file = await open(temporary, 'wx', mode);
  try {
    try {
      await file.writeFile(data);
      await file.sync();
    } finally {
      await file.close();
    }
    if (beforeReplace) await beforeReplace();
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function withWriteLock<T>(lock: string, action: () => Promise<T>): Promise<T> {
  await mkdir(dirname(lock), { recursive: true });
  const file = await open(lock, 'wx', 0o600).catch((error: unknown) => {
    if (hasCode(error, 'EEXIST')) throw new AppError(409, 'store_busy', '数据正在写入，请稍后重试。');
    throw error;
  });
  try {
    return await action();
  } finally {
    await file.close();
    await rm(lock, { force: true });
  }
}
