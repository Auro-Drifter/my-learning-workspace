import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { FileLocation } from '../../../shared/actions.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { message } from '../../services/api.ts';
import { loadPdf } from '../../services/fileApi.ts';

GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfViewer({ location, title, lastPage, remember, close }: {
  location: FileLocation; title: string; lastPage: number;
  remember: (page: number) => Promise<boolean>; close: () => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(lastPage);
  const [zoom, setZoom] = useState(1);
  const [loadError, setLoadError] = useState('');
  const [renderError, setRenderError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const pageView = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState<{ number: number; zoom: number }>();
  const number = pdf ? Math.max(1, Math.min(pdf.numPages, page)) : 1;

  useEffect(() => {
    let done = false;
    let request: PDFDocumentLoadingTask | undefined;
    const controller = new AbortController();
    void loadPdf(location, controller.signal).then(async (data) => {
      if (done) return;
      request = getDocument({
        data, useWasm: true, enableXfa: false, useSystemFonts: true,
        cMapUrl: new URL(import.meta.env.BASE_URL + 'pdf-assets/cmaps/', document.baseURI).href, cMapPacked: true,
        standardFontDataUrl: new URL(import.meta.env.BASE_URL + 'pdf-assets/standard_fonts/', document.baseURI).href,
        wasmUrl: new URL(import.meta.env.BASE_URL + 'pdf-assets/wasm/', document.baseURI).href,
      });
      const loadedPdf = await request.promise;
      if (!done) setPdf(loadedPdf);
    }).catch((failure) => { if (!done) setLoadError(message(failure)); });
    return () => {
      done = true;
      controller.abort();
      if (request) void request.destroy().catch(() => {});
    };
  }, [location]);

  useEffect(() => {
    let done = false;
    let renderTask: RenderTask | undefined;
    const view = pageView.current;
    if (!pdf || !view) return;
    setRenderError('');
    void pdf.getPage(number).then(async (entry) => {
      if (done) return;
      const viewport = entry.getViewport({ scale: zoom });
      if (!Number.isFinite(viewport.width * viewport.height) || viewport.width <= 0 || viewport.height <= 0) throw new Error('PDF 页面的尺寸无效。');
      const scale = Math.min(devicePixelRatio, 5000 / viewport.width, 5000 / viewport.height,
        Math.sqrt(12_000_000 / viewport.width / viewport.height));
      // Keep the displayed canvas intact until the new render is complete.
      const canvas = document.createElement('canvas');
      canvas.ariaLabel = 'PDF 第 ' + number + ' 页';
      canvas.width = Math.max(1, Math.floor(viewport.width * scale));
      canvas.height = Math.max(1, Math.floor(viewport.height * scale));
      canvas.style.width = Math.min(10000, viewport.width) + 'px';
      canvas.style.height = Math.min(10000, viewport.height) + 'px';
      renderTask = entry.render({ canvas, viewport, transform: [scale, 0, 0, scale, 0, 0], annotationMode: 0 });
      await renderTask.promise;
      if (done) return;
      const previousPage = view.firstElementChild?.ariaLabel;
      view.replaceChildren(canvas);
      if (previousPage !== canvas.ariaLabel) view.scrollTo(0, 0);
      setRendered({ number, zoom });
    }).catch((failure) => { if (!done) setRenderError(message(failure)); });
    return () => { done = true; renderTask?.cancel(); };
  }, [pdf, number, zoom]);

  async function turn(next: number) {
    setPage(next);
    setSaving(true);
    setSaveError('');
    try {
      if (!await remember(next)) setSaveError('页码尚未保存。返回课程查看保存状态。');
    } catch (failure) {
      setSaveError(message(failure));
    } finally {
      setSaving(false);
    }
  }

  const rendering = !!pdf && !renderError && (rendered?.number !== number || rendered?.zoom !== zoom);

  return <Dialog title={title} className="reader-dialog" onClose={() => { if (!saving) close(); }}>
    <div className="file-viewer form">
      <p className="muted preserve-lines">{location.path}</p>
      {loadError && <p className="error" role="alert">{loadError}</p>}
      {renderError && <p className="error" role="alert">{renderError}</p>}
      {saveError && <p className="error" role="alert">{saveError}</p>}
      {pdf ? <>
        <div className="row">
          <button type="button" disabled={saving || number <= 1} onClick={() => void turn(number - 1)}>上一页</button>
          <span role="status">第 {number} / {pdf.numPages} 页</span>
          <button type="button" disabled={saving || number >= pdf.numPages} onClick={() => void turn(number + 1)}>下一页</button>
          <button type="button" disabled={zoom <= .5} onClick={() => setZoom(Math.max(.5, zoom - .25))}>缩小</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" disabled={zoom >= 3} onClick={() => setZoom(Math.min(3, zoom + .25))}>放大</button>
        </div>
        <div className="pdf-viewport">
          <div className="pdf-page" ref={pageView} aria-busy={rendering} />
          {rendering && <span className="pdf-render-status" role="status">正在渲染第 {number} 页…</span>}
        </div>
      </> : !loadError && <p role="status">正在加载 PDF…</p>}
    </div>
  </Dialog>;
}

