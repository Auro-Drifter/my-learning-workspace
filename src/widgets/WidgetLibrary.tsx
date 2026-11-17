import { useState } from 'react';
import { Dialog } from '../components/Dialog.tsx';
import type { widgetChoices } from './registry.tsx';

type Choice = ReturnType<typeof widgetChoices>[number];
const summaries: Record<string, string> = {
  quickLinks: '集中打开课程网址、笔记、教材和项目。',
  text: '随课程保存自由格式的文字备注。',
  fileLibrary: '查看资料文件夹里的笔记和 PDF。',
  tasks: '管理截止日期、任务状态和关联资源。',
  study: '记录当前章节、下一步和待巩固事项。',
};

export function WidgetLibrary({ choices, select, close }: {
  choices: Choice[]; select: (choice: Choice) => void; close: () => void;
}) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const cards = choices.map((choice) => ({
    choice,
    summary: summaries[choice.id] ?? ('description' in choice ? choice.description : ''),
  })).filter(({ choice, summary }) => (choice.label + ' ' + summary).toLocaleLowerCase().includes(query));

  return <Dialog title="组件库" onClose={close} className="widget-library-dialog">
    <input type="search" autoFocus aria-label="搜索组件" placeholder="按名称或用途查找" value={search}
      onChange={(event) => setSearch(event.target.value)} />
    {!cards.length && <p role="status" className="muted widget-library-empty">没有匹配的已启用组件。</p>}
    <div className="widget-library">{cards.map(({ choice, summary }) => <button type="button" className="widget-tile"
      key={choice.id} aria-label={choice.label} onClick={() => select(choice)}>
      <div className="widget-tile-title"><strong>{choice.label}</strong><span aria-hidden="true">+</span></div>
      {summary && <small>{summary}</small>}
    </button>)}</div>
  </Dialog>;
}
