import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { externalAction, resourceSchema } from '../shared/actions.ts';
import { snapshotSchema, workspaceSchema } from '../shared/workspace.ts';
import { createApp } from '../server/app.ts';
import { createStore } from '../server/store.ts';
import { applyCourseTreeAction } from '../src/features/courses/courseExplorer.ts';

async function temporaryDirectory(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'mlw-tests-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('first load seeds five distinct courses and reload retains active course and isolated layout', async (t) => {
  const directory = await temporaryDirectory(t);
  const store = createStore(directory);
  const start = await store.load();
  const next = structuredClone(start.workspace);
  assert.equal(next.courses.length, 5);
  const linear = next.courses.find((course) => course.id === 'linear-algebra')!;
  const cs50 = next.courses.find((course) => course.id === 'cs50x')!;
  assert.equal(linear.widgets.some((widget) => widget.type === 'quickLinks'
    && widget.config.items.some((item) => item.title.includes('VS Code'))), false);
  assert.equal(cs50.widgets.some((widget) => widget.type === 'quickLinks'
    && widget.config.items.some((item) => item.title.includes('VS Code'))), true);
  linear.widgets[0].layout.y = 8;
  linear.widgets[0].enabled = false;
  next.activeCourseId = cs50.id;
  const saved = await store.save(next, start.revision);
  assert.deepEqual(await createStore(directory).load(), saved);
  assert.deepEqual(saved.workspace.courses.find((course) => course.id === cs50.id), cs50);
  const backup = snapshotSchema.parse(JSON.parse(await readFile(join(directory, 'workspace.json.bak'), 'utf8')));
  assert.deepEqual(backup, start);
  await assert.rejects(store.save(start.workspace, start.revision), { code: 'stale_revision' });
  assert.deepEqual(await store.load(), saved);
});

test('invalid and unsupported configuration is rejected, valid import restores into a clean store', async (t) => {
  const directory = await temporaryDirectory(t);
  const anotherDirectory = await temporaryDirectory(t);
  const store = createStore(directory);
  const initial = await store.load();
  const bad = structuredClone(initial.workspace);
  bad.courses.push(bad.courses[0]);
  await assert.rejects(store.save(bad, initial.revision), { code: 'invalid_workspace' });
  assert.equal(workspaceSchema.safeParse({ ...initial.workspace, schemaVersion: 999 }).success, false);
  assert.deepEqual(await store.load(), initial);
  const fresh = createStore(anotherDirectory);
  const old = await fresh.load();
  const restored = await fresh.save(workspaceSchema.parse(JSON.parse(JSON.stringify(initial.workspace))), old.revision);
  assert.deepEqual(restored.workspace, initial.workspace);
});

test('corrupt primary and missing primary with a backup never seed over existing data', async (t) => {
  const directory = await temporaryDirectory(t);
  const store = createStore(directory);
  const primary = join(directory, 'workspace.json');
  const initial = await store.load();
  await store.save(initial.workspace, initial.revision);
  await writeFile(primary, '{"bad":');
  await assert.rejects(createStore(directory).load(), { code: 'corrupt_workspace' });
  assert.equal(await readFile(primary, 'utf8'), '{"bad":');
  await rm(primary);
  await assert.rejects(createStore(directory).load(), { code: 'missing_workspace' });
  await assert.rejects(readFile(primary), { code: 'ENOENT' });
});

test('API rejects untrusted Host/Origin and stale concurrent edits', async (t) => {
  const directory = await temporaryDirectory(t);
  const host = '127.0.0.1:4173';
  const app = createApp({ dataDirectory: directory, hostForTests: host });
  t.after(() => app.close());
  const headers = { host };
  assert.equal((await app.inject({ url: '/api/workspace', headers: { host: 'unknown.test' } })).statusCode, 403);
  const result = await app.inject({ url: '/api/workspace', headers });
  assert.equal(result.statusCode, 200);
  const current = snapshotSchema.parse(result.json());
  const method = 'PUT';
  const url = '/api/workspace';
  const payload = { revision: current.revision, workspace: { ...current.workspace, activeCourseId: 'calculus' } };
  assert.equal((await app.inject({ method, url, headers, payload })).statusCode, 403);
  assert.equal((await app.inject({ method, url, headers: { host, origin: 'https://untrusted.test' }, payload })).statusCode, 403);
  const trusted = { host, origin: 'http://' + host };
  assert.equal((await app.inject({ method, url, headers: { ...trusted, 'content-type': 'text/plain' }, payload: '{}' })).statusCode, 415);
  const simultaneous = await Promise.all([
    app.inject({ method, url, headers: trusted, payload }),
    app.inject({ method, url, headers: trusted, payload }),
  ]);
  assert.deepEqual(simultaneous.map((response) => response.statusCode).sort(), [200, 409]);
});

test('shortcut validation and URI encoding for real actions', () => {
  const base = { id: 'id', title: '打开', icon: '' };
  for (const url of ['javascript:alert(1)', 'file:///C:/test.md', 'https://alice:secret@example.org/', 'data:text/html,test']) {
    assert.equal(resourceSchema.safeParse({ ...base, kind: 'web', url }).success, false);
  }
  const web = resourceSchema.parse({ ...base, kind: 'web', url: 'https://example.org/chapter' });
  assert.deepEqual(externalAction(web), { href: 'https://example.org/chapter', copy: 'https://example.org/chapter', newTab: true });
  const vscode = resourceSchema.parse({ ...base, kind: 'vscode', path: 'C:\\课程 A\\示例 #1.c' });
  assert.equal(externalAction(vscode)?.href, 'vscode://file/C:/%E8%AF%BE%E7%A8%8B%20A/%E7%A4%BA%E4%BE%8B%20%231.c');
  const obsidian = resourceSchema.parse({ ...base, kind: 'obsidian', vault: 'Test & Notes', file: 'A/B.md' });
  assert.equal(externalAction(obsidian)?.href, 'obsidian://open?vault=Test%20%26%20Notes&file=A%2FB.md');
  const spaced = resourceSchema.parse({ ...obsidian, vault: 'Test & Notes\u00a0' });
  assert.equal(externalAction(spaced)?.href, 'obsidian://open?vault=Test%20%26%20Notes%C2%A0&file=A%2FB.md');
  const authorized = ['C:\\Study\\Test & Notes\u00a0'];
  const repaired = externalAction(obsidian, authorized)!;
  assert.equal(new URL(repaired.href).searchParams.get('path'), 'C:\\Study\\Test & Notes\u00a0\\A\\B.md');
  assert.equal(repaired.copy, repaired.href);
  const vaultOnly = resourceSchema.parse({ ...base, kind: 'obsidian', vault: 'Test & Notes', file: '' });
  assert.equal(new URL(externalAction(vaultOnly, authorized)!.href).searchParams.get('vault'), 'Test & Notes\u00a0');
  assert.equal(externalAction(obsidian, [...authorized, 'C:\\Other\\Test & Notes'])?.href, externalAction(obsidian)?.href);
  assert.equal(resourceSchema.safeParse({ ...base, kind: 'vscode', path: 'C:\\a\\..\\b' }).success, false);
});

test('sidebar moves courses and whole folders without altering other course data', async (t) => {
  const { workspace } = await createStore(await temporaryDirectory(t)).load();
  const { courses } = workspace;
  const moved = applyCourseTreeAction(workspace, { type: 'move', items: [{ kind: 'course', key: 'cs61a' }], target: '编程入门/C 方向' });
  assert.deepEqual(moved.courses.find(({ id }) => id === 'cs61a')?.navigationPath, ['编程入门', 'C 方向']);
  assert.equal(moved.courses.find(({ id }) => id === 'calculus'), courses.find(({ id }) => id === 'calculus'));
  const group = { kind: 'folder', key: '编程入门' } as const;
  assert.throws(() => applyCourseTreeAction(moved, { type: 'move', items: [group], target: '编程入门/C 方向' }), /子文件夹/);
  const level1 = applyCourseTreeAction(moved, { type: 'create-folder', parent: '', name: '第一层' });
  const level2 = applyCourseTreeAction(level1, { type: 'create-folder', parent: '第一层', name: '第二层' });
  assert.throws(() => applyCourseTreeAction(level2, { type: 'move', items: [group], target: '第一层/第二层' }), /超过三级/);
  const folder = applyCourseTreeAction(moved, { type: 'move', items: [{ kind: 'folder', key: '编程入门/C 方向' }], target: '' });
  for (const id of ['c', 'cs50x', 'cs61a']) {
    assert.deepEqual(folder.courses.find((course) => course.id === id)?.navigationPath, ['C 方向']);
  }
  assert.ok(folder.courseExplorer?.folders.some((path) => path.join('/') === '编程入门'), 'The empty source parent survives.');
});

test('sidebar keeps folder and course state across rename, duplicate, trash, restore and purge', async (t) => {
  const store = createStore(await temporaryDirectory(t));
  const { workspace, revision } = await store.load();
  const pending = applyCourseTreeAction(workspace, { type: 'create-folder', parent: '编程入门/C 方向', name: '空文件夹' });
  const folder = { kind: 'folder', key: '编程入门/C 方向' } as const;
  const course = { kind: 'course', key: 'cs50x' } as const;
  const bookmarked = applyCourseTreeAction(pending, { type: 'bookmark', item: folder });
  const renamed = applyCourseTreeAction(bookmarked, { type: 'rename', item: folder, name: 'C 语言路线' });
  assert.ok(renamed.courseExplorer?.folders.some((path) => path.join('/') === '编程入门/C 语言路线/空文件夹'));
  assert.deepEqual(renamed.courseExplorer?.bookmarks, ['folder:编程入门/C 语言路线']);
  const copy = applyCourseTreeAction(renamed, { type: 'duplicate', items: [course] });
  assert.equal(copy.courses.length, workspace.courses.length + 1);
  assert.equal(copy.courses.at(-1)?.name, 'CS50x 副本');
  const saved = await store.save(copy, revision);
  const removed = applyCourseTreeAction(saved.workspace, { type: 'trash', items: [{ ...folder, key: '编程入门/C 语言路线' }, course] });
  const [record] = removed.courseExplorer!.trash;
  assert.equal(record.title, 'C 语言路线');
  assert.ok(record.courses.includes(course.key));
  assert.equal(removed.courses.find(({ id }) => id === course.key)?.archived, true);
  const restored = applyCourseTreeAction(removed, { type: 'restore', id: record.id });
  assert.deepEqual(restored.courses, saved.workspace.courses);
  assert.deepEqual(restored.courseExplorer?.folders.map((path) => path.join('/')).sort(), saved.workspace.courseExplorer?.folders.map((path) => path.join('/')).sort());
  const purged = applyCourseTreeAction(removed, { type: 'purge', id: record.id });
  assert.ok(purged.courses.every(({ id }) => !record.courses.includes(id)));
  assert.deepEqual(purged.courseExplorer?.bookmarks, []);
  await store.save(purged, saved.revision);
});
