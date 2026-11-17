import type { FileLocation } from '../../shared/actions.ts';
import { DEMO_ROOT_ID } from '../../shared/files.ts';
import type { NoteDocument, NoteSaveResult } from '../../shared/files.ts';
import { ApiError, api, isPagesDemo } from './api.ts';

function query(location: FileLocation) {
  return new URLSearchParams({ rootId: location.rootId, path: location.path });
}

export const loadNote = (location: FileLocation, signal?: AbortSignal) => api<NoteDocument>('/api/note?' + query(location), 'GET', undefined, signal);

export const saveNote = (location: FileLocation, text: string, version: string) =>
  api<NoteSaveResult>('/api/note', 'PUT', { rootId: location.rootId, path: location.path, text, version });

export function pdfResourceUrl(location: FileLocation) {
  if (!isPagesDemo) return '/api/pdf?' + query(location);
  return location.rootId === DEMO_ROOT_ID && location.path === '教材示例.pdf'
    ? import.meta.env.BASE_URL + 'demo-material.pdf' : '';
}

export async function loadPdf(location: FileLocation, signal: AbortSignal) {
  const url = pdfResourceUrl(location);
  if (!url) throw new ApiError('体验版仅提供网页自带的示例 PDF。', 404, 'demo_file_only');
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new ApiError(error?.message ?? '无法读取 PDF 文件。', response.status, error?.code ?? 'request_failed');
  }
  return new Uint8Array(await response.arrayBuffer());
}
