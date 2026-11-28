import { t } from '../i18n/locale';
import { useContext, useState } from 'react';
import './reader-sources.css';
import type { Annotation, DocumentAttachment, SubAnnotation } from '../domain/types';
import type { ReaderReport, SourceUse } from '../domain/reader-report';
import { boundParentTurn } from '../domain/sub-annotations';
import { readerIndex, type SourceBlock } from '../domain/reader-evidence';
import type { ExcerptMark } from '../adapters/pdf-excerpt';
import { SourceExcerpt } from './SourceExcerpt';
import { AnnotationActions } from './AnnotationActions';
import { NativeSelect } from './NativeSelect';
import { MathMarkdown } from './MathMarkdown';
import { AnswerCitations } from './reader-citations';

const labels:Record<SourceUse,string>={focus:'选区',condition:'前置条件',proof:'证明原文',nearby:'邻段',expanded:'扩大核查范围'};
const number=(value?:number)=>value===undefined?t('未知'):value.toLocaleString();
const imageNote={sent:'已附选区原图',budget:'图片超出当前阅读预算，本次仅提供文字。',unsupported:'当前连接仅接收文字，公式排版请对照原页。',unavailable:'未能读取选区原图，本次仅提供文字。'};
export function ReaderSources({annotation,report}:{annotation:Annotation;report?:ReaderReport}) {
  const actions=useContext(AnnotationActions);
  const [open,setOpen]=useState(false);
  const [page,setPage]=useState(0);
  if (!report) return null;
  const doc=open?actions?.sourceDocument?.(annotation,report):undefined;
  const index=doc?readerIndex(doc):undefined;
  const unit=doc && doc.kind!=='pdf'?'章节':'页';
  const current=index?.version===report.documentVersion ? index:undefined;
  const keys=[...new Set([...report.cited,...report.sources.map(s=>s.id)])];
  const u=report.usage;
  const notRead=u?.inputTokens!==undefined && u.cacheReadTokens!==undefined && u.inputTokens>=u.cacheReadTokens?u.inputTokens-u.cacheReadTokens:undefined;
  const ordinary=u?.inputTokens!==undefined && u.cacheReadTokens!==undefined && u.cacheWriteTokens!==undefined && u.inputTokens>=u.cacheReadTokens+u.cacheWriteTokens?u.inputTokens-u.cacheReadTokens-u.cacheWriteTokens:undefined;
  const source=(id:string)=>{
    const b=current?.byId.get(id);
    const source=report.sources.find(s=>s.id===id), role=source?.use, step=source?.step;
    const range: ExcerptMark | undefined=b && step && step.start>=b.start && step.end<=b.end && step.start<step.end ? [step.start-b.start,step.end-b.start] : undefined;
    return <li key={id}><button type="button" className="annotation-text-button" data-reader-source={id} disabled={!b} onClick={()=>actions?.openSource?.(annotation,report,id)}>
      {id} · {unit} {b?.page??id.slice(1).split('.')[0]}{b && !b.label.startsWith('¶')?' · '+b.label:''}{role?' · '+t(labels[role]):''}</button>
      {b && doc && <SourceDisclosure document={doc} block={b} mark={range}/>}</li>;
  };
  return <details className="reader-sources" onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary>{t('原文出处')} · {report.baseline==='full'?t('全文'):report.sources.length+' '+t('处原文')}{report.selectionImage==='sent'?' · '+t(imageNote.sent):''}</summary>
    {open && <>
      {report.selectionImage && report.selectionImage!=='sent' && <p>{t(imageNote[report.selectionImage])}</p>}
      {!current && <p>{t('原文版本已变化或不可访问。')}</p>}
      <p>{t('回答引用')}</p>{report.cited.length?<ul>{report.cited.map(source)}</ul>:<small>{t('回答没有标出可核对的来源 ID。')}</small>}
      <p>{t('本次提供')}{report.baseline==='full'?' · '+t('全部提取文字'):''}</p>
      <ul>{keys.filter(id=>!report.cited.includes(id)).map(source)}</ul>
      {report.baseline==='full' && current && doc && <FullSourcePicker document={doc} page={page} onPage={setPage} source={source}/>}
      {report.missing.map((m,i)=><p key={i}>{t(m)}</p>)}
      {report.dropped>0 && <p>{t('预算内省略 {0} 个辅助片段或较早的回答全文。',[report.dropped])}</p>}
      {import.meta.env.DEV && <><p>{report.model} · {t('预计输入')} {number(report.estimatedInput)} / {number(report.inputCap)} tokens</p>
      <p>{t('实报输入')} {number(u?.inputTokens)} · {t('未从缓存读取')} {number(notRead)} · {t('普通输入')} {number(ordinary)} · {t('缓存读')} {number(u?.cacheReadTokens)} · {t('缓存写')} {number(u?.cacheWriteTokens)} · {t('输出')} {number(u?.outputTokens)}</p>
      <p>{t('按回执估价')} {report.costUSD===undefined?t('未知'):'$'+report.costUSD.toFixed(6)}{report.maxEstimateUSD!==undefined?' · '+t('发送前保守估价')+' $'+report.maxEstimateUSD.toFixed(6):''}</p>
      {report.priced && <small>OpenAI 标准文本价 · 2026-11-27</small>}</>}
    </>}
  </details>;
}
function SourceDisclosure({ document, block, mark }: { document: DocumentAttachment; block: SourceBlock; mark?: ExcerptMark }) {
  const [open, setOpen] = useState(false);
  const page = open ? document.pages.find(p => p.pageNumber === block.page && p.versionId === block.versionId) : undefined;
  return <details onToggle={e => setOpen(e.currentTarget.open)}><summary>{t('查看原文')}</summary>
    {open && <div className="reader-source-excerpt"><SourceExcerpt document={document} page={page} start={block.start} text={block.text} mark={mark}/></div>}
  </details>;
}
function FullSourcePicker({document,page,onPage,source}:{document:DocumentAttachment;page:number;onPage:(n:number)=>void;source:(id:string)=>React.ReactNode}) {
  const index=readerIndex(document);
  return <details><summary>{t('浏览全文原文')}</summary><NativeSelect aria-label="来源页" value={page} onChange={e=>onPage(Number(e.target.value))}>{document.pages.map((p,i)=><option key={p.messageId} value={i}>{p.title??'第 '+p.pageNumber+' 页'}</option>)}</NativeSelect><ul>{(index.pages.get(document.pages[page]?.pageNumber)??[]).map(b=>source(b.id))}</ul></details>;
}
export function AnswerHistory({annotation}:{annotation:Annotation}) {
  const [show,setShow]=useState(false);
  if (!annotation.answerRevisions?.length) return null;
  return <details className="reader-sources" onToggle={event=>setShow(event.currentTarget.open)}><summary>{t('历史回答')} · {annotation.answerRevisions.length}</summary>
    {show && annotation.answerRevisions.map((r,i)=><details key={i}><summary>{r.question||t('旧版回答')}</summary>
      <AnswerCitations annotation={annotation} report={r.contextReport}><MathMarkdown>{r.answer}</MathMarkdown></AnswerCitations>
      <ReaderSources annotation={annotation} report={r.contextReport}/>
    </details>)}
  </details>;
}
export function BranchSource({annotation,child}:{annotation:Annotation;child:SubAnnotation}) {
  const actions=useContext(AnnotationActions);
  const parent=boundParentTurn(annotation,child);
  const [text,setText]=useState(child.feedback?.text??'');
  return <>
    {parent.version!=='current' && <details className="reader-sources"><summary>{t(parent.version==='old'?'划选时的旧版回答':'历史选区 · 仅可恢复已保存的摘录')}</summary><MathMarkdown>{parent.answer}</MathMarkdown></details>}
    {actions?.feedback && <details className="reader-sources"><summary>{t('纠正这段回答')}</summary>
      <textarea aria-label={t("纠正这段回答")} value={text} onChange={e=>setText(e.target.value)} placeholder={t("用自己的话指出哪里需要改正")}/>
      <button type="button" className="annotation-text-button" disabled={!text.trim()} onClick={()=>actions.feedback?.(annotation,child.id,{kind:'dispute',text:text.trim()})}>{t('保存反馈')}</button>
      {child.feedback && <button type="button" className="annotation-text-button" onClick={()=>{actions.feedback?.(annotation,child.id,undefined);setText('');}}>{t('移除反馈')}</button>}
    </details>}
  </>;
}
