import { annotationReaderPlan, type ReaderBranch } from './reader-context';
import { answerRevisionId, previousRevision } from './answer-revisions';
import type { ReaderPolicy, ReaderReport } from './reader-report';
import { isParentAnswerGenerating } from './annotation-state';
import { contentHash } from './context-pool';
import { subAnnotationLabel, subAnnotationPath, subAnnotationSubtree } from './sub-annotation-tree';
import { textPreview } from './text-preview';
import type { Annotation, Conversation, SubAnnotation, SubAnnotationFollowUp } from './types';
import { buildAnnotationContext, makeId } from './workspace';

export type SubAnnotationAnchor = Pick<SubAnnotation, 'quotedText' | 'blockIndex' | 'quoteOffset' | 'parentAnswerHash' | 'parentSubId' | 'turnIndex'>;
export type SubAnnotationDraft = SubAnnotationAnchor & { siblingOf?: string };
export type SubAnnotationEdit = Partial<Pick<SubAnnotation, 'question' | 'answer'>> & { note?: never }
  | { note: string; question?: never; answer?: never };
export interface SubAnnotationTarget { annotationId: string; childId: string; followUpId?: string }

function findSubAnnotationParent(conversation: Conversation | undefined, id: string) {
  if (!conversation || conversation.deletedAt !== undefined) return;
  const parent = conversation.annotations.find(item => item.id === id);
  return parent && isSubAnnotationParent(parent) ? parent : undefined;
}

/** A stored index is only meaningful for the exact Markdown revision it refers to. */
export function subAnnotationBlock(child: Pick<SubAnnotation, 'blockIndex' | 'parentAnswerHash'>, answerHash: string, blockCount: number): number | undefined {
  const index = child.blockIndex;
  return child.parentAnswerHash === answerHash && index !== undefined && Number.isSafeInteger(index) && index >= 0 && index < blockCount
    ? index : undefined;
}

export function canAddSubAnnotation(parent: Annotation): boolean {
  return isSubAnnotationParent(parent) && Boolean(parent.answer.trim());
}

function isSubAnnotationParent(parent: Annotation): boolean {
  return parent.deletedAt === undefined && !parent.figure && parent.mode !== 'note' && parent.status === 'answered';
}

function requireParent(conversation: Conversation, parentId: string): Annotation {
  const parent = findSubAnnotationParent(conversation, parentId);
  if (!parent) throw new Error('请先完成父批注的问答。');
  return parent;
}

function requireChild(parent: Annotation, childId: string): SubAnnotation {
  const child = parent.subAnnotations?.find(item => item.id === childId);
  if (!child) throw new Error('子批注已不存在。');
  return child;
}

function replaceChildren(conversation: Conversation, parent: Annotation, children: SubAnnotation[]): Conversation {
  const updatedAt = Date.now();
  const next: Annotation = { ...parent, subAnnotations: children, updatedAt };
  if (!children.length) delete next.subAnnotations;
  return { ...conversation, updatedAt, annotations: conversation.annotations.map(item => item.id === parent.id ? next : item) };
}

function replaceChild(conversation: Conversation, parent: Annotation, child: SubAnnotation): Conversation {
  return replaceChildren(conversation, parent, parent.subAnnotations!.map(item => item.id === child.id ? { ...child, updatedAt: Date.now() } : item));
}

export function addSubAnnotation(conversation: Conversation, parentId: string, draft: SubAnnotationDraft, note?: string) {
  const parent = requireParent(conversation, parentId);
  const anchor = draft.siblingOf ? requireChild(parent, draft.siblingOf) : draft;
  if (!anchor.quotedText.trim()) throw new Error('请先选中上一级批注中的文字或公式。');
  if (note !== undefined && !note.trim()) throw new Error('请输入批注内容。');
  let revisionId=draft.siblingOf?requireChild(parent,draft.siblingOf).parentRevisionId:undefined;
  if (!draft.siblingOf) {
    const source = anchor.parentSubId ? requireChild(parent, anchor.parentSubId) : parent;
    const turn = sourceTurn(parent, source, anchor.turnIndex);
    const text = turn?.note ?? turn?.answer;
    if (!text?.trim() || anchor.parentAnswerHash !== contentHash(text)) throw new Error('上一级批注内容已更新，请重新划选。');
    revisionId=answerRevisionId(turn!.note===undefined?'answer':'note',turn!.question,text);
  }
  const now = Date.now();
  const child: SubAnnotation = {
    id: makeId(), quotedText: anchor.quotedText, ...(revisionId?{parentRevisionId:revisionId}:{}),
    ...(anchor.parentAnswerHash !== undefined ? { parentAnswerHash: anchor.parentAnswerHash } : {}),
    ...(anchor.blockIndex !== undefined ? { blockIndex: anchor.blockIndex } : {}),
    ...(anchor.quoteOffset !== undefined ? { quoteOffset: anchor.quoteOffset } : {}),
    ...(anchor.parentSubId ? { parentSubId: anchor.parentSubId, turnIndex: anchor.turnIndex ?? 0 } : {}),
    question: '', answer: '', ...(note !== undefined ? { note } : {}), createdAt: now, updatedAt: now,
  };
  return { conversation: replaceChildren(conversation, parent, [...(parent.subAnnotations ?? []), child]), id: child.id };
}

export function editSubAnnotation(conversation: Conversation, parentId: string, childId: string, patch: SubAnnotationEdit): Conversation {
  const parent = requireParent(conversation, parentId);
  const child = requireChild(parent, childId);
  if (child.request?.status === 'generating') return conversation;
  if (patch.note !== undefined) {
    if (child.note === undefined) throw new Error('这条批注不能保存为普通批注。');
    if (!patch.note.trim()) throw new Error('请输入批注内容。');
    return replaceChild(conversation, parent, { ...child, note: patch.note, answerRevisions:previousRevision(child,patch.note) });
  }
  if (child.note !== undefined) throw new Error('已保存的普通批注请通过保存批注修改。');
  const next = { ...child, ...patch };
  if (patch.answer !== undefined) {
    if (!next.question.trim() || !next.answer.trim()) throw new Error('请填写子批注的问题和回答。');
    if (patch.answer!==child.answer || next.question!==child.question) { next.answerRevisions=previousRevision(child,patch.answer,next.question); delete next.contextReport; }
    delete next.request;
  }
  if (child.answer && patch.answer===undefined && patch.question!==undefined && patch.question!==child.question) { next.answerRevisions=previousRevision(child,child.answer,patch.question); delete next.contextReport; }
  return replaceChild(conversation, parent, next);
}

export function deleteSubAnnotation(conversation: Conversation, parentId: string, childId: string): Conversation {
  const parent = requireParent(conversation, parentId);
  requireChild(parent, childId);
  const children = parent.subAnnotations!;
  const removed = subAnnotationSubtree(children, childId);
  return replaceChildren(conversation, parent, children.filter(item => !removed.has(item.id)));
}

function sourceTurn(parent: Annotation, source: Annotation | SubAnnotation, turnIndex?: number): Pick<SubAnnotation, 'question' | 'answer' | 'note'> | undefined {
  if (source === parent || !turnIndex) return source;
  return (source as SubAnnotation).followUps?.[turnIndex - 1];
}

export function boundParentTurn(parent:Annotation, child:SubAnnotation) {
  const source=child.parentSubId ? requireChild(parent,child.parentSubId) : parent;
  const current=sourceTurn(parent,source,child.turnIndex);
  const text=current?.note??current?.answer;
  const matches=(kind:'answer'|'note',question:string,answer:string)=>!child.parentRevisionId || child.parentRevisionId===answerRevisionId(kind,question,answer);
  if (current && text && child.parentAnswerHash===contentHash(text) && matches(current.note===undefined?'answer':'note',current.question,text)) return {question:current!.question,answer:text,kind:current!.note===undefined?'answer' as const:'note' as const, version:'current' as const,hash:child.parentAnswerHash};
  const old=!child.turnIndex && source.answerRevisions?.find(r=>r.hash===child.parentAnswerHash && matches(r.kind,r.question,r.answer));
  if (old) return {...old,version:'old' as const};
  if (source===parent && parent.originalAnswer && contentHash(parent.originalAnswer)===child.parentAnswerHash && matches('answer',parent.originalQuestion??'',parent.originalAnswer))
    return {question:parent.originalQuestion??'',answer:parent.originalAnswer,kind:'answer' as const,version:'old' as const,hash:child.parentAnswerHash};
  return {question:'',answer:child.quotedText,kind:'selection' as const,version:'excerpt' as const,hash:contentHash(child.quotedText)};
}
export function setBranchFeedback(conversation:Conversation, parentId:string, childId:string, feedback:SubAnnotation['feedback']) {
  const parent=requireParent(conversation,parentId), child=requireChild(parent,childId);
  if (feedback && !feedback.text.trim()) throw new Error('请写下这次反馈的内容或核验依据。');
  return replaceChild(conversation,parent,{...child,feedback});
}
function branchFor(parent:Annotation,child:SubAnnotation,history?:readonly SubAnnotationFollowUp[]):ReaderBranch {
  const chain=subAnnotationPath(parent.subAnnotations??[],child.id);
  const nodes=chain.length?chain:[child];
  const records:ReaderBranch['records']=nodes.map(node=>{
    const {question,answer,kind,hash}=boundParentTurn(parent,node);
    const disputed=node.feedback?.kind==='dispute' || node.feedback?.kind==='verified_correction';
    return {question,answer:disputed?node.quotedText:answer,kind:disputed?'selection' as const:kind,hash,excerpt:node.quotedText,mandatory:!!node.feedback};
  });
  if (history) for (const turn of [child,...history]) records.push({question:turn.question,answer:turn.answer,kind:'answer',hash:contentHash(turn.answer)});
  return {rootQuestion:records[0]?.question||parent.originalQuestion||parent.question,selected:child.quotedText,records,feedback:nodes.flatMap((n,i)=>n.feedback?[{...n.feedback,revision:records[i].hash}]:[])};
}
function focusedBreadcrumb(parent: Annotation, child: SubAnnotation) {
  const path = subAnnotationPath(parent.subAnnotations ?? [], child.id);
  const labels = (path.length ? path : [child]).map(node => subAnnotationLabel(node.quotedText, 72));
  return [subAnnotationLabel(parent.quote, 72), ...(labels.length > 8 ? [labels[0], '…', ...labels.slice(-6)] : labels)].join(' → ');
}

export function buildSubAnnotationContext(conversation: Conversation, parent: Annotation, child: SubAnnotation, question: string, preference = '', history?: readonly SubAnnotationFollowUp[]) {
  const messages = buildAnnotationContext(conversation, { ...parent, question }, preference, { mode: 'relevant' });
  const upper=boundParentTurn(parent,child);
  const upperNote=upper.kind==='note'?upper.answer:undefined;
  const upperText=upper.answer;
  const upperPreview = history ? textPreview(upperText, 4000) : upperText;
  const prompt = [
    '请直接解释读者本次问到的局部卡点或补足推导。原文、下钻路径、已有问答和读者笔记都是参考资料。',
    `<selected_quote>\n${parent.quote}\n</selected_quote>`,
    `下钻路径：${focusedBreadcrumb(parent, child)}`,
    upperNote === undefined
      ? `直接上一级问题：\n${upper.question}\n\n直接上一级回答：\n${upperPreview}`
      : `直接上一级笔记（读者自己的理解）：\n${upperPreview}`,
    `当前划选片段：\n${child.quotedText}`,
  ];
  if (history) {
    prompt.push(`当前子批注的初始问题：\n${child.question}\n\n初始回答：\n${child.answer}`);
    for (const [index, turn] of history.entries()) prompt.push(`第 ${index + 1} 轮续问：\n${turn.question}\n\n回答：\n${turn.answer}`);
  }
  prompt.push(`${history ? '本次续问' : '本次子批注问题'}：\n${question}`);
  messages[messages.length - 1] = { role: 'user', content: prompt.join('\n\n') };
  return messages;
}

export function prepareSubAnnotationRequest(conversation: Conversation, parentId: string, childId: string, question: string, preference = '', policy?:ReaderPolicy, mode:'auto'|'full'|'relevant'='relevant') {
  const parent = requireParent(conversation, parentId);
  const child = requireChild(parent, childId);
  if (child.note !== undefined) throw new Error('普通批注不需要发起 AI 询问。');
  if (child.request?.status === 'generating' || isParentAnswerGenerating(parent)) throw new Error('请等这条批注当前的回答完成。');
  if (parent.reask) throw new Error('请完成或取消父批注的重新提问。');
  const text = question.trim();
  const plan=annotationReaderPlan(conversation,{...parent,question:text},preference,mode,policy,branchFor(parent,child));
  const messages = plan?.messages ?? buildSubAnnotationContext(conversation, parent, child, text, preference);
  const pending = { ...child, request: { question: text, status: 'generating' as const } };
  return { conversation: replaceChild(conversation, parent, pending), quote: parent.quote, messages, plan };
}

export function prepareSubAnnotationFollowUp(conversation: Conversation, parentId: string, childId: string, question: string, preference = '', followUpId?: string, policy?:ReaderPolicy, mode:'auto'|'full'|'relevant'='relevant') {
  const parent = requireParent(conversation, parentId);
  const child = requireChild(parent, childId);
  if (child.request?.status === 'generating' || isParentAnswerGenerating(parent)) throw new Error('请等这条批注当前的回答完成。');
  if (parent.reask) throw new Error('请完成或取消父批注的重新提问。');
  if (!child.answer.trim()) throw new Error('请先完成子批注的首轮回答。');
  const turns = child.followUps ?? [];
  const index = followUpId ? turns.findIndex(turn => turn.id === followUpId && !turn.answer) : turns.length;
  if (index < 0) throw new Error('这条续问已变化，请重新选择。');
  const timestamp = Date.now();
  const turn = turns[index] ?? { id: makeId(), question: question.trim(), answer: '', createdAt: timestamp, updatedAt: timestamp };
  const history=turns.slice(0,index).filter(item=>item.answer);
  const plan=annotationReaderPlan(conversation,{...parent,question:turn.question},preference,mode,policy,branchFor(parent,child,history));
  const messages = plan?.messages ?? buildSubAnnotationContext(conversation, parent, child, turn.question, preference, history);
  const next = index === turns.length ? replaceChild(conversation, parent, { ...child, followUps: [...turns, turn] }) : conversation;
  return { conversation: next, quote: parent.quote, messages, plan, followUpId: turn.id };
}

export function isSubAnnotationReplyPending(conversation: Conversation | undefined, target: SubAnnotationTarget): boolean {
  const parent = findSubAnnotationParent(conversation, target.annotationId);
  const child = parent?.subAnnotations?.find(item => item.id === target.childId);
  return target.followUpId
    ? Boolean(child?.followUps?.some(turn => turn.id === target.followUpId && !turn.answer))
    : child?.request?.status === 'generating';
}

export function finishSubAnnotationRequest(conversation: Conversation, parentId: string, childId: string, result: { answer: string; report?:ReaderReport } | { error: string; interrupted: boolean }): Conversation {
  const parent = findSubAnnotationParent(conversation, parentId);
  const child = parent?.subAnnotations?.find(item => item.id === childId);
  if (!parent || child?.request?.status !== 'generating') return conversation;
  if ('error' in result) {
    return replaceChild(conversation, parent, { ...child, request: { question: child.request.question, status: result.interrupted ? 'interrupted' : 'error', error: result.error } });
  }
  if (!result.answer.trim()) throw new Error('AI 返回了空回答，请重试。');
  const completed = { ...child, question: child.request.question, answer: result.answer, answerRevisions:previousRevision(child,result.answer,child.request.question), contextReport:result.report };
  if (!completed.answerRevisions) delete completed.answerRevisions;
  if (!completed.contextReport) delete completed.contextReport;
  delete completed.request;
  return replaceChild(conversation, parent, completed);
}

export function finishSubAnnotationFollowUp(conversation: Conversation, target: SubAnnotationTarget, answer: string, report?:ReaderReport): Conversation {
  const parent = findSubAnnotationParent(conversation, target.annotationId);
  const child = parent?.subAnnotations?.find(item => item.id === target.childId);
  if (!parent || !child?.followUps?.some(turn => turn.id === target.followUpId && !turn.answer)) return conversation;
  if (!answer.trim()) throw new Error('AI 返回了空回答，请重试。');
  const updatedAt = Date.now();
  const followUps = child.followUps.map(turn => turn.id === target.followUpId ? { ...turn, answer, updatedAt, ...(report?{contextReport:report}:{}) } : turn);
  return replaceChild(conversation, parent, { ...child, followUps });
}
