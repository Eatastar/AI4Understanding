import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { defaultRehypePlugins, Streamdown, type Components } from 'streamdown';
import { createMathPlugin } from '@streamdown/math';
import { normalizeMathDelimiters } from '../adapters/markdown';
import { ReaderCitations } from './reader-citations';

const plugins = { math: createMathPlugin({ singleDollarTextMath: true }) };

interface MarkdownElement {
  type: string;
  value?:string;
  tagName?: string;
  properties?: Record<string, number>;
  children?: MarkdownElement[];
}

interface MarkdownSlots {
  afterBlock(index: number, count: number): ReactNode;
  afterAnswer(count: number): ReactNode;
}

const slotsContext = createContext<MarkdownSlots | undefined>(undefined);
const blockTag = 'annotation-answer-block';
const endTag = 'annotation-answer-end';

/** Keep stable top-level block boundaries for locating selectable passages and
 * placing the controls for saved sub-annotations. */
function wrapAnnotationBlocks() {
  return (tree: { children: MarkdownElement[] }) => {
    const count = tree.children.filter(node => node.type === 'element').length;
    let index = 0;
    tree.children = tree.children.map(node => node.type === 'element'
      ? { type: 'element', tagName: blockTag, properties: { index: index++, count }, children: [node] }
      : node);
    tree.children.push({ type: 'element', tagName: endTag, properties: { count }, children: [] });
  };
}

const annotationRehypePlugins = [...Object.values(defaultRehypePlugins), wrapAnnotationBlocks];
const citationTag='reader-source-ref';
function markCitations() {
  const process=(node:MarkdownElement)=>{
    if (!node.children || ['pre','a','button','code','math','svg'].includes(node.tagName??'') || (node.properties && 'className' in node.properties && String(node.properties.className).includes('katex'))) return;
    node.children=node.children.flatMap(child=>{
      if (child.type!=='text' || !child.value) {process(child);return [child];}
      return child.value.split(/(\[R[1-9]\d*\.[1-9]\d*\])/gu).filter(Boolean).map(value=> /^\[R[1-9]\d*\.[1-9]\d*\]$/u.test(value)
        ? {type:'element',tagName:citationTag,properties:{},children:[{type:'text',value}]} : {type:'text',value});
    });
  };
  return process;
}
const citationPlugins=[...Object.values(defaultRehypePlugins),markCitations];
const annotatedCitationPlugins=[...citationPlugins,wrapAnnotationBlocks];
const citationComponents:Components={
  [citationTag]:function SourceLink({children}) {
    const context=useContext(ReaderCitations), label=String(children), id=label.slice(1,-1);
    return context?.ids.includes(id)?<button type="button" className="reader-inline-source" data-reader-inline={id} onClick={()=>context.open(id)}>{label}</button>:<>{children as ReactNode}</>;
  }
};
const annotationComponents: Components = {
  [blockTag]: function AnnotationAnswerBlock({ node, children }) {
    const slots = useContext(slotsContext);
    const index = Number(node?.properties.index), count = Number(node?.properties.count);
    return <><div className="parent-answer-block" data-parent-answer-block={index}>{children as ReactNode}</div>{slots?.afterBlock(index, count)}</>;
  },
  [endTag]: function AnnotationAnswerEnd({ node }) {
    return useContext(slotsContext)?.afterAnswer(Number(node?.properties.count)) ?? null;
  },
};

/** Shared presentation for replies, with optional block slots for a parent annotation. */
const referenceHiddenElements = ['img', 'picture', 'iframe', 'video', 'audio', 'source'] as const;

export function MathMarkdown({ children, streaming = false, slots, referencePreview = false }: {
  children: string; streaming?: boolean; slots?: MarkdownSlots; referencePreview?: boolean;
}) {
  const markdown = useMemo(() => normalizeMathDelimiters(children), [children]);
  const citations=useContext(ReaderCitations);
  const content = <Streamdown className="annotation-markdown" plugins={plugins} mode={streaming ? 'streaming' : 'static'} isAnimating={streaming} tableMaxHeight="none" controls={false}
    components={citations ? (slots ? {...annotationComponents,...citationComponents} : citationComponents) : slots ? annotationComponents : undefined}
    rehypePlugins={citations ? (slots ? annotatedCitationPlugins : citationPlugins) : slots ? annotationRehypePlugins : undefined}
    disallowedElements={referencePreview ? referenceHiddenElements : undefined} skipHtml={referencePreview || undefined}>{markdown}</Streamdown>;
  if (!slots) return content;
  return markdown.trim() ? <slotsContext.Provider value={slots}>{content}</slotsContext.Provider> : slots.afterAnswer(0);
}
