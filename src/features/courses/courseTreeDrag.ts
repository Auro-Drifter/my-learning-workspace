import { useEffect, useRef, useState } from 'react';
import type { PointerEvent, MouseEvent } from 'react';
import type { CourseTreeItem } from './courseExplorer.ts';

type Gesture = {
  pointer: number; x: number; y: number; item: CourseTreeItem; label: string;
  active: boolean; copy: boolean; examined?: string | null; target?: string; openTimer?: ReturnType<typeof setTimeout>;
};

export function useCourseTreeDrag(disabled: boolean, openFolder: (target: string) => void,
  canDrop: (source: CourseTreeItem, target: string, copy: boolean) => boolean,
  drop: (source: CourseTreeItem, target: string, copy: boolean) => Promise<void>) {
  const gesture = useRef<Gesture>(undefined);
  const suppressClick = useRef(false);
  const scrollFrame = useRef(0);
  const preview = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<Gesture>();
  const [target, setTarget] = useState<string>();

  function finish() {
    const current = gesture.current;
    gesture.current = undefined;
    clearTimeout(current?.openTimer);
    cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = 0;
    if (current?.active) {
      setDragging(undefined);
      setTarget(undefined);
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
    }
    return current;
  }

  useEffect(() => {
    function cancel(event: KeyboardEvent) {
      if (event.key === 'Escape' && gesture.current?.active) finish();
    }
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('keydown', cancel);
      clearTimeout(gesture.current?.openTimer);
      cancelAnimationFrame(scrollFrame.current);
    };
  }, []);

  function locate(tree: HTMLElement, current: Gesture, copy = current.copy) {
    const next = document.elementFromPoint(current.x, current.y)?.closest<HTMLElement>('[data-course-drop]');
    const path = next && tree.contains(next) ? next.dataset.courseDrop : undefined;
    if ((path ?? null) === current.examined && copy === current.copy) return;
    if (current.copy !== copy) {
      current.copy = copy;
      setDragging({ ...current });
    }
    current.examined = path ?? null;
    clearTimeout(current.openTimer);
    current.target = path !== undefined && canDrop(current.item, path, current.copy) ? path : undefined;
    setTarget(current.target);
    if (current.target) {
      const folder = current.target;
      current.openTimer = setTimeout(() => openFolder(folder), 520);
    }
  }

  function scrollNearEdge(tree: HTMLElement, current: Gesture) {
    if (scrollFrame.current) return;
    const sidebar = tree.closest<HTMLElement>('.sidebar');
    if (!sidebar) return;
    function step(now: number) {
      scrollFrame.current = 0;
      if (!sidebar || gesture.current !== current || disabled) return;
      const { top, bottom, left, right } = sidebar.getBoundingClientRect();
      if (current.x < left || current.x > right || current.y < top || current.y > bottom) return;
      const distance = Math.max(0, 30 - (current.y - top)) - Math.max(0, 30 - (bottom - current.y));
      if (!distance) return;
      const previous = sidebar.scrollTop;
      const elapsed = Math.min(now - last, 32);
      last = now;
      sidebar.scrollTop -= Math.sign(distance) * (1 + Math.abs(distance) / 6) * elapsed / 16;
      if (previous === sidebar.scrollTop) return;
      locate(tree, current);
      scrollFrame.current = requestAnimationFrame(step);
    }
    let last = performance.now() - 16;
    scrollFrame.current = requestAnimationFrame(step);
  }

  return {
    dragging, target, preview,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (disabled || event.button !== 0 || event.pointerType === 'touch' || event.shiftKey || event.altKey) return;
        const row = (event.target as HTMLElement).closest<HTMLElement>('[data-course-drag],[data-folder-drag]');
        if (!row) return;
        const item: CourseTreeItem = row.dataset.courseDrag
          ? { kind: 'course', key: row.dataset.courseDrag }
          : { kind: 'folder', key: row.dataset.folderDrag! };
        gesture.current = { pointer: event.pointerId, item, label: row.textContent?.trim() ?? '', x: event.clientX, y: event.clientY, active: false, copy: event.ctrlKey || event.metaKey };
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const current = gesture.current;
        if (!current || current.pointer !== event.pointerId || disabled) return;
        if (!current.active) {
          if (!event.buttons) { finish(); return; }
          if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5) return;
          current.active = true;
          current.x = event.clientX;
          current.y = event.clientY;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging({ ...current });
        }
        event.preventDefault();
        current.x = event.clientX;
        current.y = event.clientY;
        if (preview.current) preview.current.style.transform = 'translate3d(' + (current.x + 14) + 'px,' + (current.y + 12) + 'px,0)';
        locate(event.currentTarget, current, event.ctrlKey || event.metaKey);
        scrollNearEdge(event.currentTarget, current);
      },
      onPointerUp(event: PointerEvent<HTMLElement>) {
        const current = gesture.current;
        if (!current || current.pointer !== event.pointerId) return;
        if (current.active) {
          current.x = event.clientX;
          current.y = event.clientY;
          locate(event.currentTarget, current, event.ctrlKey || event.metaKey);
        }
        finish();
        if (current.active && current.target !== undefined && !disabled) void drop(current.item, current.target, current.copy);
      },
      onPointerCancel: finish,
      onLostPointerCapture: finish,
      onClickCapture(event: MouseEvent<HTMLElement>) {
        if (!suppressClick.current) return;
        event.preventDefault();
        event.stopPropagation();
      },
    },
  };
}
