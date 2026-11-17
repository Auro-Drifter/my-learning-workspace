import { useEffect, useState } from 'react';
import type { FileLocation } from '../../../shared/actions.ts';
import { loadNote } from '../../services/fileApi.ts';
import { message } from '../../services/api.ts';

export function useHomeNote(location?: FileLocation) {
  const { rootId, path } = location ?? {};
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ rootId: string; path: string; data?: string; error?: string }>();
  useEffect(() => {
    if (!rootId || !path) return;
    const controller = new AbortController();
    void loadNote({ rootId, path }, controller.signal).then(
      ({ text }) => { if (!controller.signal.aborted) setResult({ rootId, path, data: text }); },
      (failure) => { if (!controller.signal.aborted) setResult({ rootId, path, error: message(failure) }); },
    );
    return () => controller.abort();
  }, [rootId, path, attempt]);
  const current = result && result.rootId === rootId && result.path === path ? result : undefined;
  return { data: current?.data, error: current?.error, refresh: () => setAttempt((count) => count + 1) };
}

export function noteSection(source: string, heading: string) {
  const text = source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, '');
  const target = heading.trim();
  if (!target) return text;
  let fence = '';
  let depth = 0;
  const lines: string[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const delimiter = line.trimStart().match(/^(```+|~~~+)/u)?.[0];
    if (delimiter) {
      if (!fence) fence = delimiter;
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length
        && !line.trimStart().slice(delimiter.length).trim()) fence = '';
    }
    const match = !fence && /^ {0,3}(#{1,6})\s+(.+?)\s*$/u.exec(line);
    if (match) {
      if (depth && match[1].length <= depth) break;
      if (!depth && match[2].replace(/\s+#+$/u, '') === target) depth = match[1].length;
    }
    if (depth) lines.push(line);
  }
  return depth ? lines.join('\n') : undefined;
}
