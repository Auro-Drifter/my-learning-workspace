import { useId, useRef, useState } from 'react';
import type { Course } from '../../shared/workspace.ts';
import { matchesCourse } from '../services/navigation.ts';
import { Dialog } from './Dialog.tsx';

export function QuickJump({ courses, currentId, close, select }: {
  courses: Course[]; currentId?: string; close: () => void; select: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);
  const results = courses.filter((course) => matchesCourse(course, query)).sort((first, second) =>
    Number(second.id === currentId) - Number(first.id === currentId));
  const index = Math.min(active, Math.max(0, results.length - 1));

  function choose(course: Course) {
    close();
    select(course.id);
  }

  return <Dialog title="快速跳转" onClose={close} className="jump-dialog">
    <input className="jump-search" autoFocus role="combobox" aria-label="搜索课程" aria-expanded={true} aria-autocomplete="list"
      aria-controls={listId} aria-activedescendant={results.length ? listId + '-' + index : undefined}
      placeholder="课程名或分组" value={query}
      onChange={(event) => { setQuery(event.target.value); setActive(0); if (list.current) list.current.scrollTop = 0; }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || !results.length) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          choose(results[index]);
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const next = (index + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
          setActive(next);
          list.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        }
      }} />
    <ul className="jump-results plain-list" id={listId} role="listbox" aria-label="课程结果" ref={list}>
      {results.map((course, position) => <li key={course.id} id={listId + '-' + position} role="option"
        aria-selected={position === index} onPointerMove={() => setActive(position)} onClick={() => choose(course)}>
        <span><strong>{course.name}</strong>{!!course.navigationPath.length && <small>{course.navigationPath.join(' / ')}</small>}</span>
        {course.id === currentId && <span className="jump-current">当前课程</span>}
      </li>)}
    </ul>
    {!results.length && <p role="status" className="muted">没有匹配的课程。</p>}
    <footer className="jump-footer"><span><kbd>↑</kbd> <kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span></footer>
  </Dialog>;
}
