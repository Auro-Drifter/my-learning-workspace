import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../server/app.ts';
import { defaultSlot, installPlugin, pluginLibrarySchema, pluginPackageSchema, pluginResultSchema } from '../shared/plugins.ts';
import { bundledPlugins } from '../src/features/plugins/bundled.ts';

test('packaged plugins have a versioned, validated public API', () => {
  const manifest = pluginPackageSchema.parse(bundledPlugins[0]);
  assert.equal(pluginPackageSchema.safeParse({ ...manifest, apiVersion: 2 }).success, false);
  assert.equal(pluginPackageSchema.safeParse({ ...manifest, fields: [...manifest.fields, manifest.fields[0]] }).success, false);
  assert.equal(pluginPackageSchema.safeParse({ ...manifest, fields: [{ ...manifest.fields[0], key: '__proto__' }] }).success, false);
  const installed = installPlugin(manifest);
  assert.equal(pluginLibrarySchema.safeParse({ disabledBuiltins: [], packages: [installed, installed] }).success, false);
  const second = defaultSlot(manifest);
  installed.home.settings.unit = '页';
  assert.equal(second.settings.unit, '完成次数');
});

test('plugin result accepts a fixed set of text and buttons and rejects arbitrary markup nodes', () => {
  assert.equal(pluginResultSchema.safeParse({ view: [{ kind: 'text', text: '<iframe />' }] }).success, true);
  assert.equal(pluginResultSchema.safeParse({ view: [{ kind: 'html', html: '<iframe />' }] }).success, false);
  assert.equal(pluginResultSchema.safeParse({ view: [{ kind: 'button', id: 'a', label: 'a', href: 'file:///test' }] }).success, false);
  assert.equal(pluginResultSchema.safeParse({ view: [], state: { nested: { value: 1 } } }).success, false);
});

test('runner contains one content-hashed bridge and a no-network worker policy', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'mlw-plugin-check-'));
  const host = '127.0.0.1:4173';
  const app = createApp({ dataDirectory: directory, hostForTests: host });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const result = await app.inject({ url: '/plugin-runtime', headers: { host } });
  assert.equal(result.statusCode, 200);
  const script = result.body.match(/<script>([\s\S]+)<\/script>/u)?.[1];
  assert.ok(script);
  const digest = createHash('sha256').update(script).digest('base64');
  const csp = String(result.headers['content-security-policy']);
  assert.ok(csp.includes("script-src 'sha256-" + digest + "'"));
  assert.match(csp, /connect-src 'none'/u);
  assert.match(csp, /sandbox allow-scripts$/u);
  assert.equal(result.headers['cache-control'], 'no-store');
});
