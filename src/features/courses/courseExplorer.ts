import { titleSchema } from '../../../shared/actions.ts';
import { navigationPathSchema } from '../../../shared/workspace.ts';
import type { Course, ExplorerDates, Workspace } from '../../../shared/workspace.ts';

export type CourseTreeItem = { kind: 'course' | 'folder'; key: string };
export const treeKey = ({ kind, key }: CourseTreeItem) => kind + ':' + key;
export const isUnder = (path: string, folder: string) => path === folder || path.startsWith(folder + '/');
const pathParts = (path: string) => path ? path.split('/') : [];
type Explorer = NonNullable<Workspace['courseExplorer']>;
export const emptyExplorer: Explorer = { folders: [], trash: [], bookmarks: [] };
export type CourseTreeAction =
  | { type: 'create-folder'; parent: string; name: string }
  | { type: 'rename'; item: CourseTreeItem; name: string }
  | { type: 'move'; items: CourseTreeItem[]; target: string }
  | { type: 'duplicate'; items: CourseTreeItem[]; target?: string }
  | { type: 'trash'; items: CourseTreeItem[] }
  | { type: 'restore' | 'purge'; id: string }
  | { type: 'bookmark'; item: CourseTreeItem };

export function folderPrefixes(path: string[]) {
  return path.map((_, index) => path.slice(0, index + 1));
}

export function foldersWithParents(paths: string[][]) {
  return uniquePaths(paths.flatMap(folderPrefixes));
}

export function explorerFolders(courses: Course[], folders: string[][] = []) {
  const coursePaths = courses.filter(({ archived }) => !archived).map(({ navigationPath }) => navigationPath);
  return foldersWithParents([...coursePaths, ...folders]);
}

export function recordCourseDates(next: Workspace, previous: Workspace): Workspace {
  const oldCourses = new Map(previous.courses.map((course) => [course.id, course]));
  const changed = next.courses.filter((course) => {
    const before = oldCourses.get(course.id);
    return !before || (before !== course && JSON.stringify(before) !== JSON.stringify(course));
  });
  if (!changed.length) return next;
  const now = new Date().toISOString();
  const explorer = next.courseExplorer ?? emptyExplorer;
  const dates: Record<string, ExplorerDates> = { ...explorer.dates };
  for (const course of changed) {
    const key = 'course:' + course.id;
    const created = dates[key]?.created ?? (oldCourses.has(course.id) ? undefined : now);
    dates[key] = created ? { created, modified: now } : { modified: now };
  }
  return { ...next, courseExplorer: { ...explorer, dates } };
}

function updateWorkspace(state: Workspace, courses: Course[], explorer: Explorer): Workspace {
  const active = courses.some(({ id, archived }) => id === state.activeCourseId && !archived);
  return { ...state, courses, courseExplorer: explorer, activeCourseId: active ? state.activeCourseId : courses.find(({ archived }) => !archived)?.id ?? null };
}

function uniquePaths(paths: string[][]) {
  return [...new Map(paths.map((path) => [path.join('/'), path])).values()];
}

function folderName(parent: string[], name: string) {
  if (!name.trim()) throw new Error('请输入文件夹名称。');
  const parsed = navigationPathSchema.safeParse([...parent, name]);
  if (!parsed.success) throw new Error('文件夹名称需为 1–40 字且不能包含斜杠，最多三级分组。');
  return parsed.data;
}

function folderChange(state: Workspace, source: string, next: string[]) {
  const explorer = state.courseExplorer ?? emptyExplorer;
  const folders = explorerFolders(state.courses, explorer.folders);
  const nextKey = next.join('/');
  if (!folders.some((path) => path.join('/') === source)) throw new Error('原文件夹已不存在。');
  if (nextKey === source) return state;
  if (isUnder(nextKey, source)) throw new Error('不能把文件夹移入自己的子文件夹。');
  if (folders.some((path) => path.join('/') === nextKey)) throw new Error('目标处已有同名文件夹。');
  const length = pathParts(source).length;
  function replace(path: string[]) {
    if (!isUnder(path.join('/'), source)) return path;
    const updated = [...next, ...path.slice(length)];
    if (!navigationPathSchema.safeParse(updated).success) throw new Error('移动后会超过三级目录。');
    return updated;
  }
  const now = new Date().toISOString();
  const dates = new Map(Object.entries(explorer.dates ?? {}).map(([key, value]) => {
    if (!key.startsWith('folder:') || !isUnder(key.slice(7), source)) return [key, value];
    const newKey = 'folder:' + replace(pathParts(key.slice(7))).join('/');
    return [newKey, { ...value, modified: now }];
  }));
  if (!dates.has('folder:' + nextKey)) dates.set('folder:' + nextKey, { modified: now });
  return updateWorkspace(state,
    state.courses.map((entry) => {
      const navigationPath = replace(entry.navigationPath);
      return navigationPath === entry.navigationPath ? entry : { ...entry, navigationPath };
    }), {
      ...explorer,
      folders: uniquePaths(folders.map(replace)),
      dates: Object.fromEntries(dates),
      trash: explorer.trash.map((record) => ({ ...record, folders: record.folders.map(replace) })),
      bookmarks: explorer.bookmarks.map((key) => key.startsWith('folder:') ? 'folder:' + replace(pathParts(key.slice(7))).join('/') : key),
    });
}

function topLevelItems(items: CourseTreeItem[], courses: Course[]) {
  const folders = items.filter(({ kind }) => kind === 'folder');
  if (!folders.length) return items;
  const paths = new Map(courses.map(({ id, navigationPath }) => [id, navigationPath.join('/')]));
  return items.filter((item) => {
    const path = item.kind === 'folder' ? item.key : paths.get(item.key) ?? '';
    return !folders.some((folder) => folder !== item && isUnder(path, folder.key));
  });
}

export function canCopyInto(state: Workspace, items: CourseTreeItem[], target: string) {
  const active = state.courses.filter(({ archived }) => !archived);
  const folders = explorerFolders(state.courses, state.courseExplorer?.folders);
  if (target && !folders.some((path) => path.join('/') === target)) return false;
  const destinationDepth = pathParts(target).length;
  const selection = topLevelItems(items, active);
  if (!selection.length) return false;
  let courses = state.courses.length;
  let directories = folders.length;
  for (const item of selection) {
    if (item.kind === 'course') {
      if (!active.some(({ id }) => id === item.key)) return false;
      courses++;
      continue;
    }
    if (target && isUnder(target, item.key)) return false;
    const descendants = folders.filter((path) => isUnder(path.join('/'), item.key));
    const sourceDepth = pathParts(item.key).length;
    if (!descendants.length || descendants.some((path) => path.length - sourceDepth + destinationDepth + 1 > 3)) return false;
    directories += descendants.length;
    courses += active.filter(({ navigationPath }) => isUnder(navigationPath.join('/'), item.key)).length;
  }
  return courses <= 200 && directories <= 800;
}

function copyTitle(name: string, existing: string[], limit: number) {
  const suffix = ' 副本';
  let result = name.slice(0, limit - suffix.length) + suffix;
  for (let index = 2; existing.includes(result); index++) {
    const variant = suffix + ' ' + index;
    result = name.slice(0, limit - variant.length) + variant;
  }
  return result;
}

function copyCourses(courses: Course[], name?: string, folder?: { from: string; to: string[] }) {
  const ids = new Map(courses.map(({ id }) => [id, crypto.randomUUID()]));
  return courses.map((course) => {
    const id = ids.get(course.id)!;
    const links = new Map<string, string>();
    const widgets = course.widgets.map((widget) => {
      const copied = { ...widget, id: crypto.randomUUID(), courseId: id };
      if (copied.type !== 'quickLinks') return copied;
      return { ...copied, config: { ...copied.config, items: copied.config.items.map((resource) => {
        const resourceId = crypto.randomUUID();
        links.set(resource.id, resourceId);
        return resource.kind === 'internal'
          ? { ...resource, id: resourceId, courseId: ids.get(resource.courseId) ?? resource.courseId }
          : { ...resource, id: resourceId };
      }) } };
    });
    return { ...course, id, name: name ?? course.name, widgets,
      navigationPath: folder ? [...folder.to, ...course.navigationPath.slice(pathParts(folder.from).length)] : course.navigationPath,
      tasks: course.tasks.map((task) => ({ ...task, id: crypto.randomUUID(), resourceId: task.resourceId ? links.get(task.resourceId) ?? null : null })),
    };
  });
}

function duplicateItem(state: Workspace, item: CourseTreeItem, target?: string): Workspace {
  const { courses } = state;
  const original = state.courseExplorer ?? emptyExplorer;
  const explorer = { ...original, folders: explorerFolders(courses, original.folders) };
  const activeCourses = courses.filter(({ archived }) => !archived);
  const source = activeCourses.find(({ id }) => id === item.key);
  if (target && !explorer.folders.some((path) => path.join('/') === target)) throw new Error('目标文件夹已不存在。');
  if (item.kind === 'course' && source) {
    const destination = target === undefined ? source.navigationPath : pathParts(target);
    const name = copyTitle(source.name, activeCourses.filter((entry) => entry.navigationPath.join('/') === destination.join('/'))
      .map((entry) => entry.name), 120);
    if (courses.length >= 200) throw new Error('课程已达到 200 门上限。');
    const [copy] = copyCourses([source], name);
    return { ...state, courses: [...courses, { ...copy, navigationPath: destination }] };
  }
  if (!explorer.folders.some((path) => path.join('/') === item.key)) return state;
  const group = activeCourses.filter(({ navigationPath }) => isUnder(navigationPath.join('/'), item.key));
  if (courses.length + group.length > 200) throw new Error('复制后会超过 200 门课程上限。');
  const path = pathParts(item.key);
  const parent = target === undefined ? path.slice(0, -1) : pathParts(target);
  if (target && isUnder(target, item.key)) throw new Error('不能把文件夹复制到自己的子文件夹。');
  const name = copyTitle(path.at(-1)!, explorer.folders.filter((entry) => entry.slice(0, -1).join('/') === parent.join('/'))
    .map((entry) => entry.at(-1)!), 40);
  const to = [...parent, name];
  const folders = explorer.folders.filter((entry) => isUnder(entry.join('/'), item.key)).map((entry) => [...to, ...entry.slice(path.length)]);
  if (folders.some((entry) => !navigationPathSchema.safeParse(entry).success)) throw new Error('复制后会超过三级目录。');
  const now = new Date().toISOString();
  const dates = { ...explorer.dates, ...Object.fromEntries(folders.map((entry) => ['folder:' + entry.join('/'), { created: now, modified: now }])) };
  return updateWorkspace(state, [...courses, ...copyCourses(group, undefined, { from: item.key, to })],
    { ...explorer, folders: [...explorer.folders, ...folders], dates });
}

function removeLinksToCourses(course: Course, removed: Set<string>): Course {
  const lostLinks = new Set<string>();
  const widgets = course.widgets.map((widget) => {
    if (widget.type !== 'quickLinks') return widget;
    const items = widget.config.items.filter((resource) => {
      if (resource.kind !== 'internal' || !removed.has(resource.courseId)) return true;
      lostLinks.add(resource.id);
      return false;
    });
    return items.length === widget.config.items.length ? widget : { ...widget, config: { ...widget.config, items } };
  });
  if (!lostLinks.size) return course;
  return { ...course, widgets, tasks: course.tasks.map((task) => task.resourceId && lostLinks.has(task.resourceId) ? { ...task, resourceId: null } : task) };
}

export function applyCourseTreeAction(state: Workspace, action: CourseTreeAction): Workspace {
  const { courses } = state;
  if (action.type === 'duplicate') {
    return topLevelItems(action.items, courses).reduce((next, item) => duplicateItem(next, item, action.target), state);
  }
  const original = state.courseExplorer ?? emptyExplorer;
  const explorer = { ...original, folders: explorerFolders(courses, original.folders) };
  const activeCourses = courses.filter(({ archived }) => !archived);
  switch (action.type) {
    case 'create-folder': {
      const path = folderName(pathParts(action.parent), action.name);
      if (explorer.folders.some((exists) => exists.join('/') === path.join('/'))) throw new Error('这里已有同名文件夹。');
      const now = new Date().toISOString();
      return updateWorkspace(state, courses, { ...explorer, folders: [...explorer.folders, path],
        dates: { ...explorer.dates, ['folder:' + path.join('/')]: { created: now, modified: now } } });
    }
    case 'rename': {
      if (action.item.kind === 'folder') {
        return folderChange(state, action.item.key, folderName(pathParts(action.item.key).slice(0, -1), action.name));
      }
      const name = titleSchema.safeParse(action.name);
      if (!name.success) throw new Error('课程名称需为 1–120 字。');
      const course = activeCourses.find(({ id }) => id === action.item.key);
      if (!course || course.name === name.data) return state;
      return { ...state, courses: courses.map((entry) => entry === course ? { ...entry, name: name.data } : entry) };
    }
    case 'move': {
      const target = pathParts(action.target);
      if (action.target && !explorer.folders.some((path) => path.join('/') === action.target)) throw new Error('目标文件夹已不存在。');
      return topLevelItems(action.items, courses).reduce((next, item) => {
        if (item.kind === 'folder') return folderChange(next, item.key, [...target, pathParts(item.key).at(-1)!]);
        const source = next.courses.find(({ id, archived }) => id === item.key && !archived);
        if (!source || source.navigationPath.join('/') === action.target) return next;
        return updateWorkspace(next, next.courses.map((course) => course === source ? { ...course, navigationPath: target } : course),
          next.courseExplorer ?? explorer);
      }, state);
    }
    case 'trash': {
      const items = topLevelItems(action.items, courses);
      const selectedFolders = items.filter(({ kind }) => kind === 'folder').map(({ key }) => key);
      const inFolder = (path: string[]) => selectedFolders.some((folder) => isUnder(path.join('/'), folder));
      const removed = activeCourses.filter((course) => items.some(({ kind, key }) => kind === 'course' && key === course.id) || inFolder(course.navigationPath));
      const folders = explorer.folders.filter(inFolder);
      if (!removed.length && !folders.length) return state;
      const ids = removed.map(({ id }) => id);
      const title = items.length === 1 ? (selectedFolders.length ? pathParts(selectedFolders[0]).at(-1)! : removed[0].name) : items.length + ' 项';
      const record = { id: crypto.randomUUID(), title, courses: ids, folders };
      return updateWorkspace(state, courses.map((course) => ids.includes(course.id) ? { ...course, archived: true } : course),
        { ...explorer, folders: explorer.folders.filter((path) => !inFolder(path)), trash: [...explorer.trash, record] });
    }
    case 'restore':
    case 'purge': {
      const record = explorer.trash.find(({ id }) => id === action.id);
      if (!record) return state;
      const trash = explorer.trash.filter(({ id }) => id !== record.id);
      if (action.type === 'restore') return updateWorkspace(state,
        courses.map((course) => record.courses.includes(course.id) ? { ...course, archived: false } : course),
        { ...explorer, trash, folders: uniquePaths([...explorer.folders, ...record.folders]) });
      const removed = new Set(record.courses);
      const remaining = courses.filter(({ id }) => !removed.has(id)).map((course) => removeLinksToCourses(course, removed));
      const activePaths = new Set(explorer.folders.map((path) => path.join('/')));
      const removedFolders = new Set(record.folders.map((path) => path.join('/')).filter((path) => !activePaths.has(path)));
      const kept = (key: string) => key.startsWith('course:') ? !removed.has(key.slice(7)) : !removedFolders.has(key.slice(7));
      const next = updateWorkspace(state, remaining, { ...explorer, trash, bookmarks: explorer.bookmarks.filter(kept),
        dates: explorer.dates && Object.fromEntries(Object.entries(explorer.dates).filter(([key]) => kept(key))) });
      const widgets = next.home.widgets;
      if (widgets?.shortcuts || widgets?.kanban?.courseId) next.home = { ...next.home, widgets: { ...widgets,
        shortcuts: widgets.shortcuts?.filter((item) => item.kind !== 'internal' || !removed.has(item.courseId)),
        kanban: widgets.kanban && removed.has(widgets.kanban.courseId) ? { ...widgets.kanban, courseId: '' } : widgets.kanban,
      } };
      return next;
    }
    case 'bookmark': {
      const key = treeKey(action.item);
      return { ...state, courseExplorer: { ...original, bookmarks: original.bookmarks.includes(key)
        ? original.bookmarks.filter((value) => value !== key) : [...original.bookmarks, key] } };
    }
  }
}
