import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LocalPickerRequest, LocalPickerResult } from '../../shared/files.ts';
import { ApiError, api, message } from '../services/api.ts';

export function LocalPickerButton({ request, label, select }: {
  request: LocalPickerRequest; label: string; select: (selection: LocalPickerResult) => void;
}) {
  const active = useRef<AbortController>(undefined);
  const apply = useRef(select);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => { apply.current = select; }, [select]);
  useEffect(() => () => active.current?.abort(), []);

  async function choose() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const { selection } = await api<{ selection: LocalPickerResult | null }>('/api/local-picker', 'POST', request, controller.signal);
      if (!controller.signal.aborted && selection) apply.current(selection);
    } catch (failure) {
      if (!controller.signal.aborted) {
        const missingRoute = failure instanceof ApiError && failure.status === 404
          && failure.code === 'request_failed' && failure.message.includes('/api/local-picker');
        if (failure instanceof ApiError && failure.code === 'picker_open') setNotice(message(failure));
        else setError(missingRoute ? '当前服务版本缺少本机文件选择功能。请保存草稿后打开新版工作台，或在这里手动填写。' : message(failure));
      }
    } finally {
      active.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <>
    <button type="button" className="path-picker-button" aria-label={label} aria-busy={busy} disabled={busy} onClick={() => void choose()}>
      <span aria-hidden="true" className={busy ? 'path-picker-label-hidden' : undefined}>{label}</span>
      {busy && <span aria-hidden="true">选择中…</span>}
    </button>
    <span className="path-picker-status" role="status">{busy ? '请在 Windows 窗口中选择' : ''}</span>
    {error && <p className="error path-picker-error" role="alert">{error}</p>}
    {notice && <p className="muted path-picker-error" role="status">{notice}</p>}
  </>;
}
