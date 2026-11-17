import Fastify from 'fastify';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { MAX_CONFIG_BYTES } from '../shared/workspace.ts';
import type { Workspace } from '../shared/workspace.ts';
import { AppError } from './filesystem.ts';
import { createStore } from './store.ts';
import { fileLocationSchema, idSchema } from '../shared/actions.ts';
import { librarySchema, localPickerSchema, noteWriteSchema, rootSchema } from '../shared/files.ts';
import { createRootStore } from './roots.ts';
import { createResources } from './resources.ts';
import { runnerCsp, runnerHtml } from './pluginRunner.ts';
import { createLocalPicker } from './localPicker.ts';
import { publicHomeFeedSchema } from '../shared/homeWidgets.ts';
import { readPublicHomeFeed } from './homeFeeds.ts';
import { readHomePagesSource } from './homePagesSource.ts';
import type { ChooseLocalPath } from './localPicker.ts';

const saveEnvelope = z.strictObject({ revision: z.uuid(), workspace: z.unknown() });

function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new AppError(400, 'invalid_input', (issue.path.join('.') || '输入') + ' · ' + issue.message);
  }
  return result.data;
}

type AppOptions = {
  dataDirectory: string;
  staticDirectory?: string;
  pdfAssetDirectory?: string;
  devOrigin?: string;
  hostForTests?: string;
  chooseLocalPath?: ChooseLocalPath;
};

export function createApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ bodyLimit: MAX_CONFIG_BYTES });
  const store = createStore(options.dataDirectory);
  const roots = createRootStore(options.dataDirectory);
  const resources = createResources(roots, options.dataDirectory);
  const picker = createLocalPicker(roots, resources, options.chooseLocalPath);
  app.addHook('onListen', async () => { picker.warmup(); });
  app.addHook('preClose', async () => { picker.close(); });

  app.addHook('onRequest', async (request, reply) => {
    const address = app.server.address();
    const host = options.hostForTests ?? (address && typeof address === 'object' ? '127.0.0.1:' + address.port : '');
    if (!host || request.headers.host !== host) throw new AppError(403, 'untrusted_host', '只接受本机回环地址。');
    const origin = request.headers.origin;
    const trustedOrigin = options.devOrigin ?? 'http://' + host;
    if ((origin && origin !== trustedOrigin) || request.headers['sec-fetch-site'] === 'cross-site') {
      throw new AppError(403, 'untrusted_origin', '请求来源不受信任。');
    }

    const apiRequest = request.url.startsWith('/api/');
    if (apiRequest) reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');

    if (apiRequest && !['GET', 'HEAD'].includes(request.method)) {
      if (origin !== trustedOrigin) throw new AppError(403, 'untrusted_origin', '写入需要本应用的同源请求。');
      if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw new AppError(415, 'json_required', '写入需要 JSON 请求。');
      }
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) return reply.code(error.status).send({ code: error.code, message: error.message });
    const status = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(status).send({ code: 'bad_request', message: '请求内容有误或超过大小限制。' });
    }
    request.log.error('Local storage operation failed');
    return reply.code(500).send({ code: 'storage_error', message: '本地读写失败，请检查目录权限、文件占用或剩余磁盘空间。' });
  });

  app.get('/plugin-runtime', async (_request, reply) => reply
    .header('Content-Security-Policy', runnerCsp)
    .header('Cache-Control', 'no-store')
    .type('text/html; charset=utf-8').send(runnerHtml));
  app.get('/api/workspace', async () => store.load());
  app.put('/api/workspace', async (request) => {
    const result = saveEnvelope.safeParse(request.body);
    if (!result.success) throw new AppError(400, 'invalid_request', '保存请求缺少有效版本或配置。');
    return store.save(result.data.workspace as Workspace, result.data.revision);
  });

  app.get('/api/roots', async () => roots.list());
  app.post('/api/roots', async (request) => roots.grant(validate(rootSchema, request.body)));
  app.put('/api/roots', async (request) => roots.reconnect(validate(rootSchema, request.body)));
  app.delete('/api/roots', async (request) => roots.revoke(validate(idSchema, request.body)));
  app.post('/api/local-picker', async (request, reply) => {
    const selection = validate(localPickerSchema, request.body);
    const controller = new AbortController();
    const abort = () => controller.abort();
    reply.raw.once('close', abort);
    try {
      return { selection: await picker.pick(selection, controller.signal) };
    } finally {
      reply.raw.off('close', abort);
    }
  });
  app.post('/api/home/feed', async (request) => readPublicHomeFeed(validate(z.strictObject({ id: publicHomeFeedSchema }), request.body).id));
  app.post('/api/home-pages/public-source', async (request) =>
    readHomePagesSource(validate(z.strictObject({ url: z.string().max(2000) }), request.body).url));
  app.get('/api/files', async (request) => resources.list(validate(librarySchema, request.query)));
  app.get('/api/note', async (request) => resources.note(validate(fileLocationSchema, request.query)));
  app.put('/api/note', { bodyLimit: 8 * 1024 * 1024 }, async (request) => {
    const { rootId, path, version, text } = validate(noteWriteSchema, request.body);
    return resources.saveNote({ rootId, path }, version, text);
  });
  app.get('/api/pdf', async (request, reply) => {
    const bytes = await resources.pdf(validate(fileLocationSchema, request.query));
    return reply.type('application/pdf').header('Content-Disposition', 'attachment').send(bytes);
  });

  if (options.pdfAssetDirectory) {
    for (const collection of ['cmaps', 'standard_fonts', 'wasm']) {
      app.register(fastifyStatic, {
        root: join(options.pdfAssetDirectory, collection), prefix: '/pdf-assets/' + collection + '/', decorateReply: false,
      });
    }
  }

  if (options.staticDirectory) {
    app.addHook('onSend', async (_request, reply, payload) => {
      const ancestors = _request.url.split('?')[0] === '/home-pages.html' ? "'self'" : "'none'";
      if (!reply.hasHeader('Content-Security-Policy')) reply.header('Content-Security-Policy',
        "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors " + ancestors + "; form-action 'self'; "
        + "style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; img-src 'self' data: blob:; "
        + "script-src 'self' 'wasm-unsafe-eval'; frame-src 'self'");
      return payload;
    });
    app.register(fastifyStatic, { root: options.staticDirectory });
  }

  return app;
}
