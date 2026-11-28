import { useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { DocumentAttachment, DocumentPage } from '../domain/types';
import type { FigureRect } from '../domain/figure';
import { readPdfExcerpt, type ExcerptMark, type OpenReaderPdf } from '../adapters/pdf-excerpt';
import { sourceFormulas, type SourceFormula } from '../adapters/source-math';
import { t } from '../i18n/locale';
import { AnnotationActions } from './AnnotationActions';
import './source-excerpt.css';

function excerptText(text: string, formulas: SourceFormula[], mark?: ExcerptMark) {
  const nodes: ReactNode[] = [];
  const plain = (start: number, end: number) => {
    if (end <= start) return;
    if (!mark || mark[0] >= end || mark[1] <= start) { nodes.push(text.slice(start, end)); return; }
    const lo = Math.max(start, mark[0]), hi = Math.min(end, mark[1]);
    nodes.push(text.slice(start, lo), <mark key={lo}>{text.slice(lo, hi)}</mark>, text.slice(hi, end));
  };
  let at = 0;
  for (const formula of formulas) {
    plain(at, formula.start);
    const Tag = mark && mark[0] < formula.end && mark[1] > formula.start ? 'mark' : 'span';
    nodes.push(<Tag key={formula.start} className="source-formula" dangerouslySetInnerHTML={{ __html: formula.html }} />);
    at = formula.end;
  }
  plain(at, text.length);
  return <span className="source-excerpt-text">{nodes}</span>;
}

interface ExcerptProps {
  text: string;
  document?: DocumentAttachment;
  page?: DocumentPage;
  start?: number;
  mark?: ExcerptMark;
}

export function SourceExcerpt({ text, document: source, page, start, mark }: ExcerptProps) {
  const reader = useContext(AnnotationActions)?.readerPdf;
  const formulas = useMemo(() => sourceFormulas(text), [text]);
  const formatted = excerptText(text, formulas, mark);
  if (formulas.length || !reader || !page || source?.kind !== 'pdf' || reader.documentId !== source.id) return formatted;
  return <PdfExcerpt reader={reader} page={page} text={text} start={start} mark={mark}>{formatted}</PdfExcerpt>;
}

function PdfExcerpt({ reader, page, text, start, mark, children }: Omit<ExcerptProps, 'document' | 'page'> & { reader: OpenReaderPdf; page: DocumentPage; children: ReactNode }) {
  const lo = mark?.[0], hi = mark?.[1];
  const request = useMemo(() => ({ reader, page, text, start, mark: lo !== undefined && hi !== undefined ? [lo, hi] as const : undefined }), [reader, page, text, start, lo, hi]);
  const [preview, setPreview] = useState<{ request: typeof request; url: string; width: number; marks: FigureRect[] }>();
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    void readPdfExcerpt(request.reader, request.page, request.text, request.start, request.mark, controller.signal).then(result => {
      if (!result || controller.signal.aborted) return;
      url = URL.createObjectURL(result.image.blob);
      setPreview({ request, url, width: result.width, marks: result.marks });
    }).catch(() => { /* Saved text remains readable if the original cannot be rendered. */ });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [request]);
  if (preview?.request !== request) return <>{children}</>;
  return <>
    <div className="source-pdf-scroll"><div className="source-pdf-fragment" style={{ width: preview.width * 4 / 3, maxWidth: 'max(100%, ' + preview.width + 'px)' }}>
      <img alt={text} src={preview.url} draggable={false} />
      {preview.marks.map((box, i) => <span aria-hidden="true" key={i} style={{ left: box.x * 100 + '%', top: box.y * 100 + '%', width: box.width * 100 + '%', height: box.height * 100 + '%' }} />)}
    </div></div>
    <details className="source-extracted-text"><summary>{t('提取文字')}</summary>{children}</details>
  </>;
}
