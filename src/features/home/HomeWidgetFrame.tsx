import { useId, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { Settings2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Dialog } from '../../components/Dialog.tsx';
import { message } from '../../services/api.ts';
import type { HomeWidgetConfigs, HomeWidgetId } from '../../../shared/homeWidgets.ts';
import type { FileLocation } from '../../../shared/actions.ts';
import type { RootGrant } from '../../../shared/files.ts';
import type { Course } from '../../../shared/workspace.ts';
import { rootOptions } from '../resources/FileLibrary.tsx';
import type { ActionContext } from '../../services/actionRouter.tsx';

export type HomeWidgetContext = Pick<ActionContext, 'courses' | 'roots' | 'updateRoots' | 'disabled' | 'selectCourse' | 'openFile' | 'saveCourse'> & {
  configs: HomeWidgetConfigs;
  now: Date;
  save: <K extends HomeWidgetId>(id: K, config: HomeWidgetConfigs[K]) => Promise<boolean>;
};

export function HomeWidgetFrame({ title, icon: Icon, disabled, settings, children }: {
  title: string; icon: LucideIcon; disabled: boolean;
  settings?: (close: () => void) => ReactNode; children: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return <section className="home-card" aria-labelledby={id}>
    <header className="home-card-header">
      <div className="home-card-heading">
        <span className="home-card-icon"><Icon aria-hidden="true" /></span><h2 id={id}>{title}</h2>
      </div>
      {settings && <button type="button" className="quiet-button home-icon-button" aria-label={'配置' + title}
        title={'配置' + title} disabled={disabled} onClick={() => setOpen(true)}><Settings2 className="tool-icon" aria-hidden="true" /></button>}
    </header>
    <div className="home-widget-body">{children}</div>
    {open && settings?.(() => setOpen(false))}
  </section>;
}

export function WidgetSettings<T>({ title, initial, close, save, fields }: {
  title: string; initial: T; close: () => void; save: (value: T) => Promise<boolean>;
  fields: (draft: T, change: Dispatch<SetStateAction<T>>) => ReactNode;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <Dialog title={'配置' + title} onClose={() => { if (!busy) close(); }}>
    <form className="form" onSubmit={async (event) => {
      event.preventDefault();
      setBusy(true);
      setError('');
      try {
        if (await save(draft)) close();
        else setError('组件配置未能保存。');
      } catch (failure) {
        setError(message(failure));
      } finally {
        setBusy(false);
      }
    }}>
      {fields(draft, setDraft)}
      {error && <p role="alert" className="error">{error}</p>}
      <button type="submit" className="primary" disabled={busy}>保存组件配置</button>
    </form>
  </Dialog>;
}

export function NoteLink({ location, title, open }: {
  location: FileLocation; title: string; open: ActionContext['openFile'];
}) {
  return <button type="button" className="quiet-button home-note-link"
    onClick={() => open({ kind: 'markdown', id: 'home-note', icon: '', title, ...location })}>{title}</button>;
}

export function CourseSelect({ courses, value, change, empty, required }: {
  courses: Course[]; value: string; change: (value: string) => void; empty: string; required?: boolean;
}) {
  return <label>课程<select value={value} required={required} onChange={(event) => change(event.target.value)}>
    <option value="">{empty}</option>
    {courses.map((course) => <option value={course.id} key={course.id}>{course.name}</option>)}
  </select></label>;
}

export function DirectoryFields<T extends { rootId: string; folder: string }>({ draft, change, roots }: {
  draft: T; change: (value: T) => void; roots: RootGrant[];
}) {
  return <>
    <label>资料文件夹<select value={draft.rootId} required onChange={(event) => change({ ...draft, rootId: event.target.value, folder: '' })}>
      {rootOptions(roots, draft.rootId)}
    </select></label>
    <label>文件夹内的位置（选填）<input value={draft.folder} maxLength={1600} placeholder="留空查看整个资料文件夹"
      onChange={(event) => change({ ...draft, folder: event.target.value })} /></label>
  </>;
}
