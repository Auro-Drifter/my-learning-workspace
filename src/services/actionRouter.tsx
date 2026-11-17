import { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, Code, FileText, NotebookPen } from 'lucide-react';
import { externalAction } from '../../shared/actions.ts';
import type { Resource } from '../../shared/actions.ts';
import type { Course } from '../../shared/workspace.ts';
import type { RootGrant } from '../../shared/files.ts';
import type { PluginLibrary } from '../../shared/plugins.ts';

export type LocalResource = Extract<Resource, { kind: 'markdown' | 'pdf' }>;
export type ActionContext = {
  course: Course;
  courses: Course[];
  roots: RootGrant[];
  updateRoots: (roots: RootGrant[]) => void;
  plugins: PluginLibrary;
  disabled: boolean;
  saveCourse: (course: Course) => Promise<boolean>;
  selectCourse: (id: string) => void;
  openFile: (file: LocalResource) => void;
};

export function ResourceAction({ item, context }: { item: Resource; context: Pick<ActionContext, 'courses' | 'roots' | 'selectCourse' | 'openFile'> }) {
  const [copyState, setCopyState] = useState<'copied' | 'manual'>();
  useEffect(() => {
    if (copyState !== 'copied') return;
    const timer = window.setTimeout(() => setCopyState(undefined), 1600);
    return () => window.clearTimeout(timer);
  }, [copyState]);
  const Icon = item.kind === 'web' ? ArrowUpRight : item.kind === 'vscode' ? Code
    : item.kind === 'internal' ? BookOpen : item.kind === 'obsidian' ? NotebookPen : FileText;
  const text = <>{item.icon ? <span className="resource-type-icon" aria-hidden="true">{item.icon} </span>
    : <Icon className="tool-icon resource-type-icon" aria-hidden="true" />}<span className="resource-title">{item.title}</span></>;
  if (item.kind === 'internal') {
    const target = context.courses.find((course) => course.id === item.courseId && !course.archived);
    return target ? <button type="button" className="resource-open" onClick={() => context.selectCourse(target.id)}>{text}</button>
      : <span>{text} · 目标课程已归档或不存在</span>;
  }
  if (item.kind === 'markdown' || item.kind === 'pdf') {
    return <button type="button" className="resource-open" onClick={() => context.openFile(item)}>{text}</button>;
  }
  const action = externalAction(item, context.roots.map(({ directory }) => directory));
  if (!action) return <span>{text} · 地址不可打开</span>;
  return <div className="resource-action">
    <div className="resource-row">
      <a className="resource-open" href={action.href} target={action.newTab ? '_blank' : undefined}
        rel={action.newTab ? 'noopener noreferrer' : undefined}>{text}</a>
      <button type="button" className="resource-copy" aria-label={'复制 ' + item.title + ' 的地址'} onClick={async () => {
        try {
          await navigator.clipboard.writeText(action.copy);
          setCopyState('copied');
        } catch {
          setCopyState('manual');
        }
      }}>{copyState === 'copied' ? '已复制' : '复制'}</button>
      <span role="status" className="resource-copy-feedback">
        {copyState === 'copied' ? '已复制地址' : copyState === 'manual' ? '请手动复制地址' : ''}
      </span>
    </div>
    {copyState === 'manual' && <label><small className="muted">手动复制地址</small>
      <input autoFocus readOnly value={action.copy} onFocus={(event) => event.target.select()} />
    </label>}
  </div>;
}
