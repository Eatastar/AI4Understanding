import type { JSONContent } from '@tiptap/core';
import { textPreview } from '../domain/text-preview';
import type { ReferenceItem, SourceCitation, WikiRecord } from './wiki-types';

export function walkWikiDocument(node: JSONContent, visit: (node: JSONContent) => void) {
  visit(node);
  for (const child of node.content ?? []) walkWikiDocument(child, visit);
}

export function wikiText(body: JSONContent): string {
  const parts: string[] = [];
  const collect = (node: JSONContent) => {
    if (node.text !== undefined) { parts.push(node.text); return; }
    const caption = node.attrs?.latex ?? node.attrs?.label;
    if (typeof caption === 'string') { parts.push(' ', caption, ' '); return; }
    for (const child of node.content ?? []) collect(child);
    parts.push('\n');
  };
  collect(body);
  return parts.join('').replace(/\s+/gu, ' ').trim();
}

export function wikiHeadings(body: JSONContent) {
  const headings: { id: string; label: string }[] = [];
  walkWikiDocument(body, node => {
    const id = node.attrs?.blockId;
    if (node.type === 'heading' && typeof id === 'string') {
      const label = wikiText(node).trim();
      if (label) headings.push({ id, label: textPreview(label, 80) });
    }
  });
  return headings;
}

export function citedReferences(body: JSONContent) {
  const references = new Set<string>(), sources = new Set<string>();
  walkWikiDocument(body, node => {
    if (node.type === 'sourceCite' && typeof node.attrs?.refId === 'string') {
      references.add(node.attrs.refId);
      if (typeof node.attrs.sourceId === 'string') sources.add(node.attrs.sourceId);
    }
  });
  return { references, sources };
}

export function referenceBacklinks(records: readonly WikiRecord[]) {
  const index = new Map<string, string[]>();
  for (const { page } of records) {
    for (const refId of citedReferences(page.body).references) {
      const pages = index.get(refId);
      if (pages) pages.push(page.id);
      else index.set(refId, [page.id]);
    }
  }
  return index;
}

export function sourceCitation(item: ReferenceItem): SourceCitation {
  const title = textPreview(item.sourceTitle || item.title, 62);
  return {
    refId: item.id, sourceId: item.sourceId,
    label: title + (item.locator?.page ? ' · p. ' + item.locator.page : ''),
    locator: item.locator ?? {},
  };
}
