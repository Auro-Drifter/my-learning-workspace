import { createHash } from 'node:crypto';

// The sandbox receives only structured messages. User code is executed in a disposable worker.
const bridge = String.raw`
const origin = location.origin;
addEventListener('message', (event) => {
  if (parent === window || event.source !== parent || event.origin !== origin) return;
  const message = event.data;
  if (message?.type === 'hello') {
    parent.postMessage({ type: 'mlw-ready' }, origin);
    return;
  }
  if (message?.type !== 'run' || typeof message.id !== 'string'
    || typeof message.code !== 'string' || message.code.length > 24000) return;

  let worker;
  let url;
  let timer;
  let finished = false;
  function reply(result) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    worker?.terminate();
    if (url) URL.revokeObjectURL(url);
    parent.postMessage({ type: 'mlw-result', id: message.id, ...result }, origin);
  }

  try {
    const source = "'use strict';\nconst run = async (input) => {\n" + message.code
      + "\n};\nself.onmessage = async (event) => self.postMessage(await run(event.data));";
    url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onerror = (event) => { event.preventDefault(); reply({ error: '插件执行失败。请检查导入的代码。' }); };
    worker.onmessageerror = () => reply({ error: '插件返回了无法传输的数据。' });
    worker.onmessage = (event) => {
      try {
        const serialized = JSON.stringify(event.data);
        if (!serialized || serialized.length > 72000) throw new Error('size');
        reply({ result: JSON.parse(serialized) });
      } catch {
        reply({ error: '插件返回的数据无效或过大。' });
      }
    };
    timer = setTimeout(() => reply({ error: '插件执行超时，运行已终止。' }), 2000);
    worker.postMessage(message.input);
  } catch {
    reply({ error: '无法启动隔离插件。' });
  }
});
`;
const digest = createHash('sha256').update(bridge).digest('base64');

export const runnerCsp = "default-src 'none'; script-src 'sha256-" + digest
  + "'; worker-src blob:; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";
export const runnerHtml = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>插件沙箱</title><script>' + bridge + '</script></html>';
