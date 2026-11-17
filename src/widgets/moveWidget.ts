import type { Layout, LayoutItem } from 'react-grid-layout';
import { GRID_COLUMNS, MAX_LAYOUT_ROWS, overlaps } from '../../shared/workspace.ts';

function inBounds({ x, y, w, h }: LayoutItem) {
  return x >= 0 && y >= 0 && x + w <= GRID_COLUMNS && y + h <= MAX_LAYOUT_ROWS;
}

export function moveWidget(layout: Layout, id: string, x: number, y: number, overlapThreshold = .5): Layout {
  const source = layout.find((entry) => entry.i === id);
  if (!source || (x === source.x && y === source.y)) return layout;
  const proposed = { ...source, x, y };
  if (!inBounds(proposed)) return layout;
  const other = layout.filter((entry) => entry.i !== id);
  const collisions = other.filter((entry) => overlaps(entry, proposed));
  if (!collisions.length) return layout.map((entry) => entry.i === id ? proposed : entry);

  const coverage = (entry: LayoutItem) =>
    (Math.min(x + source.w, entry.x + entry.w) - Math.max(x, entry.x))
    * (Math.min(y + source.h, entry.y + entry.h) - Math.max(y, entry.y))
    / Math.min(source.w * source.h, entry.w * entry.h);
  for (const target of collisions.sort((a, b) => coverage(b) - coverage(a))) {
    if (coverage(target) < overlapThreshold) break;
    const moved = { ...source, x: target.x, y: target.y };
    const displaced = { ...target, x: source.x, y: source.y };
    if (!inBounds(moved) || !inBounds(displaced) || overlaps(moved, displaced)
      || other.some((entry) => entry.i !== target.i && (overlaps(entry, moved) || overlaps(entry, displaced)))) continue;
    return layout.map((entry) => entry.i === id ? moved : entry.i === target.i ? displaced : entry);
  }
  return layout;
}
