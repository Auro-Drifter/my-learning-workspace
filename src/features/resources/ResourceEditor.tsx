import { useState } from 'react';
import type { Resource } from '../../../shared/actions.ts';
import type { Course } from '../../../shared/workspace.ts';
import { moveItem } from '../../../shared/workspace.ts';
import type { RootGrant } from '../../../shared/files.ts';
import { FilePicker } from './FileLibrary.tsx';
import { LocalPickerButton } from '../../components/LocalPickerButton.tsx';

export const resourceKinds = {
  web: '网页链接', internal: '工作台里的课程', obsidian: 'Obsidian', vscode: 'VS Code', markdown: '笔记（Markdown）', pdf: 'PDF',
} satisfies Record<Resource['kind'], string>;

export function newResource(kind: Resource['kind'], base: Pick<Resource, 'id' | 'title' | 'icon'> = { id: crypto.randomUUID(), title: '', icon: '' }): Resource {
  const { id, title, icon } = base;
  const common = { id, title, icon };
  switch (kind) {
    case 'web': return { ...common, kind, url: '' };
    case 'internal': return { ...common, kind, courseId: '' };
    case 'obsidian': return { ...common, kind, vault: '', file: '' };
    case 'vscode': return { ...common, kind, path: '' };
    case 'markdown':
    case 'pdf': return { ...common, kind, rootId: '', path: '' };
  }
}

const iconOptions = [
  ['🔗', '链接'], ['📘', '课程或教材'], ['📝', '笔记'], ['📄', '文档'], ['💻', '编程'],
  ['🧪', '实验'], ['🎬', '视频'], ['📁', '项目'], ['📌', '常用'],
] as const;

function ResourceIconPicker({ value, change }: { value: string; change: (icon: string) => void }) {
  const [custom, setCustom] = useState(false);
  const useCustom = custom || (value !== '' && !iconOptions.some(([icon]) => icon === value));
  return <div className="resource-icon-picker">
    <label>图标<select value={useCustom ? 'custom' : value} onChange={(event) => {
      const next = event.target.value;
      setCustom(next === 'custom');
      if (next !== 'custom') change(next);
    }}>
      <option value="">无图标</option>
      {iconOptions.map(([icon, label]) => <option key={icon} value={icon}>{icon} {label}</option>)}
      <option value="custom">自定义…</option>
    </select></label>
    {useCustom && <label>自定义图标<input maxLength={12} value={value}
      placeholder="输入表情或字符" onChange={(event) => change(event.target.value)} /></label>}
  </div>;
}

export function ResourceEditor({ items, change, courses, roots, updateRoots }: {
  items: Resource[]; change: (items: Resource[]) => void; courses: Course[]; roots: RootGrant[];
  updateRoots: (roots: RootGrant[]) => void;
}) {
  return <div className="form">
    {items.map((item, index) => {
      function update(next: Resource) {
        change(items.map((entry) => entry.id === item.id ? next : entry));
      }
      return <fieldset className="resource-form" key={item.id}>
        <legend>{item.title || '快捷入口 ' + (index + 1)}</legend>
        <div className="row">
          <label>标题<input required maxLength={120} value={item.title}
            onChange={(event) => update({ ...item, title: event.target.value })} /></label>
          <ResourceIconPicker value={item.icon} change={(icon) => update({ ...item, icon })} />
          <label>类型<select aria-label="入口类型" value={item.kind} onChange={(event) => update(newResource(event.target.value as Resource['kind'], item))}>
            {Object.entries(resourceKinds).map(([kind, label]) =>
              <option key={kind} value={kind}>{label}</option>)}
          </select></label>
        </div>
        {item.kind === 'web' && <label>网页地址<input type="url" required placeholder="https://example.org/"
          value={item.url} onChange={(event) => update({ ...item, url: event.target.value })} /></label>}
        {item.kind === 'internal' && <label>目标课程<select required value={item.courseId}
          onChange={(event) => update({ ...item, courseId: event.target.value })}>
          <option value="">选择课程</option>
          {courses.map((course) => <option key={course.id} value={course.id}>{course.name}{course.archived ? '（归档）' : ''}</option>)}
        </select></label>}
        {item.kind === 'obsidian' && <>
          <p className="muted">点「选择笔记…」会一起填好笔记库和笔记的位置。只想打开整个笔记库时，点「选择笔记库…」。</p>
          <div className="path-picker">
            <label>笔记库名称<input required value={item.vault} onChange={(event) => update({ ...item, vault: event.target.value })} /></label>
            <LocalPickerButton label="选择笔记库…" request={{ kind: 'obsidian-vault' }} select={(selection) => {
              if (selection.kind === 'obsidian') update({ ...item, vault: selection.vault, file: '' });
            }} />
          </div>
          <div className="path-picker">
            <label>笔记在库中的位置（选填）<input placeholder="目录/笔记.md" value={item.file}
              onChange={(event) => update({ ...item, file: event.target.value })} /></label>
            <LocalPickerButton label="选择笔记…" request={{ kind: 'obsidian-note' }} select={(selection) => {
              if (selection.kind === 'obsidian') update({ ...item, vault: selection.vault, file: selection.file });
            }} />
          </div>
        </>}
        {item.kind === 'vscode' && <div className="form">
          <label>文件或项目文件夹的位置<input required placeholder="C:\Projects\Course"
            value={item.path} onChange={(event) => update({ ...item, path: event.target.value })} /></label>
          <div className="row">
            <LocalPickerButton label="浏览文件…" request={{ kind: 'vscode-file' }} select={(selection) => {
              if (selection.kind === 'path') update({ ...item, path: selection.path });
            }} />
            <LocalPickerButton label="选择项目文件夹…" request={{ kind: 'vscode-folder' }} select={(selection) => {
              if (selection.kind === 'path') update({ ...item, path: selection.path });
            }} />
          </div>
        </div>}
        {(item.kind === 'markdown' || item.kind === 'pdf') && <FilePicker item={item} roots={roots} updateRoots={updateRoots} update={update} />}
        <div className="row">
          <button type="button" disabled={index === 0} onClick={() => change(moveItem(items, index, -1))}>上移</button>
          <button type="button" disabled={index === items.length - 1} onClick={() => change(moveItem(items, index, 1))}>下移</button>
          <button type="button" onClick={() => change(items.filter((entry) => entry.id !== item.id))}>移除入口</button>
        </div>
      </fieldset>;
    })}
    <button type="button" disabled={items.length >= 40} onClick={() => change([...items, newResource('web')])}>新增快捷入口</button>
  </div>;
}
