import type { ReactNode } from 'react';
import { homeWidgetCatalog, homeWidgetIds } from '../../../shared/homeWidgets.ts';
import type { HomeWidgetId } from '../../../shared/homeWidgets.ts';
import { CountdownCard, KanbanCard, QuoteCard, ShortcutsCard } from './StudyHomeWidgets.tsx';
import { EmbeddedNoteCard, FolderHomeCard } from './NotesHomeWidgets.tsx';
import { FeedCard, ImportedHomeCard, InsightsCard } from './ImportedHomeWidgets.tsx';
import type { HomeWidgetContext } from './HomeWidgetFrame.tsx';
import type { HomeCardDefinition } from './HomeLayoutEditor.tsx';

const views: Record<HomeWidgetId, (context: HomeWidgetContext) => ReactNode> = {
  shortcuts: (context) => <ShortcutsCard context={context} />,
  countdown: (context) => <CountdownCard context={context} />,
  quote: (context) => <QuoteCard context={context} />,
  kanban: (context) => <KanbanCard context={context} />,
  recent: (context) => <FolderHomeCard kind="recent" context={context} />,
  stats: (context) => <FolderHomeCard kind="stats" context={context} />,
  onthisday: (context) => <FolderHomeCard kind="onthisday" context={context} />,
  note: (context) => <EmbeddedNoteCard context={context} />,
  duowei: (context) => <ImportedHomeCard kind="duowei" context={context} />,
  annotations: (context) => <ImportedHomeCard kind="annotations" context={context} />,
  wechat: (context) => <ImportedHomeCard kind="wechat" context={context} />,
  insights: (context) => <InsightsCard context={context} />,
  media: (context) => <FeedCard context={context} />,
};

export function extraHomeCards(context: HomeWidgetContext): [HomeWidgetId, HomeCardDefinition][] {
  return homeWidgetIds.map((id) => [id, {
    ...homeWidgetCatalog[id],
    render: () => views[id](context),
  }]);
}
