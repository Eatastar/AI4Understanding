import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import { previewWikiFormula } from '../knowledge/wiki-formula';

const parser = unified().use(remarkParse).use(remarkMath);
type Node = ReturnType<typeof parser.parse>['children'][number];
export interface SourceFormula { start: number; end: number; html: string }

/** Only replace explicit math. All surrounding source characters retain their original offsets. */
export function sourceFormulas(text: string): SourceFormula[] {
  if (!/\$|\\(?:[([]|begin\{)/u.test(text)) return [];
  const formulas: SourceFormula[] = [];
  const add = (start: number, end: number, tex: string, display: boolean) => {
    if (!tex.trim()) return;
    const preview = previewWikiFormula(tex, display);
    if ('html' in preview) formulas.push({ start, end, html: preview.html });
  };
  let cursor = 0;
  // Scan only gaps outside Markdown code, HTML, links and dollar math.
  function latex(until: number) {
    let opening: { offset: number; close: string; environment?: string; depth: number } | undefined;
    for (const match of text.slice(cursor, until).matchAll(/(\\+)([()[\]]|(?:begin|end)\{([a-zA-Z]+\*?)\})/gu)) {
      if (match[1].length % 2 === 0) continue;
      const offset = cursor + match.index + match[1].length - 1, token = match[2];
      if (!opening) {
        if (token === '(' || token === '[') opening = { offset, close: token === '(' ? ')' : ']', depth: 1 };
        else if (token.startsWith('begin{')) opening = { offset, close: 'end{' + match[3] + '}', environment: token, depth: 1 };
      } else if (token === opening.environment) {
        opening.depth++;
      } else if (token === opening.close && --opening.depth === 0) {
        const end = offset + 1 + token.length;
        const body = opening.environment ? text.slice(opening.offset, end) : text.slice(opening.offset + 2, offset);
        add(opening.offset, end, body, token !== ')');
        opening = undefined;
      }
    }
  }
  function visit(node: Node) {
    const math = node.type === 'math' || node.type === 'inlineMath';
    if (!math && node.type !== 'code' && node.type !== 'inlineCode' && node.type !== 'html' && node.type !== 'link' && node.type !== 'image') {
      if ('children' in node) node.children.forEach(visit);
      return;
    }
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    latex(start);
    cursor = end;
    if (!math) return;
    const literal = text.slice(start, end), display = literal.startsWith('$$');
    if (node.type === 'math' && !/\n[ \t>]*\${2,}[ \t]*$/u.test(literal)) return;
    if (!display && /^\$\d/u.test(literal) && /^\d/u.test(text.slice(end, end + 1))) return;
    add(start, end, node.value, display);
  }
  parser.parse(text).children.forEach(visit);
  latex(text.length);
  return formulas;
}
