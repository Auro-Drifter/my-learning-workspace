import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import type { FileLocation } from '../shared/actions.ts';
import { obsidianPathUri, relativePathSchema } from '../shared/actions.ts';
import type { FileKind, FileListing, LibraryQuery, NoteDocument, NoteSaveResult } from '../shared/files.ts';
import { fileKind, MAX_NOTE_BYTES, MAX_PDF_BYTES } from '../shared/files.ts';
import { AppError, atomicWrite, hasCode, withWriteLock } from './filesystem.ts';
import type { RootStore } from './roots.ts';
import { inside } from './roots.ts';

const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const invalidFile = () => new AppError(400, 'invalid_file', '文件路径、类型或格式无效。');
const changedFile = () => new AppError(409, 'note_conflict', '磁盘上的文件已变化。请查看磁盘版本后再处理。');

async function checkPath(root: string, path: string, directory = false) {
  if (!path && directory) return root;
  if (!relativePathSchema.safeParse(path).success) throw invalidFile();
  let current = root;
  const pieces = path.split('/');
  try {
    for (const [index, piece] of pieces.entries()) {
      current = join(current, piece);
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new AppError(403, 'symlink_denied', '不支持符号链接或目录联接。');
      const expectedDirectory = directory || index < pieces.length - 1;
      if (expectedDirectory ? !info.isDirectory() : !info.isFile() || info.nlink > 1) throw invalidFile();
    }
    const canonical = await realpath(current);
    if (!inside(root, canonical)) throw new AppError(403, 'path_escape', '路径超出了授权目录。');
    return canonical;
  } catch (error) {
    if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) throw new AppError(404, 'file_missing', '目标文件或目录不存在。');
    throw error;
  }
}

async function readBounded(path: string, limit: number) {
  const flags = process.platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  const expected = await lstat(path, { bigint: true });
  const file = await open(path, flags);
  try {
    const info = await file.stat({ bigint: true });
    if (!info.isFile() || expected.isSymbolicLink() || info.nlink > 1 || info.ino !== expected.ino || info.dev !== expected.dev) throw invalidFile();
    if (info.size > BigInt(limit)) throw new AppError(413, 'file_too_large', '文件超过大小限制。');
    const bytes = Buffer.alloc(Number(info.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw changedFile();
      offset += bytesRead;
    }
    const restat = await file.stat({ bigint: true });
    if (restat.mtimeNs !== info.mtimeNs || restat.size !== info.size || restat.ctimeNs !== info.ctimeNs) throw changedFile();
    return { bytes, version: digest(info.mtimeNs.toString() + ':' + info.ino + ':' + digest(bytes)), mode: Number(info.mode & 0o777n) };
  } finally {
    await file.close();
  }
}

export function createResources(roots: RootStore, dataDirectory: string) {
  async function resolveFile(location: FileLocation, type: FileKind) {
    if (fileKind(location.path) !== type) throw invalidFile();
    const root = await roots.get(location.rootId);
    return { path: await checkPath(root.directory, location.path), root };
  }

  async function locate(path: string, type: FileKind, preferredRoot?: string) {
    if (fileKind(path) !== type) throw invalidFile();
    const grants = await roots.list();
    const matches = grants.filter(({ directory }) => inside(directory, path));
    const root = matches.find(({ id }) => id === preferredRoot)
      ?? matches.sort((a, b) => b.directory.length - a.directory.length)[0];
    if (root) {
      const location = { rootId: root.id, path: relative(root.directory, path).split(sep).join('/') };
      await resolveFile(location, type);
      return { location, roots: grants };
    }
    const directory = dirname(path);
    const canonical = await checkPath(directory, basename(path));
    const id = 'folder-' + crypto.randomUUID();
    const next = await roots.grant({
      id, label: basename(directory).trim().slice(0, 120) || '学习资料', directory, writable: false,
    });
    const granted = next.find((entry) => entry.id === id)!;
    return { location: { rootId: id, path: relative(granted.directory, canonical).split(sep).join('/') }, roots: next };
  }

  async function list(query: LibraryQuery): Promise<FileListing> {
    const { directory } = await roots.get(query.rootId);
    const initial = await checkPath(directory, query.folder, true);
    const result: FileListing = { files: [], limited: false };
    const needle = query.search.trim().toLocaleLowerCase();
    let inspected = 0;

    async function scan(current: string, prefix: string, depth: number) {
      if (depth > 30) {
        result.limited = true;
        return;
      }
      for await (const entry of await opendir(current)) {
        inspected++;
        if (inspected > 16000 || (!query.metadata && result.files.length >= 500)) {
          result.limited = true;
          break;
        }
        if (entry.isSymbolicLink() || entry.name.startsWith('.') || !relativePathSchema.safeParse(entry.name).success) continue;
        const tail = prefix ? prefix + '/' + entry.name : entry.name;
        if (entry.isDirectory()) {
          try {
            const child = await checkPath(directory, tail, true);
            await scan(child, tail, depth + 1);
          } catch (error) {
            if (!hasCode(error, 'EACCES') && !hasCode(error, 'EPERM')) throw error;
            result.limited = true;
          }
          continue;
        }
        const kind = fileKind(entry.name);
        if (entry.isFile() && kind && (query.kind === 'all' || query.kind === kind) && tail.toLocaleLowerCase().includes(needle)) {
          try {
            const path = await checkPath(directory, tail);
            const info = await lstat(path);
            if (!info.isFile() || info.nlink !== 1) continue;
            result.files.push(query.metadata
              ? { path: tail, kind, modifiedAt: info.mtimeMs, createdAt: info.birthtimeMs, bytes: info.size }
              : { path: tail, kind });
          } catch (failure) {
            if (!(failure instanceof AppError && [400, 403, 404].includes(failure.status))
              && !hasCode(failure, 'ENOENT') && !hasCode(failure, 'EACCES') && !hasCode(failure, 'EPERM')) throw failure;
          }
        }
      }
    }

    await scan(initial, query.folder, 0);
    result.files.sort((a, b) => (query.metadata ? (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0) : 0) || a.path.localeCompare(b.path));
    if (result.files.length > 500) {
      result.limited = true;
      result.files = result.files.slice(0, 500);
    }
    return result;
  }

  async function inspectNote(location: FileLocation) {
    const { path, root } = await resolveFile(location, 'markdown');
    const data = await readBounded(path, MAX_NOTE_BYTES);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(data.bytes);
      if (text.includes('\u0000')) throw invalidFile();
    } catch {
      throw new AppError(415, 'invalid_encoding', '只能编辑 UTF-8 编码的 Markdown。');
    }
    const note: NoteDocument = { text, version: data.version, writable: root.writable, obsidianUri: obsidianPathUri(path) };
    return { ...data, note, path };
  }

  async function note(location: FileLocation) {
    return (await inspectNote(location)).note;
  }

  async function saveNote(location: FileLocation, version: string, text: string): Promise<NoteSaveResult> {
    const { path, root } = await resolveFile(location, 'markdown');
    if (!root.writable) throw new AppError(403, 'read_only_root', '该目录仅授权读取。');
    const key = digest(process.platform === 'win32' ? path.toLocaleLowerCase('en-US') : path);
    return withWriteLock(join(dataDirectory, 'note-locks', key + '.lock'), async () => {
      const current = await inspectNote(location);
      if (!current.note.writable || current.path !== path || current.version !== version) throw changedFile();
      const encodingMark = current.bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? current.bytes.subarray(0, 3) : Buffer.alloc(0);
      const bytes = Buffer.concat([encodingMark, Buffer.from(text, 'utf8')]);
      if (bytes.length > MAX_NOTE_BYTES) throw new AppError(413, 'file_too_large', '笔记超过 1 MiB。');
      const backupFile = 'note-backups/' + key + '.md';
      if (!bytes.equals(current.bytes)) {
        await mkdir(join(dataDirectory, 'note-backups'), { recursive: true });
        await atomicWrite(join(dataDirectory, backupFile), current.bytes);
        await atomicWrite(path, bytes, current.mode, async () => {
          const latest = await inspectNote(location);
          if (!latest.note.writable || latest.path !== path || latest.version !== version) throw changedFile();
        });
      }
      const saved = await inspectNote(location);
      if (!saved.bytes.equals(bytes)) throw changedFile();
      return { note: saved.note, backupFile };
    });
  }

  async function pdf(location: FileLocation) {
    const { path } = await resolveFile(location, 'pdf');
    const { bytes } = await readBounded(path, MAX_PDF_BYTES);
    if (!bytes.subarray(0, 1024).includes('%PDF-')) throw invalidFile();
    return bytes;
  }
  return { list, locate, note, saveNote, pdf };
}
