import { z } from 'zod';

export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/, 'ID 只能包含字母、数字、短横线或下划线');
export const titleSchema = z.string().trim().min(1, '请输入标题').max(120);
const clean = z.string().trim().min(1).max(1600).refine(
  (value) => value.isWellFormed() && !/[\x00-\x1f\x7f]/u.test(value),
  '地址含有非法字符',
);
const obsidianVault = z.string().min(1).max(240).refine(
  (value) => value.trim().length > 0 && value.isWellFormed() && !/[\x00-\x1f\x7f]/u.test(value),
  '请输入笔记库名称',
);
const windowsName = /^[^<>:"/\\|?*\x00-\x1f]+$/u;
const reservedName = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu;
function validSegment(segment: string): boolean {
  return windowsName.test(segment) && !/[. ]$/u.test(segment) && !reservedName.test(segment);
}

export const relativePathSchema = z.string().min(1).max(1600).refine((value) => value.isWellFormed()).refine(
  (value) => value.split('/').every(validSegment),
  '请输入授权目录内的相对路径，使用 / 分隔目录',
);

export const windowsPathSchema = z.string().min(1).max(1600).refine((value) => value.isWellFormed()).refine((value) => {
  const normalized = value.replaceAll('\\', '/');
  return /^[a-z]:\//iu.test(normalized)
    && (normalized.length === 3 || normalized.slice(3).replace(/\/$/u, '').split('/').every(validSegment));
}, '请输入本机 Windows 绝对路径，例如 C:\\Projects\\Course');

const webUrl = clean.refine((value) => {
  if (!/^https?:\/\//iu.test(value) || value.includes('\\')) return false;
  try {
    const url = new URL(value);
    return !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}, '只支持不含账号密码的 HTTP 或 HTTPS 地址');

export const fileLocationSchema = z.strictObject({ rootId: idSchema, path: relativePathSchema });
export type FileLocation = z.infer<typeof fileLocationSchema>;

const base = { id: idSchema, title: titleSchema, icon: z.string().max(12) };
export const resourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...base, kind: z.literal('web'), url: webUrl }),
  z.strictObject({ ...base, kind: z.literal('internal'), courseId: idSchema }),
  z.strictObject({
    ...base, kind: z.literal('obsidian'), vault: obsidianVault,
    file: z.union([z.literal(''), relativePathSchema]),
  }),
  z.strictObject({ ...base, kind: z.literal('vscode'), path: windowsPathSchema }),
  z.strictObject({
    ...base, kind: z.literal('markdown'), ...fileLocationSchema.shape,
    path: relativePathSchema.refine((value) => /\.md$/iu.test(value), '请选择 .md 文件'),
  }),
  z.strictObject({
    ...base, kind: z.literal('pdf'), ...fileLocationSchema.shape,
    path: relativePathSchema.refine((value) => /\.pdf$/iu.test(value), '请选择 .pdf 文件'),
  }),
]);
export type Resource = z.infer<typeof resourceSchema>;

export function obsidianOpenUri(vault: string, file = ''): string {
  const uri = 'obsidian://open?vault=' + encodeURIComponent(vault);
  return file ? uri + '&file=' + encodeURIComponent(file) : uri;
}

export function obsidianPathUri(path: string): string {
  return 'obsidian://open?path=' + encodeURIComponent(path);
}

export function externalAction(input: Resource, folders: readonly string[] = []): { href: string; copy: string; newTab: boolean } | undefined {
  const { success, data } = resourceSchema.safeParse(input);
  if (!success) return;
  switch (data.kind) {
    case 'web':
      return { href: new URL(data.url).href, copy: data.url, newTab: true };
    case 'obsidian': {
      // Older versions trimmed the vault name. Repair those URLs using an unambiguous added folder.
      const matching = folders.map((folder) => folder.replaceAll('\\', '/').replace(/\/$/u, ''))
        .map((directory) => ({ directory, name: directory.slice(directory.lastIndexOf('/') + 1) }))
        .filter(({ name }) => name.trim() === data.vault.trim());
      const recovered = data.vault === data.vault.trim() && matching.length === 1 && matching[0].name !== data.vault
        ? matching[0] : undefined;
      const path = recovered && data.file ? recovered.directory + '/' + data.file : '';
      const href = path && windowsPathSchema.safeParse(path).success ? obsidianPathUri(path.replaceAll('/', '\\'))
        : obsidianOpenUri(recovered?.name ?? data.vault, data.file);
      return { href, copy: href, newTab: false };
    }
    case 'vscode': {
      const path = data.path.replaceAll('\\', '/');
      const href = 'vscode://file/' + path.slice(0, 3)
        + path.slice(3).split('/').map(encodeURIComponent).join('/');
      return { href, copy: data.path, newTab: false };
    }
  }
}
