import { lstat, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, parse, relative, sep } from 'node:path';
import { z } from 'zod';
import { DEMO_ROOT_ID, rootSchema } from '../shared/files.ts';
import type { RootGrant } from '../shared/files.ts';
import { AppError, atomicWrite, hasCode, withWriteLock } from './filesystem.ts';
import { generateExamples } from './demoFiles.ts';
import { stringifyJson } from './store.ts';

const grantsSchema = z.strictObject({ schemaVersion: z.literal(1), roots: z.array(rootSchema).max(40) })
  .refine(({ roots }) => new Set(roots.map((root) => root.id)).size === roots.length);

export function inside(root: string, candidate: string) {
  const tail = relative(root, candidate);
  return !isAbsolute(tail) && tail !== '..' && !tail.startsWith('..' + sep);
}

async function canonicalDirectory(directory: string) {
  try {
    if (!isAbsolute(directory) || (process.platform === 'win32' && !/^[a-z]:[\\/]/iu.test(directory))) {
      throw new Error('absolute local path required');
    }
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('directory required');
    const path = await realpath(directory);
    if (path === parse(path).root || (process.platform === 'win32' && !/^[a-z]:[\\/]/iu.test(path))) {
      throw new Error('drive root or network directory');
    }
    return path;
  } catch {
    throw new AppError(400, 'invalid_directory', '请输入可访问的本机子目录。盘符根目录、网络路径和目录链接不支持。');
  }
}

export function createRootStore(dataDirectory: string) {
  const primary = join(dataDirectory, 'roots.json');
  const backup = join(dataDirectory, 'roots.json.bak');
  const lock = join(dataDirectory, 'roots.lock');

  async function read(): Promise<RootGrant[] | null> {
    const content = await readFile(primary, 'utf8').catch((error: unknown) => {
      if (hasCode(error, 'ENOENT')) return null;
      throw error;
    });
    if (content === null) return null;
    try {
      return grantsSchema.parse(JSON.parse(content)).roots;
    } catch {
      throw new AppError(500, 'corrupt_roots', '目录授权文件无法读取。请按 README 检查 roots.json 或备份。');
    }
  }

  async function write(roots: RootGrant[], previous?: RootGrant[]) {
    const encode = (values: RootGrant[]) => stringifyJson(grantsSchema.parse({ schemaVersion: 1, roots: values }));
    if (previous) await atomicWrite(backup, encode(previous));
    await atomicWrite(primary, encode(roots));
  }

  async function readOrCreate(): Promise<RootGrant[]> {
    const existing = await read();
    if (existing) return existing;
    const hasBackup = await stat(backup).then(() => true, (error: unknown) => {
      if (hasCode(error, 'ENOENT')) return false;
      throw error;
    });
    if (hasBackup) throw new AppError(500, 'missing_roots', '目录授权文件缺失，检测到备份。');
    const examples = join(dataDirectory, 'examples');
    await mkdir(examples, { recursive: true });
    const directory = await canonicalDirectory(examples);
    if (!inside(await realpath(dataDirectory), directory)) throw new AppError(403, 'path_escape', '演示目录超出了应用数据目录。');
    await generateExamples(directory);
    const roots = [{ id: DEMO_ROOT_ID, label: '演示资料', directory, writable: true }];
    await write(roots);
    return roots;
  }

  async function list() {
    return (await read()) ?? withWriteLock(lock, readOrCreate);
  }

  async function grant(input: RootGrant) {
    if (input.id === DEMO_ROOT_ID) throw new AppError(400, 'reserved_root', 'demo 是内置演示目录 ID。');
    return withWriteLock(lock, async () => {
      const roots = await readOrCreate();
      if (roots.some((root) => root.id === input.id)) {
        throw new AppError(409, 'root_exists', '授权 ID 已存在，请使用不同 ID 或先撤销旧授权。');
      }
      if (roots.length >= 40) throw new AppError(400, 'too_many_roots', '目录授权已达上限。');
      const directory = await canonicalDirectory(input.directory);
      const dataPath = await realpath(dataDirectory);
      if (inside(directory, dataPath) || inside(dataPath, directory)) {
        throw new AppError(400, 'data_overlap', '授权目录不能与应用数据目录重叠。');
      }
      const next = [...roots, { ...input, directory }];
      await write(next, roots);
      return next;
    });
  }

  async function reconnect(input: RootGrant) {
    if (input.id === DEMO_ROOT_ID) throw new AppError(400, 'reserved_root', '内置演示目录不能重新连接。');
    return withWriteLock(lock, async () => {
      const roots = await readOrCreate();
      if (!roots.some((root) => root.id === input.id)) {
        throw new AppError(403, 'root_not_granted', '该目录尚未授权，无法重新连接。');
      }
      const directory = await canonicalDirectory(input.directory);
      const dataPath = await realpath(dataDirectory);
      if (inside(directory, dataPath) || inside(dataPath, directory)) {
        throw new AppError(400, 'data_overlap', '授权目录不能与应用数据目录重叠。');
      }
      const next = roots.map((root) => root.id === input.id ? { ...input, directory } : root);
      await write(next, roots);
      return next;
    });
  }

  async function revoke(id: string) {
    return withWriteLock(lock, async () => {
      const roots = await readOrCreate();
      if (id === DEMO_ROOT_ID) throw new AppError(400, 'reserved_root', '内置演示目录始终可用。');
      const next = roots.filter((root) => root.id !== id);
      if (next.length !== roots.length) await write(next, roots);
      return next;
    });
  }

  async function get(id: string) {
    const found = (await list()).find((root) => root.id === id);
    if (!found) throw new AppError(403, 'root_not_granted', '该目录尚未授权。请在设置中使用目录 ID ' + id + ' 添加授权。');
    let directory: string;
    try {
      directory = await canonicalDirectory(found.directory);
    } catch (error) {
      if (error instanceof AppError && error.code === 'invalid_directory') {
        throw new AppError(403, 'root_unavailable', '授权目录当前不可访问，请在设置中重新连接。');
      }
      throw error;
    }
    const unchanged = process.platform === 'win32'
      ? directory.toLocaleLowerCase('en-US') === found.directory.toLocaleLowerCase('en-US')
      : directory === found.directory;
    if (!unchanged) throw new AppError(403, 'root_changed', '授权目录已变化，请重新授权。');
    return directory === found.directory ? found : { ...found, directory };
  }

  return { list, grant, reconnect, revoke, get };
}

export type RootStore = ReturnType<typeof createRootStore>;
