import { firstFreePosition } from '../../shared/workspace.ts';
import type { Widget, WidgetLayout } from '../../shared/workspace.ts';

export function reflowWidgets(widgets: Widget[]): Widget[] {
  const visible = widgets.filter((widget) => widget.enabled);
  visible.sort((first, second) => first.layout.y - second.layout.y || first.layout.x - second.layout.x);

  const positions = new Map<string, WidgetLayout>();
  const occupied: WidgetLayout[] = [];
  let cursor: WidgetLayout | undefined;
  for (const { id, layout } of visible) {
    cursor = firstFreePosition(layout.w, layout.h, occupied, cursor);
    positions.set(id, cursor);
    occupied.push(cursor);
  }

  return widgets.map((widget) => {
    const layout = positions.get(widget.id);
    if (!layout || (layout.x === widget.layout.x && layout.y === widget.layout.y)) return widget;
    return { ...widget, layout };
  });
}
