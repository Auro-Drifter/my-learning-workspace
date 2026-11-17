import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { link, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { EditorState } from '@codemirror/state';
import { createApp } from '../server/app.ts';
import { createResources } from '../server/resources.ts';
import { createRootStore } from '../server/roots.ts';
import { AppError } from '../server/filesystem.ts';
import { applyEditorChanges } from '../src/features/notes/editorText.ts';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'mlw-file-tests-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = join(root, 'app-data');
  const allowed = join(root, 'allowed');
  const outside = join(root, 'outside');
  await Promise.all([mkdir(allowed), mkdir(outside)]);
  const roots = createRootStore(data);
  const files = createResources(roots, data);
  return { data, allowed, outside, roots, files };
}

test('Markdown preserves UTF-8 BOM, mixed formatting and raw Markdown, with saved backup and conflict detection', async (t) => {
  const { data, allowed, roots, files } = await fixture(t);
  const initial = '---\r\ntitle: 笔记\n---\r\n\r\n[[双链]]\r\n![[图示.png]]\n';
  const file = join(allowed, 'example.md');
  const location = { rootId: 'test', path: 'example.md' };
  await writeFile(file, '\uFEFF' + initial);
  await roots.grant({ id: 'test', label: '测试目录', directory: allowed, writable: true });
  const original = await files.note(location);
  assert.equal(original.text, initial);
  assert.ok(original.obsidianUri.startsWith('obsidian://open?path='));
  const changed = initial.replace('笔记', '笔记 A');
  const saved = await files.saveNote(location, original.version, changed);
  assert.equal(await readFile(file, 'utf8'), '\uFEFF' + changed);
  assert.equal(await readFile(join(data, saved.backupFile), 'utf8'), '\uFEFF' + initial);
  await writeFile(file, '\uFEFF' + changed + '由外部应用改动\n');
  await assert.rejects(files.saveNote(location, saved.note.version, '覆盖尝试'), { code: 'note_conflict' });
  assert.equal(await readFile(file, 'utf8'), '\uFEFF' + changed + '由外部应用改动\n');
  assert.equal(await readFile(join(data, saved.backupFile), 'utf8'), '\uFEFF' + initial);
});

test('actual editor changes leave unrelated mixed line endings and frontmatter byte-preserved', () => {
  const original = '---\r\ntitle: 示例\n---\r\n原文\r\n[[双链]]\n';
  const state = EditorState.create({ doc: original });
  const normalized = state.doc.toString();
  const from = normalized.indexOf('原文');
  const transaction = state.update({ changes: { from, to: from + 2, insert: '修改\n多一行' } });
  const result = applyEditorChanges(original, transaction.changes);
  assert.equal(result, '---\r\ntitle: 示例\n---\r\n修改\r\n多一行\r\n[[双链]]\n');
  const second = transaction.state.update({ changes: [{ from: 0, to: 3, insert: '===' }, { from: transaction.state.doc.length, insert: '结尾' }] });
  assert.equal(applyEditorChanges(result, second.changes), result.replace('---', '===') + '结尾');
});

test('authorized root rejects traversal, junctions, hard links and writes to read-only roots', async (t) => {
  const { allowed, outside, roots, files } = await fixture(t);
  const secret = join(outside, 'outside.md');
  await writeFile(secret, 'private');
  await writeFile(join(allowed, 'readme.md'), 'public');
  await symlink(outside, join(allowed, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  await link(secret, join(allowed, 'hard.md'));
  const rootId = 'public';
  await roots.grant({ id: rootId, label: '只读测试目录', directory: allowed, writable: false });
  for (const path of ['../outside/outside.md', 'outside/../readme.md', 'C:/outside.md', 'readme.md:secret', 'hard.md']) {
    await assert.rejects(files.note({ rootId, path }), { code: 'invalid_file' });
  }
  await assert.rejects(files.note({ rootId, path: 'outside/outside.md' }), { code: 'symlink_denied' });
  const listing = await files.list({ rootId, folder: '', kind: 'markdown', search: 'readme' });
  assert.deepEqual(listing.files, [{ path: 'readme.md', kind: 'markdown' }]);
  const fullListing = await files.list({ rootId, folder: '', kind: 'all', search: '' });
  assert.deepEqual(fullListing.files, [{ path: 'readme.md', kind: 'markdown' }]);
  const homeListing = await files.list({ rootId, folder: '', kind: 'all', search: '', metadata: '1' });
  assert.deepEqual(homeListing.files.map(({ path, kind, bytes }) => ({ path, kind, bytes })), [
    { path: 'readme.md', kind: 'markdown', bytes: 6 },
  ]);
  assert.ok(homeListing.files[0].modifiedAt && homeListing.files[0].createdAt);
  const note = await files.note({ rootId, path: 'readme.md' });
  await assert.rejects(files.saveNote({ rootId, path: 'readme.md' }, note.version, 'new'), { code: 'read_only_root' });
  await roots.revoke(rootId);
  await assert.rejects(files.note({ rootId, path: 'readme.md' }), { code: 'root_not_granted' });
  assert.equal(await readFile(secret, 'utf8'), 'private');
  assert.equal(await readFile(join(allowed, 'readme.md'), 'utf8'), 'public');
});

test('directory rename is reported clearly and the same root can be reconnected without losing write access', async (t) => {
  const { allowed, roots, files } = await fixture(t);
  const location = { rootId: 'test', path: 'readme.md' };
  await writeFile(join(allowed, 'readme.md'), 'public');
  await roots.grant({ id: 'test', label: '测试目录', directory: allowed, writable: true });
  let current = allowed;
  if (process.platform === 'win32') {
    current = join(allowed, '..', 'ALLOWED');
    await rename(allowed, current);
    assert.equal((await files.note(location)).text, 'public');
  }
  const moved = join(allowed, '..', 'moved');
  await rename(current, moved);
  await assert.rejects(files.note(location), { code: 'root_unavailable' });
  const reconnected = await roots.reconnect({ id: 'test', label: '测试目录', directory: moved, writable: true });
  assert.equal(reconnected.find(({ id }) => id === 'test')?.directory, await realpath(moved));
  assert.equal(reconnected.find(({ id }) => id === 'test')?.writable, true);
  assert.equal((await files.note(location)).text, 'public');
});

test('an unreadable child directory does not hide readable sibling files', { skip: process.platform !== 'win32' }, async (t) => {
  const { allowed, roots, files } = await fixture(t);
  const blocked = join(allowed, 'blocked');
  await mkdir(blocked);
  await Promise.all([writeFile(join(allowed, 'readme.md'), 'public'), writeFile(join(blocked, 'private.md'), 'private')]);
  await roots.grant({ id: 'test', label: '测试目录', directory: allowed, writable: false });
  const run = promisify(execFile);
  await run('icacls', [blocked, '/deny', '*S-1-1-0:(OI)(CI)(R)']);
  try {
    const listing = await files.list({ rootId: 'test', folder: '', kind: 'all', search: '' });
    assert.deepEqual(listing.files, [{ path: 'readme.md', kind: 'markdown' }]);
    assert.equal(listing.limited, true);
  } finally {
    await run('icacls', [blocked, '/remove:d', '*S-1-1-0']);
  }
});

test('demo file endpoints return Markdown and valid PDF data, missing file and write origins are checked', async (t) => {
  const { data, allowed } = await fixture(t);
  const host = '127.0.0.1:4173';
  const app = createApp({
    dataDirectory: data, hostForTests: host,
    pdfAssetDirectory: fileURLToPath(new URL('../node_modules/pdfjs-dist', import.meta.url)),
  });
  t.after(() => app.close());
  const headers = { host };
  const note = await app.inject({ url: '/api/note?' + new URLSearchParams({ rootId: 'demo', path: '线性代数.md' }), headers });
  assert.equal(note.statusCode, 200);
  assert.match(note.json().text, /\[\[向量空间\]\]/u);
  const pdf = await app.inject({ url: '/api/pdf?' + new URLSearchParams({ rootId: 'demo', path: '教材示例.pdf' }), headers });
  assert.equal(pdf.statusCode, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.ok(pdf.rawPayload.subarray(0, 8).equals(Buffer.from('%PDF-1.4')));
  const wasm = await app.inject({ url: '/pdf-assets/wasm/jbig2.wasm', headers });
  assert.equal(wasm.statusCode, 200);
  assert.ok(wasm.rawPayload.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d])));
  const missing = await app.inject({ url: '/api/pdf?rootId=demo&path=gone.pdf', headers });
  assert.equal(missing.statusCode, 404);
  const url = '/api/roots';
  const payload = { id: 'outside', label: '测试目录', directory: allowed, writable: true };
  assert.equal((await app.inject({ method: 'POST', url, headers: { host, origin: 'https://untrusted.test' }, payload })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url, headers: { host, origin: 'http://' + host }, payload })).statusCode, 200);
  const moved = join(allowed, '..', 'reconnected');
  await rename(allowed, moved);
  const reconnected = { ...payload, directory: moved, writable: false };
  assert.equal((await app.inject({ method: 'PUT', url, headers: { host, origin: 'https://untrusted.test' }, payload: reconnected })).statusCode, 403);
  const update = await app.inject({ method: 'PUT', url, headers: { host, origin: 'http://' + host }, payload: reconnected });
  assert.equal(update.statusCode, 200);
  assert.equal(update.json().find(({ id }: { id: string }) => id === 'outside').writable, false);
  const revoke = await app.inject({
    method: 'DELETE', url, headers: { host, origin: 'http://' + host, 'content-type': 'application/json' }, payload: JSON.stringify('outside'),
  });
  assert.equal(revoke.statusCode, 200);
  assert.equal(revoke.json().length, 1);
});

test('local picker fills scoped paths and grants only explicitly picked documents', async (t) => {
  const { data, allowed, outside, roots } = await fixture(t);
  const vault = await realpath(allowed);
  const outsidePath = await realpath(outside);
  await mkdir(join(vault, '.obsidian'));
  await mkdir(join(vault, '资料'));
  const note = join(vault, '资料', '带 空格的笔记.md');
  const pdf = join(vault, '资料', '资料.pdf');
  const outsideNote = join(outsidePath, 'private.md');
  await Promise.all([writeFile(note, '测试'), writeFile(pdf, '%PDF-1.4'), writeFile(outsideNote, 'private')]);
  await symlink(outsidePath, join(vault, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await roots.grant({ id: 'test', label: '测试目录', directory: vault, writable: false });
  const grantsBefore = await roots.list();
  const host = '127.0.0.1:4173';
  let picked: string | null = note;
  const choices: { kind: string; directory: string }[] = [];
  const app = createApp({ dataDirectory: data, hostForTests: host, chooseLocalPath: async (kind, directory) => {
    choices.push({ kind, directory });
    return picked;
  } });
  t.after(() => app.close());
  const url = '/api/local-picker';
  const headers = { host, origin: 'http://' + host };
  const pick = (kind: string, rootId?: string) => app.inject({ method: 'POST', url, headers, payload: { kind, rootId } });
  const untrusted = await app.inject({ method: 'POST', url, headers: { host, origin: 'https://other.test' }, payload: { kind: 'markdown' } });
  assert.equal(untrusted.statusCode, 403);
  assert.equal((await pick('anything-else')).statusCode, 400);
  assert.equal(choices.length, 0);

  assert.deepEqual((await pick('markdown', 'test')).json().selection,
    { kind: 'document', location: { rootId: 'test', path: '资料/带 空格的笔记.md' }, roots: grantsBefore });
  assert.deepEqual(choices[0], { kind: 'markdown', directory: vault });
  assert.deepEqual((await pick('obsidian-note')).json().selection, { kind: 'obsidian', vault: 'allowed', file: '资料/带 空格的笔记.md' });
  picked = pdf;
  assert.deepEqual((await pick('pdf')).json().selection,
    { kind: 'document', location: { rootId: 'test', path: '资料/资料.pdf' }, roots: grantsBefore });
  assert.equal((await pick('markdown')).statusCode, 400);
  assert.deepEqual((await pick('vscode-file')).json().selection, { kind: 'path', path: pdf });
  picked = vault;
  assert.deepEqual((await pick('obsidian-vault')).json().selection, { kind: 'obsidian', vault: 'allowed', file: '' });
  const unicodeVaultName = "Auro's Test Vault\u00a0";
  const unicodeVault = join(vault, unicodeVaultName);
  await mkdir(join(unicodeVault, '.obsidian'), { recursive: true });
  picked = join(unicodeVault, '线性代数.md');
  await writeFile(picked, '测试');
  assert.deepEqual((await pick('obsidian-note')).json().selection,
    { kind: 'obsidian', vault: unicodeVaultName, file: '线性代数.md' });
  picked = vault;
  assert.deepEqual((await pick('vscode-folder')).json().selection, { kind: 'path', path: vault });
  picked = join(outsidePath, 'missing.md');
  assert.equal((await pick('markdown')).json().code, 'file_missing');
  assert.deepEqual(await roots.list(), grantsBefore);
  picked = outsideNote;
  const outsideSelection = (await pick('markdown')).json().selection;
  const outsideGrants = await roots.list();
  const granted = outsideGrants.find((root) => root.directory === outsidePath);
  assert.equal(granted?.writable, false);
  assert.equal(granted?.label, 'outside');
  assert.deepEqual(outsideSelection, {
    kind: 'document', location: { rootId: granted?.id, path: 'private.md' }, roots: outsideGrants,
  });
  assert.equal((await pick('obsidian-note')).json().code, 'obsidian_vault_missing');
  picked = join(vault, 'linked', 'private.md');
  assert.equal((await pick('markdown')).json().code, 'symlink_denied');
  picked = outsidePath;
  assert.deepEqual((await pick('root-folder')).json().selection, { kind: 'path', path: outsidePath });
  picked = null;
  assert.deepEqual((await pick('markdown')).json(), { selection: null });
  assert.deepEqual(await roots.list(), outsideGrants);
  assert.equal(await readFile(note, 'utf8'), '测试');
});

test('local picker releases its mutex after cancellation and failure', async (t) => {
  const { data } = await fixture(t);
  const host = '127.0.0.1:4173';
  let calls = 0;
  let release!: (value: string | null) => void;
  let announce!: () => void;
  const started = new Promise<void>((resolve) => { announce = resolve; });
  const app = createApp({ dataDirectory: data, hostForTests: host, chooseLocalPath: async () => {
    calls++;
    if (calls === 1) {
      const waiting = new Promise<string | null>((resolve) => { release = resolve; });
      announce();
      return waiting;
    }
    if (calls === 2) throw new AppError(503, 'picker_unavailable', '测试失败');
    return null;
  } });
  t.after(() => app.close());
  const headers = { host, origin: 'http://' + host };
  const request = () => app.inject({ method: 'POST', url: '/api/local-picker', headers, payload: { kind: 'root-folder' } });
  const first = request();
  await started;
  const occupied = await request();
  assert.equal(occupied.statusCode, 409);
  assert.equal(occupied.json().code, 'picker_open');
  assert.equal(calls, 1);
  release(null);
  assert.equal((await first).statusCode, 200);
  assert.equal((await request()).statusCode, 503);
  const retry = await request();
  assert.equal(retry.statusCode, 200);
  assert.deepEqual(retry.json(), { selection: null });
  assert.equal(calls, 3);
});

test('closing the app aborts an active local picker', async (t) => {
  const { data } = await fixture(t);
  const host = '127.0.0.1:4173';
  let announce!: () => void;
  let observed: AbortSignal | undefined;
  const started = new Promise<void>((resolve) => { announce = resolve; });
  const app = createApp({ dataDirectory: data, hostForTests: host, chooseLocalPath: async (_kind, _directory, signal) => {
    observed = signal;
    announce();
    return new Promise((_, reject) => {
      const abort = () => reject(new AppError(503, 'picker_unavailable', '选择器已关闭'));
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
  } });
  t.after(() => app.close());
  const pending = app.inject({
    method: 'POST', url: '/api/local-picker', headers: { host, origin: 'http://' + host }, payload: { kind: 'root-folder' },
  });
  await started;
  await app.close();
  assert.equal(observed?.aborted, true);
  assert.equal((await pending).statusCode, 503);
});

test('local picker still opens when the preferred root is unavailable', async (t) => {
  const { data, allowed, roots } = await fixture(t);
  await roots.grant({ id: 'test', label: '测试目录', directory: allowed, writable: false });
  await rename(allowed, join(allowed, '..', 'moved'));
  const choices: { kind: string; directory: string }[] = [];
  const host = '127.0.0.1:4173';
  const app = createApp({ dataDirectory: data, hostForTests: host, chooseLocalPath: async (kind, directory) => {
    choices.push({ kind, directory });
    return null;
  } });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST', url: '/api/local-picker', headers: { host, origin: 'http://' + host },
    payload: { kind: 'markdown', rootId: 'test' },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { selection: null });
  assert.deepEqual(choices, [{ kind: 'markdown', directory: '' }]);
});

test('invalid UTF-8 is readable only as a clear error and remains untouched', async (t) => {
  const { allowed, roots, files } = await fixture(t);
  await roots.grant({ id: 'sample', label: '测试目录', directory: allowed, writable: true });
  const file = join(allowed, 'bad.md');
  const bytes = Buffer.from([0xff, 0xc0, 0x00]);
  await writeFile(file, bytes);
  await assert.rejects(files.note({ rootId: 'sample', path: 'bad.md' }), { code: 'invalid_encoding' });
  assert.deepEqual(await readFile(file), bytes);
});
