import { useCallback, useEffect, useRef, useState } from 'react';
import { workspaceSchema } from '../../shared/workspace.ts';
import type { Workspace } from '../../shared/workspace.ts';
import { ApiError, loadWorkspace, message, saveWorkspace } from './api.ts';
import type { WorkspaceSnapshot } from './api.ts';
import { useBeforeUnloadWarning } from './useBeforeUnloadWarning.ts';

type SaveReason = 'changes' | 'course-navigation';
type PendingOperation = { reason: 'reload' } | { reason: SaveReason; result: Promise<WorkspaceSnapshot> };

function isRevisionConflict(failure: unknown) {
  return failure instanceof ApiError && failure.code === 'stale_revision';
}

export function useWorkspace() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>();
  const [draft, setDraft] = useState<Workspace>();
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [savingReason, setSavingReason] = useState<SaveReason>();
  const pending = useRef<PendingOperation>(undefined);

  const reload = useCallback(async () => {
    if (pending.current) return;
    pending.current = { reason: 'reload' };
    setSavingReason('changes');
    setError('');
    try {
      setSnapshot(await loadWorkspace());
      setDraft(undefined);
      setConflict(false);
    } catch (failure) {
      setError(message(failure));
    } finally {
      pending.current = undefined;
      setSavingReason(undefined);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  useBeforeUnloadWarning(!!draft && savingReason !== 'course-navigation');

  async function commit(next: Workspace, reason: SaveReason = 'changes'): Promise<boolean> {
    const previous = pending.current;
    if (!snapshot || conflict || (previous && (previous.reason !== 'course-navigation' || reason !== 'changes'))) return false;
    const checked = workspaceSchema.safeParse(next);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      throw new Error(issue.path.join('.') + ' · ' + issue.message);
    }
    // An edit can wait for the metadata write and then use its returned revision.
    const base = previous?.reason === 'course-navigation' ? previous.result.catch((failure) => {
      if (isRevisionConflict(failure)) throw failure;
      return snapshot;
    }) : Promise.resolve(snapshot);
    const result = base.then((current) => saveWorkspace(checked.data, current));
    const operation = { reason, result };
    pending.current = operation;
    setSavingReason(reason);
    setDraft(checked.data);
    setError('');
    try {
      const saved = await result;
      setSnapshot(saved);
      if (pending.current === operation) {
        setDraft(undefined);
        if (saved.dialogAppearanceTemporary) setError('浏览器无法保存弹窗外观。本次外观调整仅在当前页面有效。');
      }
      return true;
    } catch (failure) {
      if (pending.current === operation) {
        if (isRevisionConflict(failure)) setConflict(true);
        setError(message(failure));
      }
      return false;
    } finally {
      if (pending.current === operation) {
        pending.current = undefined;
        setSavingReason(undefined);
      }
    }
  }

  return { workspace: draft ?? snapshot?.workspace, draft, error, conflict, saving: savingReason !== undefined, savingReason, commit, reload };
}
