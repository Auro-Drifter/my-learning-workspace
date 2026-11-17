import type { MouseEvent } from 'react';
import type { Course, ExplorerDates } from '../../shared/workspace.ts';

export type WorkspaceRoute = { page: 'home' } | { page: 'home-pages' } | { page: 'course'; id?: string };

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;

export function courseAddresses(courses: Course[], dates?: Record<string, ExplorerDates>) {
  const byId = new Map(courses.map(({ id }) => [id, id]));
  const ids = new Map(byId);
  const named = courses.filter(({ id }) => uuid.test(id)).map(({ id, name }) => ({
    id,
    name: [...name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/gu, '')]
      .slice(0, 120).join('').replace(/-$/u, '') || 'course',
  })).sort((first, second) => (dates?.['course:' + first.id]?.created ?? '')
    .localeCompare(dates?.['course:' + second.id]?.created ?? '') || first.id.localeCompare(second.id));
  const reservedNames = new Set(named.map(({ name }) => name));
  for (const { id, name } of named) {
    let slug = name;
    let length = 8;
    while (ids.has(slug) || (slug !== name && reservedNames.has(slug))) {
      slug = name + '-' + (length <= id.length ? id.slice(0, length) : id + '-' + length);
      length += 4;
    }
    byId.set(id, slug);
    ids.set(slug, id);
  }
  return { byId, ids };
}

export function readWorkspaceRoute(hash: string): WorkspaceRoute {
  if (hash === '#home-pages') return { page: 'home-pages' };
  if (hash === '#course') return { page: 'course' };
  if (hash.startsWith('#course/') && hash.length < 1800) {
    try {
      const id = decodeURIComponent(hash.slice(8));
      if (/^[\p{L}\p{M}\p{N}_-]{1,160}$/u.test(id)) return { page: 'course', id };
    } catch { /* A malformed URL opens the homepage. */ }
  }
  return { page: 'home' };
}

export function routeHref(route: WorkspaceRoute, addresses?: ReturnType<typeof courseAddresses>) {
  if (route.page !== 'course') return '#' + route.page;
  return route.id ? '#course/' + encodeURIComponent(addresses?.byId.get(route.id) ?? route.id) : '#course';
}

export function followInCurrentPage(event: MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  event.preventDefault();
  return true;
}

export function matchesCourse(course: Course, query: string) {
  const text = [course.name, ...course.navigationPath, course.description].join(' ').toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/u).every((word) => text.includes(word));
}
