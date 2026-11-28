import { createContext, useContext } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import UniqueID from '@tiptap/extension-unique-id';
import { FileText, ArrowUpRight } from 'lucide-react';
import { textPreview } from '../domain/text-preview';
import { t } from '../i18n/locale';
import { wikiText } from './wiki-document';
import { wikiMathOptions } from './wiki-formula';
import type { SourceCitation, WikiRecord } from './wiki-types';

export const WIKI_REFERENCE_DRAG = 'application/x-ai4u-wiki-reference';
export type FormulaEdit = { kind: 'inline' | 'block'; latex: string; pos?: number };

interface WikiNavigation {
  records: ReadonlyMap<string, WikiRecord>;
  openEntry: (id: string, blockId?: string) => void;
  openCitation: (citation: SourceCitation) => void;
  hasSource: (citation: SourceCitation) => boolean;
}
export const WikiNavigation = createContext<WikiNavigation | null>(null);

function WikiLinkView({ node }: ReactNodeViewProps<HTMLElement>) {
  const navigation = useContext(WikiNavigation);
  const target = navigation?.records.get(node.attrs.pageId)?.page;
  const title = target?.title || node.attrs.label;
  const summary = target ? textPreview(wikiText(target.body), 160) : '';
  return <NodeViewWrapper as="span" className="wiki-inline-node" contentEditable={false}>
    <button type="button" className="wiki-entry-link" disabled={!target}
      onClick={() => navigation?.openEntry(node.attrs.pageId, node.attrs.toBlockId || undefined)} title={summary || title}>
      <span>{title}</span><ArrowUpRight size={12} aria-hidden="true" />
    </button>
  </NodeViewWrapper>;
}

function CitationView({ node }: ReactNodeViewProps<HTMLElement>) {
  const navigation = useContext(WikiNavigation);
  const citation = node.attrs as SourceCitation;
  const available = navigation?.hasSource(citation) ?? true;
  return <NodeViewWrapper as="span" className="wiki-inline-node" contentEditable={false}>
    <button type="button" className="wiki-source-cite" title={citation.label}
      aria-label={t('打开引用出处 {0}', [citation.label])} onClick={() => navigation?.openCitation(citation)}>
      <FileText size={12} aria-hidden="true" /><span>{citation.label}</span>{!available && <small>{t('来源暂不可用')}</small>}
    </button>
  </NodeViewWrapper>;
}

function identifier(name: string, fallback: string | null = null) {
  const attribute = 'data-wiki-' + name;
  return {
    default: fallback,
    parseHTML: (element: HTMLElement) => element.getAttribute(attribute) ?? fallback,
    renderHTML: (attrs: Record<string, string | null>) => attrs[name] ? { [attribute]: attrs[name] } : {},
  };
}

const WikiLinkNode = Node.create({
  name: 'wikiLink', group: 'inline', inline: true, atom: true,
  addAttributes() {
    return {
      pageId: identifier('pageId'), toBlockId: identifier('toBlockId'), relation: identifier('relation', 'related'),
      label: identifier('label', ''),
    };
  },
  parseHTML: () => [{ tag: 'span[data-wiki-link]' }],
  renderHTML: ({ node, HTMLAttributes }) => ['span', mergeAttributes({ 'data-wiki-link': '' }, HTMLAttributes), node.attrs.label],
  renderText: ({ node }) => node.attrs.label,
  addNodeView: () => ReactNodeViewRenderer(WikiLinkView),
});

const SourceCiteNode = Node.create({
  name: 'sourceCite', group: 'inline', inline: true, atom: true,
  addAttributes() {
    return {
      refId: identifier('refId'), sourceId: identifier('sourceId'), label: identifier('label', ''),
      locator: {
        default: {},
        parseHTML: (element: HTMLElement) => {
          try { return JSON.parse(element.getAttribute('data-wiki-locator') || '{}'); }
          catch { return {}; }
        },
        renderHTML: (attrs: { locator: SourceCitation['locator'] }) => ({ 'data-wiki-locator': JSON.stringify(attrs.locator || {}) }),
      },
    };
  },
  parseHTML: () => [{ tag: 'span[data-wiki-cite]' }],
  renderHTML: ({ node, HTMLAttributes }) => ['span', mergeAttributes({ 'data-wiki-cite': '' }, HTMLAttributes), '[' + node.attrs.label + ']'],
  renderText: ({ node }) => '[' + node.attrs.label + ']',
  addNodeView: () => ReactNodeViewRenderer(CitationView),
});

export function wikiEditorExtensions(onFormula: (change: FormulaEdit) => void) {
  return [
    StarterKit.configure({ link: false, underline: false }),
    UniqueID.configure({ attributeName: 'blockId', types: ['paragraph', 'heading', 'inlineMath', 'blockMath', 'wikiLink'] }),
    BlockMath.configure({
      katexOptions: { ...wikiMathOptions, throwOnError: false, displayMode: true },
      onClick: (node, pos) => onFormula({ kind: 'block', latex: node.attrs.latex, pos }),
    }),
    InlineMath.configure({
      katexOptions: { ...wikiMathOptions, throwOnError: false },
      onClick: (node, pos) => onFormula({ kind: 'inline', latex: node.attrs.latex, pos }),
    }),
    WikiLinkNode,
    SourceCiteNode,
  ];
}
