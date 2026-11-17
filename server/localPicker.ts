import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { relativePathSchema, windowsPathSchema } from '../shared/actions.ts';
import { fileKind } from '../shared/files.ts';
import type { LocalPickerRequest, LocalPickerResult } from '../shared/files.ts';
import { AppError } from './filesystem.ts';
import type { createResources } from './resources.ts';
import type { RootStore } from './roots.ts';

const pickerSettings = {
  markdown: { title: '选择 Markdown 笔记', filter: 'Markdown (*.md)|*.md' },
  pdf: { title: '选择 PDF 文件', filter: 'PDF (*.pdf)|*.pdf' },
  'obsidian-note': { title: '选择 Obsidian 库中的笔记', filter: 'Markdown (*.md)|*.md' },
  'obsidian-vault': { title: '选择 Obsidian 库的根目录', filter: '' },
  'vscode-file': { title: '选择在 VS Code 中打开的文件', filter: '所有文件 (*.*)|*.*' },
  'vscode-folder': { title: '选择 VS Code 项目目录', filter: '' },
  'root-folder': { title: '选择要授权的目录', filter: '' },
} satisfies Record<LocalPickerRequest['kind'], { title: string; filter: string }>;

const launchCommand = Buffer.from(`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$source = Get-Content -Raw -Encoding UTF8 -LiteralPath $env:MLW_PICKER_SOURCE
Add-Type -ReferencedAssemblies 'System.Windows.Forms.dll','System.Drawing.dll','System.dll' -TypeDefinition $source
[WindowsPicker]::Run()
`, 'utf16le').toString('base64');

export type ChooseLocalPath = (kind: LocalPickerRequest['kind'], directory: string, signal: AbortSignal) => Promise<string | null>;

function startWindowsPicker(systemRoot: string) {
  const child = spawn(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', launchCommand], {
      env: { ...process.env, MLW_PICKER_SOURCE: fileURLToPath(new URL('./WindowsPicker.cs', import.meta.url)) },
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    });
  const initialized = Promise.withResolvers<void>();
  let waiting: ReturnType<typeof Promise.withResolvers<string>> | undefined;
  let stopped = false;
  const startup = setTimeout(stop, 20_000);
  startup.unref();

  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(startup);
    const failure = new Error('Windows picker stopped');
    initialized.reject(failure);
    waiting?.reject(failure);
    child.kill();
  }

  void initialized.promise.catch(() => undefined);
  child.once('error', stop);
  child.once('exit', stop);
  child.stdin.on('error', stop);
  const lines = createInterface({ input: child.stdout });
  lines.once('close', stop);
  lines.on('line', (line) => {
    if (line === 'ready') {
      clearTimeout(startup);
      initialized.resolve();
    } else {
      waiting?.resolve(line);
    }
  });

  return {
    get stopped() { return stopped; },
    stop,
    async select(fields: string[], signal: AbortSignal) {
      signal.throwIfAborted();
      const cancel = AbortSignal.any([signal, AbortSignal.timeout(300_000)]);
      cancel.addEventListener('abort', stop, { once: true });
      try {
        await initialized.promise;
        cancel.throwIfAborted();
        if (stopped) throw new Error('Windows picker stopped');
        waiting = Promise.withResolvers<string>();
        const payload = fields.map((field) => Buffer.from(field, 'utf8').toString('base64')).join('\t');
        child.stdin.write(payload + '\n');
        const reply = await waiting.promise;
        if (reply === 'cancelled') return null;
        if (reply.startsWith('ok:')) return Buffer.from(reply.slice(3), 'base64').toString('utf8');
        throw new Error('Windows file dialog failed');
      } finally {
        waiting = undefined;
        cancel.removeEventListener('abort', stop);
      }
    },
  };
}

function prepareWindowsPicker(shutdown: AbortSignal) {
  let worker: ReturnType<typeof startWindowsPicker> | undefined;
  const systemRoot = process.env.SystemRoot;
  const supported = process.platform === 'win32' && !!systemRoot;

  function ready() {
    if (!worker || worker.stopped) worker = startWindowsPicker(systemRoot!);
    return worker;
  }

  const choose: ChooseLocalPath = async (kind, directory, signal) => {
    if (!supported) throw new AppError(501, 'picker_unsupported', '本机文件选择器需要 Windows 桌面，仍可手动填写路径。');
    const { title, filter } = pickerSettings[kind];
    try {
      signal.throwIfAborted();
      return await ready().select([title, filter, directory], signal);
    } catch {
      throw new AppError(503, 'picker_unavailable', '无法完成 Windows 文件选择。请在桌面环境打开工作台，或手动填写路径。');
    }
  };

  shutdown.addEventListener('abort', () => worker?.stop(), { once: true });
  return { choose, warmup() { if (supported && !shutdown.aborted) ready(); } };
}

async function identifyObsidian(path: string, note: boolean): Promise<LocalPickerResult> {
  if (note && fileKind(path) !== 'markdown') throw new AppError(400, 'invalid_note', '请选择 Obsidian 库中的 Markdown 笔记。');
  let folder = note ? dirname(path) : path;
  while (true) {
    const marker = await lstat(join(folder, '.obsidian')).catch(() => undefined);
    if (marker?.isDirectory() && !marker.isSymbolicLink()) {
      const vault = basename(folder);
      const file = note ? relative(folder, path).split(sep).join('/') : '';
      if (vault && vault.length <= 240 && (!note || relativePathSchema.safeParse(file).success)) {
        return { kind: 'obsidian', vault, file };
      }
      break;
    }
    const parent = dirname(folder);
    if (!note || parent === folder) break;
    folder = parent;
  }
  throw new AppError(400, 'obsidian_vault_missing', '未识别到 Obsidian 库。请选择含 .obsidian 的库目录或其中的笔记。');
}

export function createLocalPicker(roots: RootStore, resources: ReturnType<typeof createResources>, choose?: ChooseLocalPath) {
  const shutdown = new AbortController();
  const windows = choose ? undefined : prepareWindowsPicker(shutdown.signal);
  const select = choose ?? windows!.choose;
  let active = false;
  async function pick({ kind, rootId }: LocalPickerRequest, signal: AbortSignal): Promise<LocalPickerResult | null> {
    if (active) throw new AppError(409, 'picker_open', '本机选择窗口已经打开，请完成或取消该窗口后再试。');
    active = true;
    try {
      let directory = '';
      if (rootId) {
        try {
          directory = (await roots.get(rootId)).directory;
        } catch (error) {
          if (!(error instanceof AppError && ['root_unavailable', 'root_changed'].includes(error.code))) throw error;
        }
      }
      const path = await select(kind, directory, AbortSignal.any([signal, shutdown.signal]));
      if (!path) return null;
      if (!isAbsolute(path) || (process.platform === 'win32' && !windowsPathSchema.safeParse(path).success)) {
        throw new AppError(400, 'invalid_selection', '请选择有效的本机文件或目录。');
      }
      if (kind === 'markdown' || kind === 'pdf') {
        return { kind: 'document', ...await resources.locate(path, kind, rootId) };
      }
      const info = await lstat(path).catch(() => undefined);
      const wantsDirectory = !pickerSettings[kind].filter;
      if (!info || info.isSymbolicLink() || (wantsDirectory ? !info.isDirectory() : !info.isFile())) {
        throw new AppError(400, 'invalid_selection', '所选路径已不可用，或类型不符合要求。');
      }
      if (kind === 'obsidian-note' || kind === 'obsidian-vault') return await identifyObsidian(path, kind === 'obsidian-note');
      return { kind: 'path', path };
    } finally {
      active = false;
    }
  }
  return {
    pick,
    warmup: () => windows?.warmup(),
    close: () => shutdown.abort(),
  };
}
