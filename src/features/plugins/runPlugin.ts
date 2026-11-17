import { pluginResultSchema } from '../../../shared/plugins.ts';
import type { PluginResult, PluginSlot } from '../../../shared/plugins.ts';
import { isPagesDemo } from '../../services/api.ts';

type Pending = { resolve: (value: PluginResult) => void; reject: (reason: Error) => void };
let runner: Promise<Window> | undefined;
let queue = Promise.resolve();
const pending = new Map<string, Pending>();

function getRunner() {
  if (runner) return runner;
  runner = new Promise<Window>((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('title', '插件沙箱');
    frame.src = '/plugin-runtime';

    function receive(event: MessageEvent) {
      if (!frame.contentWindow || event.source !== frame.contentWindow || event.origin !== 'null') return;
      if (event.data?.type === 'mlw-ready') {
        window.clearTimeout(timeout);
        resolve(frame.contentWindow);
      }
      if (event.data?.type !== 'mlw-result') return;
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      const parsed = pluginResultSchema.safeParse(event.data.result);
      if (typeof event.data.error === 'string') job.reject(new Error(event.data.error));
      else if (!parsed.success) job.reject(new Error('插件返回的组件结构无效。'));
      else job.resolve(parsed.data);
    }

    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', receive);
      frame.remove();
      runner = undefined;
      reject(new Error('无法连接插件沙箱。'));
    }, 3000);
    window.addEventListener('message', receive);
    frame.addEventListener('load', () => frame.contentWindow?.postMessage({ type: 'hello' }, '*'));
    document.body.append(frame);
  });
  return runner;
}

export function runPlugin(code: string, slot: PluginSlot, action: string | null): Promise<PluginResult> {
  if (isPagesDemo) return Promise.reject(new Error('自定义插件请在本机完整版中使用。'));
  const job = queue.then(async () => {
    const frame = await getRunner();
    return new Promise<PluginResult>((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = window.setTimeout(() => {
        pending.delete(id);
        reject(new Error('插件未在规定时间内响应。'));
      }, 2600);
      pending.set(id, {
        resolve: (value) => { window.clearTimeout(timer); resolve(value); },
        reject: (error) => { window.clearTimeout(timer); reject(error); },
      });
      frame.postMessage({ type: 'run', id, code, input: { ...slot, action, today: new Date().toISOString() } }, '*');
    });
  });
  queue = job.then(() => undefined, () => undefined);
  return job;
}
