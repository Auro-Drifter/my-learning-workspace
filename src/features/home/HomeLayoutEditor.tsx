import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { GripVertical, Plus, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { HomeCard, HomeCardId, HomeLayout } from '../../../shared/home.ts';

export type HomeCardDefinition = { title: string; description?: string; group?: string; render: () => ReactNode };
export type HomeLayoutDraft = { original: HomeLayout; cards: HomeLayout };

export function HomeLayoutGrid({ cards, definitions, change, busy }: {
  cards: HomeLayout; definitions: Map<HomeCardId, HomeCardDefinition>; change?: (next: HomeLayout) => void; busy: boolean;
}) {
  const dragged = useRef<HomeCardId>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [target, setTarget] = useState<HomeCardId>();
  const visible = cards.filter(({ id, hidden }) => !hidden && definitions.has(id));
  const groups = new Map<string, { id: HomeCardId; definition: HomeCardDefinition }[]>();
  for (const { id, hidden } of cards) {
    const definition = definitions.get(id);
    if (!hidden || !definition) continue;
    const group = definition.group ?? '学习';
    const options = groups.get(group) ?? [];
    options.push({ id, definition });
    groups.set(group, options);
  }

  function update(id: HomeCardId, fields: Partial<Pick<HomeCard, 'columns' | 'hidden'>>) {
    change?.(cards.map((card) => card.id === id ? { ...card, ...fields } : card));
  }

  function move(source: HomeCardId, destination: HomeCardId) {
    if (source === destination) return;
    const from = cards.findIndex(({ id }) => id === source);
    const to = cards.findIndex(({ id }) => id === destination);
    if (from < 0 || to < 0) return;
    const next = [...cards];
    next.splice(from, 1);
    next.splice(to, 0, cards[from]);
    change?.(next);
  }

  function endDrag() {
    dragged.current = null;
    setTarget(undefined);
  }

  return <>
    {change && <div className="home-add-row">
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild><button ref={addButton} type="button" disabled={busy}>
          <Plus className="tool-icon" aria-hidden="true" />添加组件
        </button></DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="course-management-actions home-widget-menu" align="start" sideOffset={6} collisionPadding={8}>
            {groups.size ? [...groups].map(([group, options]) => <DropdownMenu.Group key={group} aria-label={group}>
              <DropdownMenu.Label className="home-widget-menu-label">{group}</DropdownMenu.Label>
              {options.map(({ id, definition }) => <DropdownMenu.Item key={id} className="course-management-item"
                textValue={definition.title} onSelect={() => update(id, { hidden: false })}>
                <span>{definition.title}{definition.description && <small aria-hidden="true">{definition.description}</small>}</span>
              </DropdownMenu.Item>)}
            </DropdownMenu.Group>)
              : <DropdownMenu.Item className="course-management-item" disabled>所有可用组件都已添加</DropdownMenu.Item>}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <span>拖动手柄排序，或聚焦手柄后使用 ↑ / ↓</span>
    </div>}
    <div className="home-grid" aria-label="首页组件">
      {visible.map(({ id, columns }, index) => {
        const definition = definitions.get(id)!;
        return <div key={id} className="home-slot" data-home-card={id} data-drop={target === id ? '' : undefined}
          style={{ '--home-columns': columns } as CSSProperties}
          onDragOver={change ? (event) => {
            if (!dragged.current) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = dragged.current === id ? 'none' : 'move';
            setTarget(dragged.current === id ? undefined : id);
          } : undefined}
          onDragLeave={change ? (event) => {
            if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node)) {
              setTarget((current) => current === id ? undefined : current);
            }
          } : undefined}
          onDrop={change ? (event) => {
            if (!dragged.current) return;
            event.preventDefault();
            move(dragged.current, id);
            endDrag();
          } : undefined}>
          <div className="home-slot-content">{definition.render()}</div>
          {change && <div className="home-card-edit" aria-label={definition.title + ' 布局'}>
            <button type="button" className="quiet-button home-grip" draggable={!busy} disabled={busy} aria-label={'移动' + definition.title}
              title="拖动排序（方向键移动）"
              onDragStart={(event) => {
                dragged.current = id;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', id);
                const card = event.currentTarget.closest('.home-slot');
                if (card) event.dataTransfer.setDragImage(card, 25, 20);
              }}
              onDragEnd={endDrag}
              onKeyDown={(event) => {
                const adjacent = event.key === 'ArrowUp' ? visible[index - 1]
                  : event.key === 'ArrowDown' ? visible[index + 1] : undefined;
                if (!adjacent) return;
                event.preventDefault();
                move(id, adjacent.id);
              }}><GripVertical className="tool-icon" aria-hidden="true" /></button>
            <select value={columns} disabled={busy} aria-label={definition.title + '宽度'}
              onChange={(event) => update(id, { columns: Number(event.target.value) as HomeCard['columns'] })}>
              <option value={4}>三分之一</option>
              <option value={6}>半宽</option>
              <option value={8}>三分之二</option>
              <option value={12}>全宽</option>
            </select>
            <button type="button" className="quiet-button home-remove" disabled={busy} aria-label={'移出首页 · ' + definition.title} title="移出首页"
              onClick={() => { addButton.current?.focus({ preventScroll: true }); update(id, { hidden: true }); }}><X className="tool-icon" aria-hidden="true" /></button>
          </div>}
        </div>;
      })}
      {visible.length === 0 && <p className="home-layout-empty muted">首页还没有组件。</p>}
    </div>
  </>;
}
