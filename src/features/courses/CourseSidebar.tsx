import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Bookmark, BookOpen, ChevronRight, Copy, Ellipsis, ExternalLink, Files, Folder, FolderInput, FolderPlus, Link, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Course, ExplorerDates, Workspace } from '../../../shared/workspace.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { message } from '../../services/api.ts';
import { followInCurrentPage, matchesCourse, routeHref } from '../../services/navigation.ts';
import { emptyExplorer, explorerFolders, folderPrefixes, isUnder, treeKey } from './courseExplorer.ts';
import type { CourseTreeAction, CourseTreeItem } from './courseExplorer.ts';
import { useCourseTreeDrag } from './courseTreeDrag.ts';

type Entry = { item: CourseTreeItem; title: string; course?: Course; entries: Entry[] };
type Menu = { item?: CourseTreeItem; title: string; x: number; y: number; opener: HTMLElement };
const sortOptions = [
  ['manual', '手动顺序'], ['asc', '名称升序'], ['desc', '名称降序'],
  ['modified-desc', '修改日期（由新到旧）'], ['modified-asc', '修改日期（由旧到新）'],
  ['created-desc', '创建日期（由新到旧）'], ['created-asc', '创建日期（由旧到新）'],
] as const;
type Sort = (typeof sortOptions)[number][0];
const explorerPreferencesKey = 'workspace.courseTree.preferences';

function readExplorerPreferences() {
  try {
    const preferences = JSON.parse(localStorage.getItem(explorerPreferencesKey) ?? '{}');
    const sort = sortOptions.find(([key]) => key === preferences.sort)?.[0] ?? 'manual';
    return { sort, autoReveal: preferences.autoReveal !== false };
  } catch {
    return { sort: 'manual' as Sort, autoReveal: true };
  }
}
type InlineEdit = { item?: CourseTreeItem; parent: string; value: string };
type TrashEntry = NonNullable<Workspace['courseExplorer']>['trash'][number];

function buildEntries(courses: Course[], paths: string[][], sort: Sort, dates: Record<string, ExplorerDates> = {}) {
  const entries: Entry[] = [];
  const folders = new Map<string, Entry>();
  function ensureFolder(path: string[]) {
    let siblings = entries;
    for (const [index, title] of path.entries()) {
      const key = path.slice(0, index + 1).join('/');
      let folder = folders.get(key);
      if (!folder) {
        folder = { item: { kind: 'folder', key }, title, entries: [] };
        folders.set(key, folder);
        siblings.push(folder);
      }
      siblings = folder.entries;
    }
    return siblings;
  }
  for (const course of courses) ensureFolder(course.navigationPath).push({
    item: { kind: 'course', key: course.id }, title: course.name, course, entries: [],
  });
  paths.forEach(ensureFolder);
  if (sort !== 'manual') {
    const field = sort.startsWith('created') ? 'created' : sort.startsWith('modified') ? 'modified' : undefined;
    const direction = sort.endsWith('asc') ? 1 : -1;
    function sortItems(items: Entry[]) {
      items.sort((a, b) => {
        const byType = Number(b.item.kind === 'folder') - Number(a.item.kind === 'folder');
        if (byType) return byType;
        const byName = a.title.localeCompare(b.title, 'zh-CN', { numeric: true });
        if (!field) return byName * direction;
        const first = dates[treeKey(a.item)]?.[field];
        const second = dates[treeKey(b.item)]?.[field];
        if (first && second) return first.localeCompare(second) * direction || byName;
        return Number(!first) - Number(!second) || byName;
      });
      items.forEach((item) => sortItems(item.entries));
    }
    sortItems(entries);
  }
  return entries;
}

function ancestors(path: string) {
  return folderPrefixes(path ? path.split('/') : []).map((prefix) => prefix.join('/'));
}

function RowEditor({ label, value, change, close, submit }: {
  label: string; value: string; change: (name: string) => void; close: () => void; submit: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return <input className="course-tree-inline" ref={input} aria-label={label} value={value} size={1}
    onChange={(event) => change(event.target.value)}
    onBlur={() => { if (value.trim()) submit(); else close(); }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Enter') submit(); else close();
      }
    }} />;
}

type RowActions = {
  expanded: Set<string>; currentId?: string; draftIds: string[]; selected: Map<string, CourseTreeItem>;
  dragging?: CourseTreeItem; drop?: string; editor?: InlineEdit; renderEditor: (label: string) => React.ReactNode;
  courseHref: (id: string) => string;
  click: (event: MouseEvent<HTMLElement>, entry: Entry) => void;
  context: (event: MouseEvent<HTMLElement>, entry: Entry) => void;
};

function TreeRow({ entry, actions }: { entry: Entry; actions: RowActions }) {
  const branchId = useId();
  const { item, course, title } = entry;
  const key = treeKey(item);
  const selected = actions.selected.has(key);
  const dragging = actions.dragging && treeKey(actions.dragging) === key;
  const common = {
    'data-tree-item': key,
    'data-selected': selected || undefined,
    'data-dragging': dragging || undefined,
    'aria-keyshortcuts': 'F2 Delete Shift+F10',
    onClick: (event: MouseEvent<HTMLElement>) => actions.click(event, entry),
    onContextMenu: (event: MouseEvent<HTMLElement>) => actions.context(event, entry),
  };

  const renaming = actions.editor?.item && treeKey(actions.editor.item) === key;
  if (course) return <li>{renaming ? actions.renderEditor('重命名课程') : <a {...common} className="course-nav-item course-nav-course"
    draggable={false} data-course-drag={course.id} href={actions.courseHref(course.id)}
    aria-current={actions.currentId === course.id ? 'page' : undefined}
    aria-description={actions.draftIds.includes(course.id) ? '有布局草稿' : undefined}>
    <span className="course-nav-label">{title}</span>
    {actions.draftIds.includes(course.id) && <i className="course-nav-draft" aria-hidden="true" />}
  </a>}</li>;

  const open = actions.expanded.has(item.key);
  return <li>
    {renaming ? actions.renderEditor('重命名文件夹') : <button {...common} type="button" className="course-nav-item course-nav-group"
      data-folder-drag={item.key} data-course-drop={item.key} data-drop-active={actions.drop === item.key || undefined}
      aria-expanded={open} aria-controls={branchId}>
      <span className="course-nav-label">{title}</span>
      <ChevronRight className="tool-icon course-nav-chevron" aria-hidden="true" />
    </button>}
    <div id={branchId} className="course-nav-panel" data-open={open} inert={!open} aria-hidden={!open}>
      <ul className="course-nav-list course-nav-children">
        {entry.entries.map((child) => <TreeRow key={treeKey(child.item)} entry={child} actions={actions} />)}
        {actions.editor && !actions.editor.item && actions.editor.parent === item.key && <li>{actions.renderEditor('新文件夹名称')}</li>}
      </ul>
    </div>
  </li>;
}

function SidebarCollection({ label, children }: { label: string; children: React.ReactNode }) {
  return <details className="course-nav-archive">
    <summary className="course-nav-item course-nav-group">
      <span className="course-nav-label">{label}</span>
      <ChevronRight className="tool-icon course-nav-chevron" aria-hidden="true" />
    </summary>
    <ul className="plain-list course-nav-children">{children}</ul>
  </details>;
}

export function CourseSidebar({ visible, courses, explorer = emptyExplorer, current, home, disabled, drawer, draftIds, openHome, close,
  add, select, edit, act, canDrop, restore, courseHref }: {
  visible: boolean; courses: Course[]; explorer?: Workspace['courseExplorer']; current?: Course; home: boolean;
  disabled: boolean; drawer: boolean; draftIds: string[]; openHome: () => void; close: () => void;
  courseHref: (id: string) => string;
  add: (folder?: string) => void; select: (id: string) => void; edit: (course: Course) => void;
  act: (action: CourseTreeAction) => Promise<boolean>; canDrop: (items: CourseTreeItem[], target: string, copy?: boolean) => boolean;
  restore: (course: Course) => void;
}) {
  const tree = useRef<HTMLElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const selectionAnchor = useRef<string>(undefined);
  const menuAction = useRef<() => void>(undefined);
  const toolbarAction = useRef<() => void>(undefined);
  const busyRename = useRef(false);
  const [openBranches, setOpenBranches] = useState(() => new Set(ancestors(current?.navigationPath.join('/') ?? '')));
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('');
  const [preferences, setPreferences] = useState(readExplorerPreferences);
  const { sort, autoReveal } = preferences;
  useEffect(() => {
    try { localStorage.setItem(explorerPreferencesKey, JSON.stringify(preferences)); } catch { /* Session preferences are still available. */ }
  }, [preferences]);
  const [selected, setSelected] = useState(new Map<string, CourseTreeItem>());
  const [menu, setMenu] = useState<Menu>();
  const [editor, setEditor] = useState<InlineEdit>();
  const [moveItems, setMoveItems] = useState<CourseTreeItem[]>();
  const [destination, setDestination] = useState('');
  const [moveQuery, setMoveQuery] = useState('');
  const [purge, setPurge] = useState<TrashEntry>();
  const [notice, setNotice] = useState('');
  const [closedMatches, setClosedMatches] = useState(new Set<string>());

  const query = search.trim();
  const paths = explorerFolders(courses, explorer.folders);
  const matchingFolders = paths.filter((path) => (!scope || isUnder(path.join('/'), scope))
    && (!query || path.join('/').toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const matching = courses.filter((course) => !course.archived && (!scope || isUnder(course.navigationPath.join('/'), scope))
    && matchesCourse(course, query));
  const entries = buildEntries(matching, matchingFolders, sort, explorer.dates);
  const expanded = query || scope
    ? new Set(explorerFolders(matching, matchingFolders).map((path) => path.join('/')).filter((key) => !closedMatches.has(key)))
    : openBranches;
  const trashed = new Set(explorer.trash.flatMap((item) => item.courses));
  const archived = courses.filter((course) => course.archived && !trashed.has(course.id));

  function rows() {
    return Array.from(tree.current?.querySelectorAll<HTMLElement>('[data-tree-item]') ?? [])
      .filter((row) => !row.closest('[inert]'));
  }
  function focusItem(key: string, scroll = false) {
    requestAnimationFrame(() => {
      const row = rows().find((item) => item.dataset.treeItem === key);
      if (scroll) row?.scrollIntoView({ block: 'nearest' });
      row?.focus({ preventScroll: true });
    });
  }
  function openFolder(path: string) {
    const keys = ancestors(path);
    setOpenBranches((previous) => keys.every((key) => previous.has(key)) ? previous : new Set([...previous, ...keys]));
    setClosedMatches((previous) => keys.some((key) => previous.has(key))
      ? new Set([...previous].filter((key) => !keys.includes(key))) : previous);
  }
  function toggle(path: string) {
    const update = query || scope ? setClosedMatches : setOpenBranches;
    update((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }
  function reveal() {
    if (!current) return;
    setSearch('');
    setScope('');
    openFolder(current.navigationPath.join('/'));
    focusItem('course:' + current.id, true);
  }

  useLayoutEffect(() => { if (drawer) closeButton.current?.focus(); }, [drawer]);
  const currentPath = current?.navigationPath.join('/') ?? '';
  useEffect(() => {
    if (!autoReveal || home) return;
    openFolder(currentPath);
    const frame = requestAnimationFrame(() => sidebar.current?.querySelector('[aria-current=page]')?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [current?.id, currentPath, home, autoReveal]);

  function selectedItems(item: CourseTreeItem) {
    return selected.has(treeKey(item)) ? [...selected.values()] : [item];
  }

  const { dragging, target, preview, handlers } = useCourseTreeDrag(disabled || !!editor, openFolder,
    (item, path, copy) => canDrop(selectedItems(item), path, copy), async (item, path, copy) => {
      await moveSelection(selectedItems(item), path, copy ? 'duplicate' : 'move', copy ? '已复制到文件夹' : undefined);
    });

  async function moveSelection(items: CourseTreeItem[], target: string, type: 'duplicate' | 'move', success?: string) {
    if (!await run({ type, items, target }, success)) return false;
    openFolder(target);
    setSelected(new Map());
    return true;
  }

  async function run(action: CourseTreeAction, success?: string) {
    setNotice('');
    try {
      const saved = await act(action);
      if (saved && success) setNotice(success);
      return saved;
    } catch (error) {
      setNotice(message(error));
      return false;
    }
  }
  function newFolder(parent = '') {
    if (parent.split('/').filter(Boolean).length >= 3) { setNotice('文件夹最多可嵌套三级。'); return; }
    setNotice('');
    setSearch('');
    openFolder(parent);
    setEditor({ parent, value: '未命名文件夹' });
  }
  function startRename(item: CourseTreeItem, value: string) {
    setNotice('');
    setEditor({ item, parent: '', value });
  }
  function closeEditor() {
    if (editor?.item) focusItem(treeKey(editor.item));
    setEditor(undefined);
    setNotice('');
  }
  async function submitEditor() {
    if (!editor || busyRename.current || disabled) return;
    busyRename.current = true;
    const { item, value, parent } = editor;
    try {
      if (await run(item ? { type: 'rename', item, name: value } : { type: 'create-folder', parent, name: value })) {
        setEditor(undefined);
        const nextKey = item?.kind === 'course' ? treeKey(item)
          : 'folder:' + [...(item ? item.key.split('/').slice(0, -1) : parent ? parent.split('/') : []), value.trim()].join('/');
        if (item?.kind === 'folder' && expanded.has(item.key)) openFolder(nextKey.slice(7));
        focusItem(nextKey);
      }
    } finally { busyRename.current = false; }
  }
  function editRow(label: string) {
    return <RowEditor label={label} value={editor?.value ?? ''} close={closeEditor}
      change={(value) => { setNotice(''); setEditor((state) => state && { ...state, value }); }} submit={() => { void submitEditor(); }} />;
  }
  function beginMove(items: CourseTreeItem[]) {
    setMoveQuery('');
    setDestination('');
    setMoveItems(items);
  }
  function trash(items: CourseTreeItem[]) {
    void run({ type: 'trash', items }, '已移到回收站').then((saved) => { if (saved) setSelected(new Map()); });
  }
  function itemFromKey(key: string): CourseTreeItem {
    return { kind: key.startsWith('course:') ? 'course' : 'folder', key: key.slice(7) };
  }
  function selectRange(key: string) {
    const keys = rows().map((item) => item.dataset.treeItem!);
    const currentIndex = keys.indexOf(key);
    const previous = selectionAnchor.current ? keys.indexOf(selectionAnchor.current) : currentIndex;
    const anchor = previous < 0 ? currentIndex : previous;
    setSelected(new Map(keys.slice(Math.min(anchor, currentIndex), Math.max(anchor, currentIndex) + 1).map((value) => [value, itemFromKey(value)])));
  }
  function rowClick(event: MouseEvent<HTMLElement>, entry: Entry) {
    const key = treeKey(entry.item);
    if (event.altKey || (event.ctrlKey && entry.item.kind === 'folder')) {
      event.preventDefault();
      setSelected((previous) => {
        const next = new Map(previous);
        if (next.has(key)) next.delete(key); else next.set(key, entry.item);
        return next;
      });
      selectionAnchor.current = key;
      return;
    }
    if (event.shiftKey) { event.preventDefault(); selectRange(key); return; }
    setSelected(new Map());
    selectionAnchor.current = key;
    if (entry.course) {
      if (followInCurrentPage(event as MouseEvent<HTMLAnchorElement>)) select(entry.course.id);
    } else toggle(entry.item.key);
  }
  function rowContext(event: MouseEvent<HTMLElement>, entry?: Entry) {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    const opener = event.currentTarget;
    const bounds = opener.getBoundingClientRect();
    setMenu({ item: entry?.item, title: entry?.title ?? '课程', x: event.clientX || bounds.left, y: event.clientY || bounds.bottom, opener });
  }
  function keyboard(event: KeyboardEvent<HTMLElement>) {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tree-item]');
    if (!target || (event.target as HTMLElement).matches('input, select')) return;
    const key = target.dataset.treeItem!;
    const item = itemFromKey(key);
    if (event.key === 'Escape') { setSelected(new Map()); return; }
    if (event.key === 'F2' && !disabled) { event.preventDefault(); startRename(item, item.kind === 'course'
      ? courses.find(({ id }) => id === item.key)?.name ?? '' : item.key.split('/').at(-1)!); return; }
    if (event.key === 'Delete' && !disabled) { event.preventDefault(); trash(selectedItems(item)); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelected(new Map(rows().map((row) => [row.dataset.treeItem!, itemFromKey(row.dataset.treeItem!)])));
      return;
    }
    const list = rows();
    const index = list.indexOf(target);
    const next = { ArrowDown: list[index + 1], ArrowUp: list[index - 1], Home: list[0], End: list.at(-1) }[event.key];
    if (next) {
      event.preventDefault();
      if (event.shiftKey) {
        selectionAnchor.current ??= key;
        selectRange(next.dataset.treeItem!);
      }
      next.focus();
    }
    if (event.key === 'ArrowRight' && item.kind === 'folder') {
      event.preventDefault();
      if (!expanded.has(item.key)) openFolder(item.key);
      else if (target.parentElement?.contains(list[index + 1])) list[index + 1].focus();
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (item.kind === 'folder' && expanded.has(item.key)) toggle(item.key);
      else {
        const parent = item.kind === 'course' ? courses.find(({ id }) => id === item.key)?.navigationPath.join('/')
          : item.key.split('/').slice(0, -1).join('/');
        if (parent) focusItem('folder:' + parent);
      }
    }
  }

  const actions = { expanded, currentId: home ? undefined : current?.id, draftIds, selected, dragging: dragging?.item,
    drop: target, editor, courseHref, renderEditor: editRow, click: rowClick, context: rowContext };
  const menuItem = menu?.item;
  const menuCourse = menuItem?.kind === 'course' ? courses.find(({ id }) => id === menuItem.key) : undefined;
  const menuFolder = menuItem?.kind === 'folder' ? menuItem.key : '';
  const menuItems = menuItem ? selectedItems(menuItem) : [];
  const allExpanded = paths.length > 0 && paths.every((path) => expanded.has(path.join('/')));
  const expandLabel = allExpanded ? '折叠全部' : '展开全部';
  const groupCourses = menuFolder ? courses.filter(({ archived, navigationPath }) => !archived && isUnder(navigationPath.join('/'), menuFolder)) : [];
  const actionItem = (Icon: LucideIcon, label: string, action: () => void, danger = false) => <DropdownMenu.Item
    className={'course-management-item' + (danger ? ' danger-button' : '')} disabled={disabled}
    onSelect={() => { menuAction.current = action; }}>
    <Icon className="tool-icon" aria-hidden="true" />{label}
  </DropdownMenu.Item>;
  const clipboard = (value: string) => void navigator.clipboard.writeText(value).then(
    () => setNotice('已复制'), () => setNotice('无法复制到剪贴板。'));
  const bookmarks = explorer.bookmarks.flatMap((key) => {
    const item = itemFromKey(key);
    const course = item.kind === 'course' ? courses.find(({ id, archived }) => id === item.key && !archived) : undefined;
    if (course) return [{ item, title: course.name }];
    if (item.kind === 'folder' && paths.some((path) => path.join('/') === item.key)) return [{ item, title: item.key.split('/').at(-1)! }];
    return [];
  });

  return <aside className="sidebar" id="course-sidebar" hidden={!visible} ref={sidebar}
    onContextMenu={(event) => {
      if (!(event.target as HTMLElement).closest('input, button, a, summary, dialog, [role=menu]')) rowContext(event);
    }}
    inert={!visible} aria-hidden={!visible} role={drawer ? 'dialog' : undefined} aria-modal={drawer || undefined} aria-label={drawer ? '课程导航' : undefined}>
    <div className="sidebar-content">
      <a href={routeHref({ page: 'home' })} className="course-nav-item course-nav-course sidebar-home"
        aria-current={home ? 'page' : undefined} onClick={(event) => { if (followInCurrentPage(event)) openHome(); }}>
        <span className="course-nav-label">首页</span>
      </a>
      <div className="row sidebar-heading">
        <h2>课程</h2>
        <div className="course-tree-toolbar">
          <button type="button" className="quiet-button sidebar-add" disabled={disabled || courses.length >= 200}
            onClick={() => add()}><Plus className="tool-icon" aria-hidden="true" />新建课程</button>
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild><button type="button" className="quiet-button course-tree-menu-trigger" aria-label="课程树选项" title="课程树选项">
              <Ellipsis className="tool-icon" aria-hidden="true" />
            </button></DropdownMenu.Trigger>
            <DropdownMenu.Portal><DropdownMenu.Content className="course-management-actions course-group-menu" aria-label="课程树选项"
              align="end" sideOffset={4} collisionPadding={8}
              onCloseAutoFocus={(event) => {
                const action = toolbarAction.current;
                if (!action) return;
                event.preventDefault();
                toolbarAction.current = undefined;
                action();
              }}>
              <DropdownMenu.Item className="course-management-item" disabled={disabled} onSelect={() => {
                toolbarAction.current = () => newFolder();
              }}>新建文件夹</DropdownMenu.Item>
              <DropdownMenu.Item className="course-management-item" disabled={!paths.length} onSelect={() => {
                const keys = paths.map((path) => path.join('/'));
                setOpenBranches(new Set(allExpanded ? [] : keys));
                setClosedMatches(new Set(allExpanded ? keys : []));
              }}>{expandLabel}</DropdownMenu.Item>
              <DropdownMenu.Item className="course-management-item" disabled={!current} onSelect={() => {
                toolbarAction.current = reveal;
              }}>定位当前课程</DropdownMenu.Item>
              <DropdownMenu.CheckboxItem className="course-management-item" checked={autoReveal} onCheckedChange={(checked) => setPreferences({ ...preferences, autoReveal: checked })}>
                <DropdownMenu.ItemIndicator forceMount className="course-option-check" aria-hidden="true">✓</DropdownMenu.ItemIndicator>自动定位当前课程
              </DropdownMenu.CheckboxItem>
              <DropdownMenu.Separator className="course-tree-menu-separator" />
              <DropdownMenu.Label className="course-group-menu-label">排序方式</DropdownMenu.Label>
              <DropdownMenu.RadioGroup value={sort} onValueChange={(value) => setPreferences({ ...preferences, sort: value as Sort })}>
                {sortOptions.map(([key, title]) => <DropdownMenu.RadioItem
                  className="course-management-item" value={key} key={key}><DropdownMenu.ItemIndicator forceMount className="course-option-check" aria-hidden="true">✓</DropdownMenu.ItemIndicator>{title}</DropdownMenu.RadioItem>)}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content></DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
        {drawer && <button type="button" ref={closeButton} className="quiet-button drawer-close" onClick={close}>关闭</button>}
      </div>
      <div className="sidebar-search">
        <Search className="tool-icon" aria-hidden="true" />
        <input type="search" aria-label="搜索课程" placeholder={scope ? '筛选 ' + scope.split('/').at(-1) : '筛选此栏'} value={search} onChange={(event) => {
          setSearch(event.target.value); setClosedMatches(new Set()); setSelected(new Map());
        }} />
        {scope && <button type="button" className="quiet-button" aria-label="清除文件夹筛选" onClick={() => { setScope(''); setSearch(''); }}>×</button>}
      </div>
      {!!bookmarks.length && <SidebarCollection label="书签">
        {bookmarks.map(({ item, title }) => <li key={treeKey(item)}>
          <button type="button" className="quiet-button" onClick={() => {
            if (item.kind === 'course') select(item.key);
            else { setScope(''); setSearch(''); openFolder(item.key); focusItem(treeKey(item), true); }
          }}>{title}</button>
        </li>)}
      </SidebarCollection>}
      {selected.size > 0 && <div className="course-selection row">
        <span>{selected.size} 项已选</span>
        <button type="button" disabled={disabled} onClick={() => beginMove([...selected.values()])}>移动</button>
        <button type="button" disabled={disabled} onClick={() => trash([...selected.values()])}>删除</button>
      </div>}
      {notice && <p className="sidebar-empty" role="status">{notice}</p>}
      <nav ref={tree} aria-label="课程列表" className="course-nav" {...handlers} data-tree-dragging={!!dragging} onKeyDown={keyboard}
        onContextMenu={(event) => rowContext(event)}>
        <ul className="course-nav-list">
          {entries.map((entry) => <TreeRow key={treeKey(entry.item)} entry={entry} actions={actions} />)}
          {editor && !editor.item && !editor.parent && <li>{editRow('新文件夹名称')}</li>}
        </ul>
        <div className="course-root-drop" data-course-drop="" data-drop-active={target === '' ? true : undefined} aria-hidden={!dragging}>
          <Folder className="tool-icon" aria-hidden="true" />{dragging?.copy ? '复制到根目录' : '移动到根目录'}
        </div>
      </nav>
      {!entries.length && !editor && <p className="muted sidebar-empty">{query || scope ? '未找到匹配课程或文件夹。' : '暂无课程。'}</p>}
      {dragging && createPortal(<div ref={preview} className="course-drag-preview" aria-hidden="true"
        style={{ transform: 'translate3d(' + (dragging.x + 14) + 'px,' + (dragging.y + 12) + 'px,0)' }}>
        {dragging.item.kind === 'folder' ? <Folder className="tool-icon" /> : <BookOpen className="tool-icon" />}
        {selectedItems(dragging.item).length > 1 ? selectedItems(dragging.item).length + ' 项' : dragging.label}
        {dragging.copy && <span className="course-drag-copy"><Plus className="tool-icon" />复制</span>}
      </div>, document.body)}
      <DropdownMenu.Root modal={false} open={!!menu} onOpenChange={(open) => { if (!open) setMenu(undefined); }}>
        <DropdownMenu.Trigger asChild><span aria-hidden="true" tabIndex={-1} className="course-group-menu-anchor"
          style={menu && { left: menu.x, top: menu.y }} /></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content className="course-management-actions course-group-menu" aria-label="课程树菜单"
          align="start" collisionPadding={8} loop
          onEscapeKeyDown={() => menu?.opener.focus({ preventScroll: true })}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const action = menuAction.current;
            menuAction.current = undefined;
            action?.();
          }}>
          <DropdownMenu.Label className="course-group-menu-label">{menuItems.length > 1 ? menuItems.length + ' 项已选' : menu?.title}</DropdownMenu.Label>
          {menuItems.length <= 1 && menuCourse && <>
            {actionItem(Pencil, '编辑课程', () => { menu?.opener.focus({ preventScroll: true }); edit(menuCourse); })}
            {actionItem(ExternalLink, '在新标签页打开', () => { window.open(courseHref(menuCourse.id), '_blank', 'noopener,noreferrer'); })}
            {actionItem(ExternalLink, '在新窗口打开', () => { window.open(courseHref(menuCourse.id), '_blank', 'popup,noopener,noreferrer'); })}
          </>}
          {menuItems.length <= 1 && !menuCourse && <>
            {actionItem(Plus, '新建课程', () => add(menuFolder))}
            {actionItem(FolderPlus, '新建文件夹', () => newFolder(menuFolder))}
          </>}
          {menuItem && menuItems.length === 1 && <>
            <DropdownMenu.Separator className="course-tree-menu-separator" />
            {actionItem(Pencil, '重命名', () => startRename(menuItem, menu!.title))}
            {actionItem(Copy, '创建副本', () => { void run({ type: 'duplicate', items: [menuItem] }, '已创建副本'); })}
            {menuFolder && actionItem(Search, '搜索此文件夹', () => { setScope(menuFolder); setSearch(''); setClosedMatches(new Set()); sidebar.current?.querySelector<HTMLInputElement>('input[type=search]')?.focus(); })}
            {actionItem(Bookmark, explorer.bookmarks.includes(treeKey(menuItem)) ? '移除书签' : '添加书签', () => { void run({ type: 'bookmark', item: menuItem }); })}
            {actionItem(Files, '复制路径', () => clipboard(menuCourse ? [...menuCourse.navigationPath, menuCourse.name].join('/') : menuFolder))}
            {menuCourse && actionItem(Link, '复制链接', () => clipboard(new URL(courseHref(menuCourse.id), window.location.href).href))}
          </>}
          {!!menuItems.length && <>
            {menuItems.length === 1 && <DropdownMenu.Separator className="course-tree-menu-separator" />}
            {actionItem(FolderInput, '移动到…', () => beginMove(menuItems))}
            {actionItem(Trash2, '移到回收站', () => trash(menuItems), true)}
          </>}
          {groupCourses.length > 0 && menuItems.length === 1 && <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="course-management-item">编辑组内课程<ChevronRight className="tool-icon" aria-hidden="true" /></DropdownMenu.SubTrigger>
            <DropdownMenu.Portal><DropdownMenu.SubContent className="course-management-actions course-group-menu" collisionPadding={8}>
              {groupCourses.map((course) =>
                <DropdownMenu.Item key={course.id} className="course-management-item"
                  onSelect={() => { menuAction.current = () => { menu?.opener.focus({ preventScroll: true }); edit(course); }; }}>
                  <Pencil className="tool-icon" aria-hidden="true" />{course.name}
                </DropdownMenu.Item>)}
            </DropdownMenu.SubContent></DropdownMenu.Portal>
          </DropdownMenu.Sub>}
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
      {!!archived.length && <SidebarCollection label={'已归档（' + archived.length + '）'}>
        {archived.map((entry) => <li className="row" key={entry.id}>
          <span>{entry.name}</span>
          <button type="button" disabled={disabled} onClick={() => restore(entry)}>恢复课程</button>
        </li>)}
      </SidebarCollection>}
      {!!explorer.trash.length && <SidebarCollection label={'回收站（' + explorer.trash.length + '）'}>
        {explorer.trash.map((entry) => <li key={entry.id}><span>{entry.title}</span><div className="row">
          <button type="button" disabled={disabled} onClick={() => { void run({ type: 'restore', id: entry.id }, '已恢复'); }}>恢复</button>
          <button type="button" disabled={disabled} className="danger-button" onClick={() => setPurge(entry)}>永久删除</button>
        </div></li>)}
      </SidebarCollection>}
      {moveItems && <Dialog title="移动到文件夹" onClose={() => setMoveItems(undefined)}>
        <form className="form" onSubmit={async (event) => {
          event.preventDefault();
          if (await moveSelection(moveItems, destination, 'move', '已移动')) setMoveItems(undefined);
        }}>
          <label>搜索文件夹<input type="search" value={moveQuery} onChange={(event) => setMoveQuery(event.target.value)} /></label>
          <label>目标文件夹<select value={destination} onChange={(event) => setDestination(event.target.value)}>
            <option value="" disabled={!canDrop(moveItems, '')}>根目录</option>
            {paths.map((path) => path.join('/')).filter((path) => path === destination || path.toLocaleLowerCase().includes(moveQuery.toLocaleLowerCase())).map((path) =>
              <option key={path} value={path} disabled={!canDrop(moveItems, path)}>{path.replaceAll('/', ' / ')}</option>)}
          </select></label>
          {notice && <p role="status">{notice}</p>}
          <button type="submit" className="primary" disabled={disabled || !canDrop(moveItems, destination)}>确认移动</button>
        </form>
      </Dialog>}
      {purge && <Dialog title="永久删除" onClose={() => setPurge(undefined)}>
        <p>永久删除「{purge.title}」及对应的课程配置和站内入口。电脑里的原始资料会保留。</p>
        <button type="button" className="danger-button" disabled={disabled}
          onClick={async () => { if (await run({ type: 'purge', id: purge.id }, '已永久删除')) setPurge(undefined); }}>确认永久删除</button>
      </Dialog>}
    </div>
  </aside>;
}
