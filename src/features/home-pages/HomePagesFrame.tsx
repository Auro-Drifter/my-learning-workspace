import { useCallback, useEffect, useRef } from 'react';
import type { Appearance } from '../../../shared/appearance.ts';
import { fileLocationSchema } from '../../../shared/actions.ts';
import { fileKind } from '../../../shared/files.ts';
import type { RootGrant } from '../../../shared/files.ts';
import type { LocalResource } from '../../services/actionRouter.tsx';

export function HomePagesFrame({ roots, openFile, appearance }: {
  roots: RootGrant[]; openFile: (file: LocalResource) => void; appearance: Appearance;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const sendAppearance = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ kind: 'home-pages-appearance', appearance }, window.location.origin);
  }, [appearance]);
  useEffect(sendAppearance, [sendAppearance]);
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.data?.kind !== 'home-pages-open') return;
      const location = fileLocationSchema.safeParse({ rootId: event.data.rootId, path: event.data.path });
      if (!location.success || !roots.some(({ id }) => id === location.data.rootId)) return;
      const kind = fileKind(location.data.path);
      if (kind) openFile({ ...location.data, kind, id: 'home-pages-file', icon: '', title: location.data.path.split('/').at(-1)! });
    }
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [roots, openFile]);
  return <iframe ref={frame} className="home-pages-frame" src={import.meta.env.BASE_URL + 'home-pages.html'} title="Home Pages" onLoad={sendAppearance} />;
}
