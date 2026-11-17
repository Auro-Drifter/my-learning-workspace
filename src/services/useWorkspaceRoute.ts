import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { Workspace } from '../../shared/workspace.ts';
import { courseAddresses, readWorkspaceRoute, routeHref } from './navigation.ts';
import type { WorkspaceRoute } from './navigation.ts';

function currentLocation() {
  const hash = window.location.hash;
  const state = window.history.state;
  return { hash, id: state?.courseHash === hash && typeof state.courseId === 'string' ? state.courseId as string : undefined };
}

export function useWorkspaceRoute(workspace?: Workspace) {
  const courses = workspace?.courses;
  const dates = workspace?.courseExplorer?.dates;
  const addresses = useMemo(() => courseAddresses(courses ?? [], dates), [courses, dates]);
  const [location, setLocation] = useState(currentLocation);
  const parsed = readWorkspaceRoute(location.hash);
  const id = parsed.page === 'course' && parsed.id
    ? (location.id && addresses.byId.has(location.id) ? location.id : addresses.ids.get(parsed.id))
    : undefined;
  const route: WorkspaceRoute = id ? { page: 'course', id } : parsed;

  useEffect(() => {
    const sync = () => setLocation(currentLocation());
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);

  useLayoutEffect(() => {
    if (!id || location.hash !== window.location.hash) return;
    const canonical = routeHref({ page: 'course', id }, addresses);
    if (canonical === location.hash && location.id === id) return;
    window.history.replaceState({ ...window.history.state, courseId: id, courseHash: canonical }, '', canonical);
    setLocation({ hash: canonical, id });
  }, [addresses, id, location]);

  function navigate(next: WorkspaceRoute, replace = false) {
    const href = routeHref(next, addresses);
    if (window.location.hash === href) return;
    const courseId = next.page === 'course' ? next.id : undefined;
    const state = courseId ? { courseId, courseHash: href } : null;
    if (replace) window.history.replaceState(state, '', href);
    else window.history.pushState(state, '', href);
    setLocation({ hash: href, id: courseId });
  }

  return { route, navigate, courseHref: (id: string) => routeHref({ page: 'course', id }, addresses) };
}
