import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyCourse } from '../shared/workspace.ts';
import { courseAddresses, matchesCourse, readWorkspaceRoute, routeHref } from '../src/services/navigation.ts';

test('course routes round-trip and accept the previous address format', () => {
  assert.deepEqual(readWorkspaceRoute(''), { page: 'home' });
  assert.deepEqual(readWorkspaceRoute('#course'), { page: 'course' });
  assert.deepEqual(readWorkspaceRoute(routeHref({ page: 'course', id: 'cs50x' })), { page: 'course', id: 'cs50x' });
  assert.deepEqual(readWorkspaceRoute('#course/../other'), { page: 'home' });
  assert.deepEqual(readWorkspaceRoute('#course/%E6%95%B0%E5%AD%A6'), { page: 'course', id: '数学' });
  assert.deepEqual(readWorkspaceRoute('#course/%2F'), { page: 'home' });
  assert.deepEqual(readWorkspaceRoute('#course/%E6'), { page: 'home' });
});

test('sidebar and command palette match multiple terms across course and group names', () => {
  const course = emptyCourse('cs50x', 'CS50x', 'Harvard 计算机基础');
  assert.equal(matchesCourse(course, '编程 Harvard'), true);
  assert.equal(matchesCourse(course, 'cs50x 方向'), true);
  assert.equal(matchesCourse(course, 'cs50x 数学'), false);
  assert.equal(matchesCourse(course, '  '), true);
});

test('custom courses get readable URLs without changing their internal IDs', () => {
  const first = emptyCourse('ffffffff-0000-4000-8000-000000000000', 'Introductory C Programming Specialization');
  const later = emptyCourse('00000000-0000-4000-8000-111111111111', first.name);
  const localized = emptyCourse('00000000-0000-4000-8000-222222222222', '操作系统（测试）');
  const seed = emptyCourse('linear-algebra', '线性代数');
  const dates = { ['course:' + later.id]: { created: '2026-11-17T12:00:01.000Z', modified: '2026-11-17T12:00:01.000Z' } };
  const addresses = courseAddresses([later, localized, seed, first], dates);
  const url = (id: string) => routeHref({ page: 'course', id }, addresses);
  assert.equal(url(first.id), '#course/introductory-c-programming-specialization');
  assert.equal(url(later.id), '#course/introductory-c-programming-specialization-00000000');
  assert.equal(url(seed.id), '#course/linear-algebra');
  assert.equal(decodeURIComponent(url(localized.id)), '#course/操作系统-测试');
  assert.equal(addresses.ids.get(first.id), first.id);
});
