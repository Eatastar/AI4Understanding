import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n/locale';
import { useLocale } from '../i18n/react';
import type { DocumentReaderProps } from './DocumentReader';
import { AnnotatedAnswer } from './AnnotatedAnswer';
import { ReaderToolbar } from './ReaderToolbar';
import { ReaderNavigation } from './ReaderNavigation';
import { FigureSelectionLayer } from './FigureSelectionLayer';
import { FigureAnnotationPanel } from './FigureAnnotationPanel';
import { KnowledgeDialog } from './KnowledgeBase';
import { useFigureShortcut } from './Translation';
import { confirmShortcut } from '../hooks/confirmation-shortcut';
import { desktop } from '../adapters/desktop';
import { clearFigureCache } from '../adapters/figure';
import { ebookFigureLocation, locateEbookFigure } from '../adapters/ebook-figure';
import { getDocumentBytes } from '../adapters/storage';
import { openEbook, type EbookSession, type EbookChapter, type EbookDestination } from '../adapters/ebooks';
import { bindEbookZoom, type EbookZoomController } from '../adapters/ebook-zoom';
import { clampPdfZoom } from '../domain/pdf-zoom';
import { loadEbookPosition, saveEbookPosition, loadEbookTypography, saveEbookTypography } from '../adapters/ebook-preferences';
import { readerTheme, colorLuminance, type ReaderAppearance } from '../domain/reader';
import { usesRelevantContext } from '../domain/document-context';
import { EBOOK_READING_LINE, ebookLayoutWidth, ebookScrollTop, ebookTypography, type EbookTypography, type EbookPosition } from '../domain/ebook';
import type { OutlineEntry, SearchHit } from '../domain/reader-navigation';
import { readerAnnotationRange } from '../adapters/reader-location';
import { markReaderSearch } from '../adapters/reader-search';
import { useReferenceHighlight } from '../hooks/useReferenceHighlight';
import { readFigure, type FigureRect } from '../domain/figure';
import { shortcutLabel } from '../domain/translation';
import './documents.css';
import './ebooks.css';
import countStyles from './annotation-counts.css?inline';

const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,pre,blockquote,table,figure';
const CSP = "default-src 'none'; script-src 'none'; img-src blob: data:; font-src blob: data:; style-src 'unsafe-inline' blob:; connect-src 'none'; media-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
function frameSource(chapter: EbookChapter, paper: string, ink: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">${chapter.head}<style>html,body{background:${paper};color:${ink};margin:0}body{overflow-wrap:anywhere}#ebook-mount{min-height:100vh}${countStyles}</style></head><body><main id="ebook-mount"></main></body></html>`;
}
function sizeEbookPage(doc: Document, textWidth: number) {
  // The unzoomed root reserves a stable scrollbar gutter; the chapter's
  // displayed width must not feed back into how its lines are laid out.
  const available = doc.documentElement.getBoundingClientRect().width;
  const width = ebookLayoutWidth(available, textWidth);
  doc.getElementById('ebook-mount')?.style.setProperty('width', `${width}px`, 'important');
}
function capturePosition(doc: Document, chapter: number): EbookPosition {
  const root = doc.querySelector<HTMLElement>('.ebook-text'), scroll = doc.scrollingElement;
  const blocks = root ? [...root.querySelectorAll<HTMLElement>(BLOCKS)] : [];
  const index = blocks.findIndex(el => el.getBoundingClientRect().bottom > EBOOK_READING_LINE);
  const rect = blocks[index]?.getBoundingClientRect();
  return { chapter, block: Math.max(0, index), offset: rect ? Math.max(0, Math.min(1, (EBOOK_READING_LINE - rect.top) / Math.max(1, rect.height))) : 0, fraction: scroll ? scroll.scrollTop / Math.max(1, scroll.scrollHeight - scroll.clientHeight) : 0, zoom: clampPdfZoom(Number(doc.getElementById('ebook-mount')?.style.zoom) || 1), horizontal: scroll ? scroll.scrollLeft / Math.max(1, scroll.scrollWidth - scroll.clientWidth) : 0 };
}
function restorePosition(doc: Document, position: EbookPosition) {
  const scroll = doc.scrollingElement; if (!scroll) return;
  const blocks = doc.querySelector('.ebook-text')?.querySelectorAll<HTMLElement>(BLOCKS);
  const rect = blocks?.[position.block]?.getBoundingClientRect();
  scroll.scrollTop = ebookScrollTop(position, scroll.scrollTop, scroll.scrollHeight - scroll.clientHeight, rect);
  scroll.scrollLeft = (position.horizontal || 0) * Math.max(0, scroll.scrollWidth - scroll.clientWidth);
}

export default function EbookReader(props: DocumentReaderProps) {
  useLocale();
  const { source, appearance } = props;
  const initial = useMemo(() => loadEbookPosition(source.id, source.pages.length), [source.id]);
  const [chapterIndex, setChapterIndex] = useState(initial.chapter), [pageInput, setPageInput] = useState(String(initial.chapter + 1));
  const [book, setBook] = useState<EbookSession | null>(null), [chapter, setChapter] = useState<EbookChapter | null>(null);
  const [frameDoc, setFrameDoc] = useState<Document | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [outline, setOutline] = useState<OutlineEntry[]>([]), [outlineError, setOutlineError] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const [comparedAppearance, setComparedAppearance] = useState<ReaderAppearance | null>(null);
  const [typography, setTypography] = useState(() => loadEbookTypography(source.id));
  const typographyRef = useRef(typography); typographyRef.current = typography;
  const [zoom, setZoom] = useState(initial.zoom || 1);
  const zoomRef = useRef(zoom), zoomController = useRef<EbookZoomController | null>(null);
  const [search, setSearch] = useState<{ hit: SearchHit; query: string; reference?: boolean } | null>(null);
  const referenceLocated = useReferenceHighlight(search, setSearch, frameDoc);
  const [returnTo, setReturnTo] = useState<EbookPosition | null>(null);
  const [externalLink, setExternalLink] = useState<string | null>(null);
  const [figureSelecting, setFigureSelecting] = useState(false), [capturing, setCapturing] = useState(false);
  const [figureDocked, setFigureDocked] = useState(false);
  const capturePending = useRef(false);
  const frameRef = useRef<HTMLIFrameElement>(null), pageInputRef = useRef<HTMLInputElement>(null);
  const pending = useRef<EbookPosition | null>(initial), pendingLink = useRef<EbookDestination | null>(null), pendingNote = useRef<string | null>(null);
  const position = useRef(initial), ready = useRef(false), frameState = useRef<{ doc: Document | null; index: number }>({ doc: null, index: chapterIndex });
  const propsRef = useRef(props); propsRef.current = props;
  const compare = comparedAppearance === appearance;
  const paper = compare ? '#ffffff' : appearance.paper, ink = compare ? '#000000' : appearance.ink;
  const palette = useMemo(() => readerTheme(paper, ink) as CSSProperties & Record<string, string>, [paper, ink]);
  const page = source.pages[chapterIndex];
  useEffect(() => { if (frameDoc && page) props.onLocation?.({ documentId: source.id, pageNumber: page.pageNumber }); }, [frameDoc, page, props.onLocation, source.id]);
  const capture = desktop()?.captureEbookSelection;
  const canCapture = Boolean(capture && frameDoc && page && props.onFigureAsk);
  const openedFigure = props.annotations.find(annotation => annotation.id === props.openAnnotationId && annotation.figure?.ebook && annotation.deletedAt === undefined);
  const toggleFigure = useCallback(() => {
    frameDoc?.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('learn:close-translations'));
    propsRef.current.onDismissFigure();
    setNavigationOpen(false);
    setFigureSelecting(value => !value);
  }, [frameDoc]);
  const cancelFigure = useCallback(() => setFigureSelecting(false), []);
  const figureShortcut = useFigureShortcut(rootRef, canCapture && !props.disabled && !capturing, figureSelecting, toggleFigure, cancelFigure, frameDoc);
  useEffect(() => () => clearFigureCache(source.id), [source.id]);
  const savePosition = () => {
    const state = frameState.current;
    if (ready.current && state.doc && frameRef.current?.isConnected && state.doc.scrollingElement?.clientHeight) position.current = capturePosition(state.doc, state.index);
    saveEbookPosition(source.id, position.current);
  };
  const saveRef = useRef(savePosition); saveRef.current = savePosition;
  useLayoutEffect(() => () => saveRef.current(), [source.id]);
  useEffect(() => { const timer = setTimeout(() => saveRef.current(), 220); return () => clearTimeout(timer); }, [zoom]);
  const jump = (index: number, next?: EbookPosition) => {
    if (index < 0 || index >= source.pages.length) return;
    savePosition(); props.onDismissFigure(); setSearch(null); setFigureSelecting(false); if (narrow) setNavigationOpen(false);
    if (next?.zoom !== undefined) { zoomRef.current = next.zoom; zoomController.current?.set(next.zoom); setZoom(next.zoom); }
    const destination = { ...(next || { chapter: index, block: 0, offset: 0, fraction: 0 }), zoom: zoomRef.current };
    pending.current = destination;
    // The reader may close before the new chapter's iframe is ready.
    position.current = destination;
    if (index === chapterIndex && frameDoc) { restorePosition(frameDoc, pending.current); pending.current = null; }
    else { ready.current = false; setFrameDoc(null); setChapter(null); setChapterIndex(index); }
    setPageInput(String(index + 1));
  };
  useEffect(() => {
    const root = rootRef.current; if (!root) return;
    const observer = new ResizeObserver(() => setNarrow(root.clientWidth < 760));
    observer.observe(root); return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controller = new AbortController(); let session: EbookSession | undefined;
    setLoading(true); setError('');
    void (async () => {
      try {
        const bytes = await getDocumentBytes(source.id); controller.signal.throwIfAborted();
        if (!bytes) throw new Error('原文件暂时不可用，请重新选择同一本电子书。');
        session = await openEbook(bytes, source.kind, controller.signal);
        if (controller.signal.aborted) { await session.destroy(); return; }
        if (session.count !== source.pages.length) throw new Error('电子书章节与阅读记录不一致，请重新导入文件。');
        setBook(session);
        try { const entries = await session.outline(controller.signal); if (!controller.signal.aborted) setOutline(entries); }
        catch { if (!controller.signal.aborted) setOutlineError(true); }
      } catch (cause) { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : '无法读取这本电子书。'); setLoading(false); } if (session) await session.destroy(); }
    })();
    return () => { controller.abort(); void session?.destroy(); };
  }, [source.id]);

  useEffect(() => {
    if (!book) return;
    const controller = new AbortController(); setLoading(true); setError('');
    void book.chapter(chapterIndex, controller.signal).then(value => {
      if (!controller.signal.aborted) { setChapter(value); setLoading(false); }
    }).catch(cause => { if (!controller.signal.aborted) { pendingLink.current = null; pendingNote.current = null; setError(cause instanceof Error ? cause.message : '无法读取这本电子书。'); setLoading(false); } });
    return () => controller.abort();
  }, [book, chapterIndex]);
  useEffect(() => { props.onLocation({ documentId: source.id, pageNumber: chapterIndex + 1 }); }, [source.id, chapterIndex, props.onLocation]);
  useEffect(() => {
    const unload = () => savePosition(); window.addEventListener('pagehide', unload);
    document.addEventListener('learn:save-edits', unload);
    return () => { savePosition(); window.removeEventListener('pagehide', unload); document.removeEventListener('learn:save-edits', unload); };
  }, [source.id]);

  // Persist typography without recreating iframe, annotations or publisher DOM.
  useLayoutEffect(() => {
    if (!frameDoc) return;
    let style = frameDoc.getElementById('ebook-user-style');
    if (!style) { style = frameDoc.createElement('style'); style.id = 'ebook-user-style'; frameDoc.head.append(style); }
    const darkPaper = colorLuminance(paper) < .179;
    style.textContent = `
      html,body{background:${paper}!important;color:${ink}!important;color-scheme:${darkPaper ? 'dark' : 'light'}}
      html{scrollbar-gutter:stable}
      ::-webkit-scrollbar{width:5px;height:5px}
      ::-webkit-scrollbar-thumb{background:${ink}2e;border-radius:999px}
      ::-webkit-scrollbar-thumb:hover{background:${ink}52}
      ::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}
      body{padding:0!important;margin:0!important;overflow-anchor:none;font-size:${typography.fontSize}px!important;line-height:${typography.lineHeight}!important;box-sizing:border-box}
      #ebook-mount{box-sizing:border-box!important;display:block!important;padding:24px 20px 60px!important;margin-inline:auto!important;max-width:none!important;overflow:visible!important}
      .ebook-text{max-width:${typography.width}px;margin-inline:auto;overflow-wrap:anywhere}
      .ebook-text *{color:inherit!important;line-height:inherit!important;background-color:transparent!important;cursor:text}
      .ebook-text :is(p,div,span,li,td){font-size:inherit!important}
      .ebook-text img,.ebook-text svg{max-width:100%!important;height:auto}
      .ebook-text :is(img,svg,svg *){cursor:default}
      .ebook-text :is(a,a *){color:${darkPaper ? '#9dc7ff' : '#2165aa'}!important;cursor:pointer}
      .ebook-text pre,.ebook-text table{max-width:100%;overflow:auto}
      .ebook-text table{display:block}
      .annotation-footnote{max-width:${typography.width}px;margin:12px auto;font:14px/1.6 sans-serif}
      .ebook-chapter-navigation{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;max-width:${typography.width}px;margin:40px auto 0;font:14px/1.5 sans-serif}
      .ebook-chapter-navigation button{border:1px solid ${ink}55;border-radius:8px;background:transparent;color:inherit;padding:8px 14px;cursor:pointer}
      .ebook-chapter-navigation button:hover:not(:disabled){background:${ink}12}
      .ebook-chapter-navigation button:disabled{opacity:.4;cursor:not-allowed}
      .ebook-annotator{position:relative}
      .reader-search-layer{position:absolute;inset:0;pointer-events:none}
      .reader-search-marker{position:absolute;background:#ffa80088;outline:1px solid #a2670080}
      .reader-reference-layer{opacity:.28}
      .reader-reference-layer .reader-search-marker{background:#e4a72b;outline:0}
      :focus-visible{outline:2px solid ${palette['--ls-focus']};outline-offset:2px}
      ::selection{background:#d8b35b80}
    `;
    sizeEbookPage(frameDoc, typography.width);
    if (ready.current && pending.current) { restorePosition(frameDoc, pending.current); pending.current = null; }
  }, [frameDoc, paper, ink, palette, typography]);

  useLayoutEffect(() => {
    if (!frameDoc) return;
    const controller = bindEbookZoom(frameDoc, { zoom: zoomRef.current, onZoom: value => { zoomRef.current = value; setZoom(value); } });
    zoomController.current = controller;
    return () => { controller.destroy(); if (zoomController.current === controller) zoomController.current = null; };
  }, [frameDoc]);

  useEffect(() => {
    if (!frameDoc) return;
    frameState.current = { doc: frameDoc, index: chapterIndex };
    let cancelled = false, restoreTimer: ReturnType<typeof setTimeout> | undefined, scrollTimer: ReturnType<typeof setTimeout> | undefined;
    const restore = () => {
      if (cancelled) return;
      ready.current = true;
      if (pending.current) restorePosition(frameDoc, pending.current);
      const target = pendingLink.current?.anchor?.(frameDoc);
      if (target) target.scrollIntoView({ block: 'start' });
      pendingLink.current = null; pending.current = null;
      if (pendingNote.current) { const id = pendingNote.current; pendingNote.current = null; locateNote(id); }
      savePosition();
    };
    const restoreWhenReady = async () => {
      await Promise.race([Promise.all([frameDoc.fonts.ready, ...[...frameDoc.images].map(img => img.complete ? Promise.resolve() : img.decode().catch(() => {}))]), new Promise(resolve => { restoreTimer = setTimeout(resolve, 1500); })]);
      restore();
    };
    void restoreWhenReady();
    const scroll = () => {
      if (!ready.current) return;
      clearTimeout(scrollTimer); scrollTimer = setTimeout(savePosition, 220);
      window.dispatchEvent(new Event('scroll'));
    };
    const pointer = (event: PointerEvent) => {
      const frame = frameRef.current; if (!frame) return;
      const rect = frame.getBoundingClientRect();
      frame.dispatchEvent(new PointerEvent(event.type, { bubbles: true, clientX: rect.left + event.clientX, clientY: rect.top + event.clientY, pointerId: event.pointerId, button: event.button, buttons: event.buttons }));
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    };
    let frameWidth = frameRef.current?.clientWidth, reflowFrame: number | undefined;
    const resize = new ResizeObserver(() => {
      if (reflowFrame !== undefined) return;
      // Updating the inner document during observer delivery can resize its annotation surface again.
      reflowFrame = requestAnimationFrame(() => {
        reflowFrame = undefined;
        const nextWidth = frameRef.current?.clientWidth;
        if (!nextWidth || nextWidth === frameWidth) return;
        frameWidth = nextWidth;
        const before = ready.current ? capturePosition(frameDoc, chapterIndex) : null;
        sizeEbookPage(frameDoc, typographyRef.current.width);
        if (before) restorePosition(frameDoc, before);
      });
    });
    if (frameRef.current) resize.observe(frameRef.current);
    frameDoc.addEventListener('scroll', scroll, { passive: true }); frameDoc.addEventListener('keydown', key);
    for (const name of ['pointerdown', 'pointermove', 'pointerup'] as const) frameDoc.addEventListener(name, pointer);
    return () => {
      cancelled = true; clearTimeout(restoreTimer); clearTimeout(scrollTimer); resize.disconnect();
      if (reflowFrame !== undefined) cancelAnimationFrame(reflowFrame);
      savePosition(); ready.current = false;
      if (frameState.current.doc === frameDoc) frameState.current = { doc: null, index: chapterIndex };
      frameDoc.removeEventListener('scroll', scroll); frameDoc.removeEventListener('keydown', key);
      for (const name of ['pointerdown', 'pointermove', 'pointerup'] as const) frameDoc.removeEventListener(name, pointer);
    };
  }, [frameDoc]);

  const locateNote = (id: string) => {
    if (!frameDoc) return;
    const annotation = propsRef.current.annotations.find(a => a.id === id), root = frameDoc.querySelector<HTMLElement>('.annotation-answer');
    if (annotation?.figure?.ebook) locateEbookFigure(frameDoc, annotation.figure.ebook);
    else {
      const range = annotation && root ? readerAnnotationRange(root, annotation.anchor) : null;
      if (range && frameDoc.scrollingElement) frameDoc.scrollingElement.scrollTop += range.getBoundingClientRect().top - 60;
    }
    propsRef.current.onOpen(id);
  };
  const selectNote = (id: string, index: number) => { if (index === chapterIndex && frameDoc) locateNote(id); else { jump(index); pendingNote.current = id; } };
  useLayoutEffect(() => {
    const { pageJump, onPageJumped } = props;
    if (!pageJump || pageJump.documentId !== source.id) return;
    const index = source.pages.findIndex(page => page.pageNumber === pageJump.pageNumber);
    if (index >= 0) {
      if (pageJump.sourceHit) {
        setReturnTo(frameDoc ? capturePosition(frameDoc, chapterIndex) : position.current);
        if (index !== chapterIndex) jump(index);
        setSearch({ ...pageJump.sourceHit, reference: true });
      }
      else if (pageJump.annotationId) selectNote(pageJump.annotationId, index);
      else jump(index);
    }
    onPageJumped?.(pageJump);
  }, [props.pageJump, props.onPageJumped, source.id, source.pages]);
  useEffect(() => {
    if (!frameDoc || !search || search.hit.pageIndex !== chapterIndex) return;
    const root = frameDoc.querySelector<HTMLElement>('.annotation-answer'); if (!root) return;
    const marked = markReaderSearch(root, root, search.query, search.hit.ordinal, search.reference);
    if (marked.marker && frameDoc.scrollingElement) frameDoc.scrollingElement.scrollTop += marked.marker.getBoundingClientRect().top - 70;
    referenceLocated(marked.marker);
    return marked.clear;
  }, [frameDoc, search, chapterIndex, referenceLocated]);

  const followLink = async (href: string, absolute = false) => {
    if (!book) return;
    try {
      if (/^https?:/i.test(href)) { setExternalLink(href); return; }
      if (/^mailto:/i.test(href)) return;
      const destination = await book.destination(href, chapterIndex, absolute); if (!destination) return;
      setReturnTo(frameDoc ? capturePosition(frameDoc, chapterIndex) : position.current);
      if (destination.index === chapterIndex && frameDoc) destination.anchor?.(frameDoc)?.scrollIntoView({ block: 'start' });
      else { jump(destination.index); pendingLink.current = destination; }
    } catch (cause) { props.onNotify(cause instanceof Error ? cause.message : t('无法跳转到电子书链接。')); }
  };
  const onSourceClick = (event: MouseEvent) => {
    const target = event.target as Element;
    const link = target.closest?.('[data-book-href]'); if (!link) return;
    event.preventDefault(); void followLink(link.getAttribute('data-book-href') || '');
  };
  const updateTypography = (value: EbookTypography) => {
    const next = ebookTypography(value);
    if (frameDoc && ready.current) pending.current = capturePosition(frameDoc, chapterIndex);
    typographyRef.current = next; setTypography(next);
    if (!saveEbookTypography(source.id, next)) props.onNotify(t('排版设置仅在本次有效，请检查本机存储空间。'));
  };
  const selectFigure = async (rect: FigureRect) => {
    const frame = frameRef.current, scroll = frameDoc?.scrollingElement;
    if (!canCapture || props.disabled || !capture || capturePending.current || !frame || !frameDoc || !scroll || !page) return;
    const bounds = frame.getBoundingClientRect();
    const x = Math.max(0, Math.ceil(bounds.left + rect.x * bounds.width));
    const y = Math.max(0, Math.ceil(bounds.top + rect.y * bounds.height));
    const width = Math.min(innerWidth, Math.floor(bounds.left + (rect.x + rect.width) * bounds.width)) - x;
    const height = Math.min(innerHeight, Math.floor(bounds.top + (rect.y + rect.height) * bounds.height)) - y;
    const location = ebookFigureLocation(frameDoc, x + width / 2 - bounds.left, y + height / 2 - bounds.top);
    const scrollTop = scroll.scrollTop, scrollLeft = scroll.scrollLeft;
    const stillSelected = () => {
      if (frameRef.current !== frame || frame.contentDocument !== frameDoc || scroll.scrollTop !== scrollTop || scroll.scrollLeft !== scrollLeft) return false;
      const next = frame.getBoundingClientRect();
      return (['x', 'y', 'width', 'height'] as const).every(key => Math.abs(bounds[key] - next[key]) < .5);
    };
    capturePending.current = true;
    setCapturing(true);
    setFigureSelecting(false);
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!stillSelected() || propsRef.current.disabled) return;
      const image = await capture({ x, y, width, height });
      if (!stillSelected() || propsRef.current.disabled) return;
      const figure = readFigure({ documentId: source.id, pageNumber: page.pageNumber, rect, strokes: [], ebook: { ...location, image } });
      const timestamp = Date.now();
      const used = new Set((propsRef.current.reservedColors || []).map(color => color.toLowerCase()));
      const colors = ['#f3cf67', '#a9c6f6', '#b7ddba', '#e6b4d7', '#c9baf1', '#f3ba95', '#94d5d3', '#d7d68d'];
      propsRef.current.onCreate({ id: crypto.randomUUID(), conversationId: propsRef.current.conversationId, messageId: page.messageId, versionId: page.versionId,
        quote: t('图片选区 · 第 {0} 章', [page.pageNumber]), anchor: { type: 'ebook-region' }, color: colors.find(color => !used.has(color)) || colors[0],
        question: '', answer: '', mode: 'ask', status: 'draft', edited: false, createdAt: timestamp, updatedAt: timestamp, figure });
    } catch {
      if (frameRef.current === frame) propsRef.current.onNotify(t('无法截取电子书选区，请缩小范围后重试。'));
    } finally { capturePending.current = false; setCapturing(false); }
  };
  const srcDoc = useMemo(() => chapter ? frameSource(chapter, paper, ink) : '', [chapter]);
  const pageAnnotations = props.annotations.filter(a => !a.figure && a.messageId === page?.messageId && a.versionId === page?.versionId);
  return <section ref={rootRef} className="document-reader ebook-reader" style={palette} data-reader-focused={props.focused} data-reader-dark={colorLuminance(paper) < .179} data-reader-narrow={narrow} data-reader-figure={!!openedFigure && figureDocked} data-figure-layout={narrow ? 'stacked' : 'side'}>
    <ReaderToolbar {...props} onClose={() => { savePosition(); props.onClose(); }}
      onOpenWiki={props.onOpenWiki && (() => { savePosition(); props.onOpenWiki?.(); })}
      projectReturn={props.projectReturn && { title: props.projectReturn.title, onReturn: () => { savePosition(); props.projectReturn?.onReturn(); } }}
      figureSelecting={figureSelecting} figureBusy={capturing || props.disabled} onToggleFigure={canCapture ? toggleFigure : undefined} kind={source.kind} name={source.name} pageCount={source.pages.length} pageIndex={chapterIndex} pageInput={pageInput} pageInputRef={pageInputRef} onPageInput={setPageInput} onCommitPage={() => { const n = Number(pageInput); if (Number.isInteger(n) && n >= 1 && n <= source.pages.length) jump(n - 1); else setPageInput(String(chapterIndex + 1)); }} onPage={index => jump(index)} zoom={zoom} onZoom={value => zoomController.current?.set(value)} view="original" onView={() => {}} layout="paged" onLayout={() => {}} appearance={appearance} onAppearance={props.onAppearance} saved={props.appearanceSaved} compareOriginal={compare} onCompareOriginal={() => setComparedAppearance(compare ? null : appearance)} navigationOpen={navigationOpen} onToggleNavigation={() => setNavigationOpen(value => !value)} relevantContext={usesRelevantContext(source, props.contextMode)} onReturnFromLink={returnTo ? () => { jump(returnTo.chapter, returnTo); setReturnTo(null); } : undefined} typography={typography} onTypography={updateTypography} />
    {(figureSelecting || capturing) && <div className="figure-selection-hint" role="status">{t(capturing ? '正在截取选区…' : '拖动框选后可以圈画提问。按 Esc 或 {0} 取消。', [shortcutLabel(figureShortcut)])}</div>}
    <div className="document-reader-body">
      <ReaderNavigation open={navigationOpen} source={source} annotations={props.annotations} pageIndex={chapterIndex} outline={outline.length ? outline : source.pages.map((page, index) => ({ key: page.messageId, title: page.title || t('第 {0} 章', [index + 1]), depth: 0, pageIndex: index }))} outlineLoading={!book && loading} outlineError={outlineError} outlineTruncated={outline.length >= 1000} onClose={() => setNavigationOpen(false)} onPage={index => jump(index)} onOutline={entry => { if (entry.href) void followLink(entry.href, true); else if (entry.pageIndex !== null) jump(entry.pageIndex); }} onSearch={(hit, query) => { if (hit.pageIndex !== chapterIndex) jump(hit.pageIndex); setSearch({ hit, query }); }} onClearSearch={() => setSearch(null)} onAnnotation={selectNote} />
      <div className="ebook-content" style={{ background: paper }}>
        {(loading || error) && <div className="document-reader-empty" role="status">{t(error || '正在读取电子书…')}</div>}
        {chapter && page && !error && <iframe key={chapterIndex} ref={frameRef} title={t('电子书正文')} className="ebook-frame" sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={srcDoc} style={{ background: paper }} onLoad={event => { const doc = event.currentTarget.contentDocument; if (doc?.getElementById('ebook-mount')) { doc.documentElement.lang = chapter.lang; doc.documentElement.className = chapter.htmlClass; doc.body.className = chapter.bodyClass; doc.body.dir = chapter.dir; setFrameDoc(doc); } }} />}
        {frameDoc?.getElementById('ebook-mount') && page && chapter && createPortal(<><AnnotatedAnswer {...props} readerStyle={palette} annotations={pageAnnotations} messageId={page.messageId} version={{ id: page.versionId, content: page.text, createdAt: source.createdAt, status: 'complete' }} contentClassName="ebook-annotator" content={<div className="ebook-text" onClick={onSourceClick} dangerouslySetInnerHTML={{ __html: chapter.body }} />} /><nav className="ebook-chapter-navigation"><button type="button" disabled={chapterIndex === 0} onClick={() => jump(chapterIndex - 1)}>{t('上一章')}</button><span>{t('第 {0} 章', [chapterIndex + 1])} / {source.pages.length}</span><button type="button" disabled={chapterIndex >= source.pages.length - 1} onClick={() => jump(chapterIndex + 1)}>{t('下一章')}</button></nav></>, frameDoc.getElementById('ebook-mount')!)}
        {figureSelecting && canCapture && !props.disabled && <FigureSelectionLayer enabled annotations={[]} openedId={null} onSelect={rect => void selectFigure(rect)} onOpen={props.onOpen} onNotify={props.onNotify} />}
      </div>
      {openedFigure && props.modelSettings && props.onFigureAsk && <FigureAnnotationPanel key={openedFigure.id} docked={figureDocked} onDockChange={setFigureDocked} annotation={openedFigure} settings={props.modelSettings} disabled={props.disabled} onClose={props.onDismissFigure} onLocate={() => { const index = source.pages.findIndex(item => item.messageId === openedFigure.messageId); if (index >= 0) selectNote(openedFigure.id, index); }} onUpdate={patch => props.onUpdate(openedFigure.id, patch)} onStrokes={strokes => props.onFigureStrokes?.(openedFigure.id, strokes)} onAsk={(image, profileId) => props.onFigureAsk?.(openedFigure.id, image, profileId)} onStop={() => props.onStop(openedFigure.id)} onReask={action => props.onReask(openedFigure.id, action)} onDelete={() => props.onDelete(openedFigure.id)} onReferenceToChat={props.onReferenceToChat ? () => props.onReferenceToChat?.(openedFigure.id) : undefined} onSettings={props.onOpenModelSettings} />}
    </div>
    {externalLink && <KnowledgeDialog title={t('打开链接')} onClose={() => setExternalLink(null)} actions={<>
      <button type="button" className="secondary-button" onClick={() => setExternalLink(null)}>{t('取消')}</button>
      <button type="button" className="primary-button" data-knowledge-focus {...confirmShortcut} onClick={() => {
        window.open(externalLink, '_blank', 'noopener,noreferrer');
        setExternalLink(null);
      }}>{t('确定')}</button>
    </>}>
      <p className="knowledge-dialog-body" style={{ overflowWrap: 'anywhere' }}>{t('即将使用系统浏览器打开链接：{0}', [externalLink])}</p>
    </KnowledgeDialog>}
  </section>;
}
