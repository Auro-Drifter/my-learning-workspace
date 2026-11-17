import { randomUUID } from 'node:crypto';
import { defaultAppearance } from '../shared/appearance.ts';
import { defaultHome } from '../shared/home.ts';
import { defaultPluginLibrary } from '../shared/plugins.ts';
import { emptyCourse, firstFreePosition, SCHEMA_VERSION } from '../shared/workspace.ts';
import type { Course, Widget, Workspace } from '../shared/workspace.ts';
import type { Resource } from '../shared/actions.ts';

const web = (title: string, url: string): Resource => ({ id: randomUUID(), kind: 'web', title, url, icon: '' });

export function createDemo(): Workspace {
  const courses: Course[] = [
    emptyCourse('linear-algebra', '线性代数', '记录矩阵、向量空间与线性变换的学习资料。'),
    emptyCourse('calculus', '微积分', '整理极限、微分与积分的教材和练习。'),
    emptyCourse('c', 'C 语言', '整理 C 语言课程、练习和程序设计项目。'),
    emptyCourse('cs50x', 'CS50x', 'Harvard CS50 的计算机科学导论。'),
    emptyCourse('cs61a', 'CS61A', 'UC Berkeley 的计算机程序结构与解释。'),
  ];
  function addLinks(course: Course, title: string, items: Resource[] = []) {
    const widget: Widget = {
      id: randomUUID(), courseId: course.id, type: 'quickLinks', title, enabled: true, config: { items },
      layout: firstFreePosition(6, 5, course.widgets.map((entry) => entry.layout)),
    };
    course.widgets.push(widget);
  }
  addLinks(courses[0], '课程资源', [
    { id: randomUUID(), kind: 'markdown', title: '示例笔记', icon: '', rootId: 'demo', path: '线性代数.md' },
    { id: randomUUID(), kind: 'pdf', title: '示例教材', icon: '', rootId: 'demo', path: '教材示例.pdf' },
  ]);
  courses[0].widgets.push({
    id: randomUUID(), courseId: courses[0].id, type: 'text', title: '学习备注', enabled: true,
    layout: { x: 6, y: 0, w: 6, h: 5 }, config: { text: '' },
  });
  addLinks(courses[1], '课程资源');
  addLinks(courses[2], '课程资源');
  addLinks(courses[2], '编程工具', [web('VS Code 网页版', 'https://vscode.dev/')]);
  addLinks(courses[3], 'Lecture 与 Problem Sets', [web('CS50x 官方课程', 'https://cs50.harvard.edu/x/')]);
  addLinks(courses[3], '代码工具', [web('VS Code 网页版', 'https://vscode.dev/'), web('GitHub', 'https://github.com/')]);
  addLinks(courses[4], 'Reading 与 Lecture', [web('CS61A 官方课程', 'https://cs61a.org/')]);
  addLinks(courses[4], 'Lab、Discussion 与 Homework', [web('CS61A 课程资源', 'https://cs61a.org/resources/')]);
  for (const [index, selected] of courses.entries()) {
    const base = (title: string) => ({
      id: randomUUID(), courseId: selected.id, title, enabled: true,
      layout: firstFreePosition(6, 5, selected.widgets.map((entry) => entry.layout)),
    });
    selected.widgets.push({
      ...base(index < 2 ? '笔记与教材' : 'Markdown 笔记'),
      type: 'fileLibrary',
      config: { rootId: index < 2 ? 'demo' : '', folder: '', kind: index < 2 ? 'all' : 'markdown' },
    });
    selected.widgets.push({ ...base('作业'), type: 'tasks', config: {} });
    if (index !== 1 && index !== 2) selected.widgets.push({ ...base('学习进度'), type: 'study', config: {} });
  }
  return { schemaVersion: SCHEMA_VERSION, appearance: defaultAppearance, home: defaultHome, plugins: defaultPluginLibrary, activeCourseId: courses[0].id, courses, pdfPositions: [] };
}
