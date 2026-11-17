import { useLayoutEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Dialog({ title, onClose, children, className }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return createPortal(<dialog ref={ref} className={className ? 'glass-dialog ' + className : 'glass-dialog'} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="dialog-header">
      <h2 id={titleId}>{title}</h2>
      <button type="button" onClick={onClose}>关闭</button>
    </header>
    {children}
  </dialog>, document.body);
}
