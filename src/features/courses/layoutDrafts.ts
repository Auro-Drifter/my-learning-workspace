import { useState } from 'react';
import type { Course, Widget } from '../../../shared/workspace.ts';

export type LayoutDraft = { original: Widget[]; widgets: Widget[]; history: Widget[][] };

export function sameWidgets(a: Widget[], b: Widget[]) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function useLayoutDrafts() {
  const [drafts, setDrafts] = useState(() => new Map<string, LayoutDraft>());
  const changed = [...drafts.values()].some(({ widgets, original }) => !sameWidgets(widgets, original));

  function begin(course: Course) {
    setDrafts((previous) => new Map(previous).set(course.id, { original: course.widgets, widgets: course.widgets, history: [] }));
  }

  function edit(id: string, next: Widget[]) {
    setDrafts((previous) => {
      const entry = previous.get(id);
      if (!entry || sameWidgets(entry.widgets, next)) return previous;
      return new Map(previous).set(id, { ...entry, widgets: next, history: [...entry.history.slice(-23), entry.widgets] });
    });
  }

  function undo(id: string) {
    setDrafts((previous) => {
      const entry = previous.get(id);
      const last = entry?.history.at(-1);
      return entry && last ? new Map(previous).set(id, { ...entry, widgets: last, history: entry.history.slice(0, -1) }) : previous;
    });
  }

  function discard(id: string) {
    setDrafts((previous) => {
      if (!previous.has(id)) return previous;
      const next = new Map(previous);
      next.delete(id);
      return next;
    });
  }

  function clear() {
    setDrafts(new Map());
  }

  return { drafts, changed, begin, edit, undo, discard, clear };
}
