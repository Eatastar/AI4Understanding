import type { JSONContent } from '@tiptap/core';
import { Slice } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import type { EditorView } from '@tiptap/pm/view';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { normalizeMathDelimiters } from '../adapters/markdown';

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
type MarkdownNode = ReturnType<typeof parser.parse>['children'][number];
type Marks = NonNullable<JSONContent['marks']>;

const paragraph = (content: JSONContent[] = []): JSONContent => ({ type: 'paragraph', content });
const formula = (type: 'inlineMath' | 'blockMath', latex: string): JSONContent => ({ type, attrs: { latex } });
const text = (value: string, marks: Marks = []): JSONContent[] => value
  ? [{ type: 'text', text: value, ...(marks.length ? { marks } : {}) }] : [];

const closedDisplay = (source: string): boolean => /\n[\t >]*\${2,}[\t ]*$/u.test(source);

function protectedMathRanges(nodes: readonly MarkdownNode[], source: string) {
  const ranges: [number, number][] = [];
  function visit(node: MarkdownNode) {
    if (node.type === 'code' || node.type === 'inlineCode' || node.type === 'html'
      || node.type === 'math' || node.type === 'inlineMath') {
      const start = node.position?.start.offset, end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      if (node.type === 'math') {
        const literal = source.slice(start, end);
        if (!/^\${2,}[ \t]*\n/u.test(literal) || !closedDisplay(literal)) return;
      }
      ranges.push([start, end]);
    } else if ('children' in node) node.children.forEach(visit);
  }
  nodes.forEach(visit);
  return ranges;
}

/** Read Markdown into the same editable nodes used by the Wiki toolbar. */
export function wikiMarkdownContent(input: string, explicit = false): JSONContent | undefined {
  if (!input.trim() || input.length > 2_000_000) return undefined;
  let source = input.replace(/\r\n?/gu, '\n');
  let root = parser.parse(source);
  if (source.includes('\\(') || source.includes('\\[') || source.includes('$$')) {
    const normalized = normalizeMathDelimiters(source, { protectedRanges: protectedMathRanges(root.children, source) });
    if (normalized !== source) {
      source = normalized;
      root = parser.parse(source);
    }
  }
  const raw = (node: MarkdownNode) => source.slice(node.position?.start.offset, node.position?.end.offset);
  const definitions = new Map(root.children.filter(node => node.type === 'definition').map(node => [node.identifier, node.url]));
  let formatted = explicit;
  const rendered = (node: JSONContent): JSONContent[] => { formatted = true; return [node]; };
  const linkText = (label: JSONContent[], url: string | undefined, marks: Marks) => {
    if (!url || label.map(node => node.text || '').join('') === url) return label;
    formatted = true;
    return [...label, ...text(' (' + url + ')', marks)];
  };

  function phrasing(node: MarkdownNode, marks: Marks = []): JSONContent[] {
    switch (node.type) {
      case 'text': return text(node.value, marks);
      case 'break': return rendered({ type: 'hardBreak' });
      case 'inlineCode': return rendered({ type: 'text', text: node.value, marks: [{ type: 'code' }] });
      case 'inlineMath': {
        const literal = raw(node);
        const following = source[node.position?.end.offset ?? source.length] || '';
        // "$5 and $10" is a pair of prices rather than a formula.
        if (!node.value.trim() || /^\$\d/u.test(literal) && /^\d/u.test(following)) return text(literal, marks);
        return rendered(formula('inlineMath', node.value.trim()));
      }
      case 'strong':
      case 'emphasis':
      case 'delete': {
        formatted = true;
        const type = node.type === 'strong' ? 'bold' : node.type === 'emphasis' ? 'italic' : 'strike';
        const combined = marks.some(mark => mark.type === type) ? marks : [...marks, { type }];
        return node.children.flatMap(child => phrasing(child, combined));
      }
      case 'link': return linkText(node.children.flatMap(child => phrasing(child, marks)), node.url, marks);
      case 'linkReference': return linkText(node.children.flatMap(child => phrasing(child, marks)), definitions.get(node.identifier), marks);
      default: return text(raw(node), marks);
    }
  }

  function blocks(node: MarkdownNode): JSONContent[] {
    switch (node.type) {
      case 'paragraph': {
        // remark treats same-line $$…$$ as inline math even on its own line.
        // Split these displays out of the paragraph before inserting the slice.
        const content: JSONContent[] = [];
        let run: JSONContent[] = [];
        for (const child of node.children) {
          if (child.type === 'inlineMath' && raw(child).startsWith('$$') && child.value.trim()) {
            if (run.some(item => item.type !== 'text' || item.text?.trim())) content.push(paragraph(run));
            content.push(...rendered(formula('blockMath', child.value.trim())));
            run = [];
          } else run.push(...phrasing(child));
        }
        if (!content.length || run.some(item => item.type !== 'text' || item.text?.trim())) content.push(paragraph(run));
        return content;
      }
      case 'math':
        if (node.value.trim() && closedDisplay(raw(node))) return rendered(formula('blockMath', node.value.trim()));
        return [paragraph(text(raw(node)))]; // Leave a partially copied fence visible.
      case 'heading': return rendered({ type: 'heading', attrs: { level: node.depth }, content: node.children.flatMap(child => phrasing(child)) });
      case 'thematicBreak': return rendered({ type: 'horizontalRule' });
      case 'code': return rendered({ type: 'codeBlock', attrs: { language: node.lang?.slice(0, 80) || null }, content: text(node.value) });
      case 'blockquote': {
        const content = node.children.flatMap(blocks);
        return rendered({ type: 'blockquote', content: content.length ? content : [paragraph()] });
      }
      case 'list': return rendered({
        type: node.ordered ? 'orderedList' : 'bulletList',
        ...(node.ordered ? { attrs: { start: Math.max(1, node.start ?? 1) } } : {}),
        content: node.children.flatMap(blocks),
      });
      case 'listItem': {
        const content = node.children.flatMap(blocks);
        if (content[0]?.type !== 'paragraph') content.unshift(paragraph());
        if (typeof node.checked === 'boolean') content[0].content = [...text(node.checked ? '[x] ' : '[ ] '), ...(content[0].content ?? [])];
        return rendered({ type: 'listItem', content });
      }
      case 'table':
        formatted = true;
        return node.children.map((row, index) => paragraph(row.children.flatMap((cell, column) => [
          ...(column ? text(' | ') : []),
          ...cell.children.flatMap(child => phrasing(child, index === 0 ? [{ type: 'bold' }] : [])),
        ])));
      case 'definition': return [];
      default: return [paragraph(text(raw(node)))];
    }
  }
  const content = root.children.flatMap(blocks);
  return formatted && content.length ? { type: 'doc', content } : undefined;
}

/** Bring across explicit TeX from a selection copied from a rendered answer. */
export function restoreClipboardMath(html: string, document: Document): string {
  if (!html.includes('katex') || !html.includes('application/x-tex')) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const node of template.content.querySelectorAll('.katex')) {
    if (node.closest('code, pre, [data-type="inline-math"], [data-type="block-math"]')) continue;
    const latex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
    if (!latex) continue;
    const block = node.closest('.katex-display');
    const element = document.createElement(block ? 'div' : 'span');
    element.dataset.type = block ? 'block-math' : 'inline-math';
    element.dataset.latex = latex;
    (block ?? node).replaceWith(element);
  }
  return template.innerHTML;
}

export function pasteWikiMarkdown(view: EditorView, event: ClipboardEvent): boolean {
  const clipboard = event.clipboardData;
  if (!view.editable || !clipboard || view.state.selection.$from.parent.type.spec.code) return false;
  const markdown = clipboard.getData('text/markdown');
  if (!markdown && clipboard.getData('text/html')) return false;

  const { state } = view;
  let transaction;
  try {
    const content = wikiMarkdownContent(markdown || clipboard.getData('text/plain'), Boolean(markdown));
    if (!content) return false;
    const parsed = state.schema.nodeFromJSON(content);
    parsed.check();
    const start = parsed.firstChild?.type.name === 'paragraph' ? 1 : 0;
    const end = parsed.lastChild?.type.name === 'paragraph' ? 1 : 0;
    const slice = new Slice(parsed.content, start, end);
    transaction = closeHistory(state.tr.replaceSelection(slice)).setMeta('paste', true).setMeta('uiEvent', 'paste');
  } catch {
    return false; // Preserve native paste if the document cannot accept the conversion.
  }
  if (!transaction.docChanged) return false;
  view.dispatch(transaction.scrollIntoView());
  return true;
}
