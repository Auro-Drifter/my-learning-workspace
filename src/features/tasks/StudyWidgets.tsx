import { useState } from 'react';
import { Plus } from 'lucide-react';
import { courseResources } from '../../../shared/workspace.ts';
import type { Course, StudyState, Task } from '../../../shared/workspace.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { message } from '../../services/api.ts';
import { ResourceAction } from '../../services/actionRouter.tsx';
import type { ActionContext } from '../../services/actionRouter.tsx';

const statuses = { todo: '待办', doing: '进行中', done: '完成' } as const;
const blankTask = (): Task => ({ id: crypto.randomUUID(), title: '', notes: '', dueAt: '', status: 'todo', resourceId: null });

export function TasksWidget({ course, context }: { course: Course; context: ActionContext }) {
  const [draft, setDraft] = useState<Task>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const resources = courseResources(course);
  async function store(tasks: Task[]) {
    setError('');
    setBusy(true);
    try {
      if (await context.saveCourse({ ...course, tasks })) setDraft(undefined);
      else setError('任务未能保存。当前内容已保留，请处理保存冲突后重试。');
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  function update(task: Task) {
    const exists = course.tasks.some((entry) => entry.id === task.id);
    return store(exists ? course.tasks.map((entry) => entry.id === task.id ? task : entry) : [...course.tasks, task]);
  }

  return <>
    <button type="button" className="task-add" disabled={context.disabled || course.tasks.length >= 300} onClick={() => { setError(''); setDraft(blankTask()); }}>
      <Plus className="tool-icon" aria-hidden="true" />新建任务
    </button>
    {course.tasks.length === 0 && <p className="muted">暂无任务。</p>}
    <ul className="plain-list course-tasks">{course.tasks.map((task) => {
      const resource = resources.find((item) => item.id === task.resourceId);
      return <li className="task" key={task.id}>
        <div className="row task-row">
          <div className="task-summary">
            <strong>{task.title}</strong>
            {task.dueAt && <small className="muted">截止日期 {task.dueAt}</small>}
          </div>
          <select className="task-status" aria-label={task.title + '状态'} disabled={context.disabled || busy} value={task.status} onChange={(event) => {
            void update({ ...task, status: event.target.value as Task['status'] });
          }}>
            {Object.entries(statuses).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
          </select>
          <button type="button" className="quiet-button" disabled={context.disabled || busy} onClick={() => { setError(''); setDraft(task); }}>编辑任务</button>
        </div>
        {task.notes && <p className="preserve-lines">{task.notes}</p>}
        {resource && <ResourceAction item={resource} context={context} />}
      </li>;
    })}</ul>
    {!draft && error && <p role="alert" className="error">{error}</p>}
    {draft && <Dialog title={course.tasks.some((item) => item.id === draft.id) ? '编辑任务' : '新建任务'}
      onClose={() => { if (!busy) setDraft(undefined); }}>
      <form className="form" onSubmit={(event) => {
        event.preventDefault();
        if (draft.title.trim()) void update({ ...draft, title: draft.title.trim() });
      }}>
        <label>任务标题<input required maxLength={120} value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label>任务备注<textarea maxLength={4000} value={draft.notes}
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
        <label>截止日期<input type="date" value={draft.dueAt}
          onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} /></label>
        <label>任务状态<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Task['status'] })}>
          {Object.entries(statuses).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </select></label>
        <label>关联资源<select value={draft.resourceId ?? ''} onChange={(event) => setDraft({ ...draft, resourceId: event.target.value || null })}>
          <option value="">无</option>
          {resources.map((resource) => <option value={resource.id} key={resource.id}>{resource.title}</option>)}
        </select></label>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="row">
          <button type="submit" disabled={busy || !draft.title.trim()}>保存任务</button>
          {course.tasks.some((item) => item.id === draft.id) && <button type="button" disabled={busy} onClick={() => {
            if (window.confirm('删除任务「' + draft.title + '」？')) void store(course.tasks.filter((item) => item.id !== draft.id));
          }}>删除任务</button>}
        </div>
      </form>
    </Dialog>}
  </>;
}

export function StudyWidget({ course, context }: { course: Course; context: ActionContext }) {
  const [draft, setDraft] = useState<StudyState>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { currentTopic, nextAction, review } = course.study;
  return <>
    <div className="study-summary preserve-lines">
      {currentTopic && <p><strong>当前章节</strong> {currentTopic}</p>}
      {nextAction && <p><strong>下一步</strong> {nextAction}</p>}
      {review && <p><strong>待巩固</strong> {review}</p>}
      {!currentTopic && !nextAction && !review && <p className="muted">暂无学习进度。</p>}
    </div>
    <button type="button" disabled={context.disabled} onClick={() => { setError(''); setDraft(course.study); }}>填写进度</button>
    {draft && <Dialog title="手动学习进度" onClose={() => { if (!busy) setDraft(undefined); }}>
      <form className="form" onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
          if (await context.saveCourse({ ...course, study: draft })) setDraft(undefined);
          else setError('学习进度未能保存。当前内容已保留，请处理保存冲突后重试。');
        } catch (failure) {
          setError(message(failure));
        } finally {
          setBusy(false);
        }
      }}>
        <label>当前章节<input maxLength={500} value={draft.currentTopic} onChange={(event) => setDraft({ ...draft, currentTopic: event.target.value })} /></label>
        <label>下一步<textarea maxLength={1000} value={draft.nextAction} onChange={(event) => setDraft({ ...draft, nextAction: event.target.value })} /></label>
        <label>待巩固<textarea maxLength={4000} value={draft.review} onChange={(event) => setDraft({ ...draft, review: event.target.value })} /></label>
        {error && <p role="alert" className="error">{error}</p>}
        <button type="submit" disabled={busy}>保存进度</button>
      </form>
    </Dialog>}
  </>;
}
