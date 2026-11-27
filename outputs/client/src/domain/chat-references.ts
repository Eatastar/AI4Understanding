import type { Annotation, AnnotationReference, ChatMessage, Conversation, SubAnnotation } from './types';
import { subAnnotationLabel, subAnnotationPath } from './sub-annotation-tree';
import { ANNOTATION_REFERENCE_HEADER, TEXT_REFERENCE_HEADER } from '../../shared/reading-context.mjs';

export const MAX_CHAT_REFERENCES = 10;
export function canReferenceAnnotation(annotation: Annotation): boolean {
  return annotation.deletedAt === undefined && (annotation.mode === 'note' ? annotation.status === 'noted' && Boolean(annotation.note?.trim()) : annotation.status === 'answered');
}
export function canReferenceSubAnnotation(child: SubAnnotation): boolean {
  return child.note !== undefined ? Boolean(child.note.trim()) : Boolean(child.question.trim() && child.answer.trim());
}

interface AnnotationChoice {
  id: string;
  annotation: Annotation;
  child?: SubAnnotation;
}

export function annotationReferenceChoices(annotations: readonly Annotation[]): AnnotationChoice[] {
  const choices: AnnotationChoice[] = [];
  for (const annotation of annotations) {
    if (!canReferenceAnnotation(annotation)) continue;
    choices.push({ id: annotation.id, annotation });
    for (const child of annotation.subAnnotations ?? []) {
      if (canReferenceSubAnnotation(child)) choices.push({ id: child.id, annotation, child });
    }
  }
  return choices;
}

export interface AnnotationReferenceBranch extends AnnotationChoice {
  children: AnnotationReferenceBranch[];
}

export function annotationReferenceBranches(choices: readonly AnnotationChoice[]): AnnotationReferenceBranch[] {
  const nodes = new Map<string, AnnotationReferenceBranch>(choices.map(choice => [choice.id, { ...choice, children: [] }]));
  const roots: AnnotationReferenceBranch[] = [];
  for (const node of nodes.values()) {
    if (!node.child) { roots.push(node); continue; }
    const parent = nodes.get(node.child.parentSubId ?? node.annotation.id);
    const owner = nodes.get(node.annotation.id);
    (parent?.annotation.id === node.annotation.id ? parent : owner)?.children.push(node);
  }
  return roots;
}

export function searchAnnotationReferenceBranches(roots: AnnotationReferenceBranch[], query: string): AnnotationReferenceBranch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return roots;
  // Visit children before their parents so matches retain the path to the source.
  const nodes = roots.slice();
  for (let i = 0; i < nodes.length; i++) nodes.push(...nodes[i].children);
  const found = new Map<string, AnnotationReferenceBranch>();
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    const { annotation, child } = node;
    const searchable = [annotation.quote, annotation.question, annotation.note, child?.quotedText, child?.question, child?.note];
    const children = node.children.flatMap(branch => found.get(branch.id) ?? []);
    if (children.length || searchable.some(text => text?.toLowerCase().includes(needle))) {
      found.set(node.id, { ...node, children });
    }
  }
  return roots.flatMap(root => found.get(root.id) ?? []);
}

export function annotationSourceLabel(conversation: Conversation, annotation: Annotation): string {
  for (const document of conversation.documents || []) {
    const page = document.pages.find(item => item.messageId === annotation.messageId && item.versionId === annotation.versionId);
    if (page) return `${document.name} · ${document.kind === 'epub' || document.kind === 'mobi' || document.kind === 'azw3' ? 'ch.' : 'p.'} ${page.pageNumber}`;
  }
  return 'AI 回答';
}
export function captureAnnotationReferences(conversation: Conversation, annotationIds: readonly string[]): AnnotationReference[] {
  const ids = [...new Set(annotationIds)];
  if (ids.length > MAX_CHAT_REFERENCES) throw new Error('每次最多引用 10 条批注。');
  if (!ids.length) return [];
  const choices = annotationReferenceChoices(conversation.annotations);
  return ids.map(id => {
    const choice = choices.find(item => item.id === id);
    if (!choice) throw new Error('引用的批注已删除或尚未保存，请重新选择。');
    const { annotation, child } = choice;
    const followUps = child?.followUps?.filter(turn => turn.answer).map(({ question, answer }) => ({ question, answer }));
    return {
      annotationId: annotation.id, label: annotationSourceLabel(conversation, annotation), quote: annotation.quote,
      mode: annotation.mode === 'note' ? 'note' : 'ask', question: child ? '' : annotation.question, answer: child ? '' : annotation.answer,
      ...(annotation.mode === 'note' ? { note: annotation.note! } : {}),
      ...(child ? { subAnnotation: {
        id: child.id, quotedText: child.quotedText, question: child.question, answer: child.answer,
        ...(child.note !== undefined ? { note: child.note } : {}),
        path: subAnnotationPath(annotation.subAnnotations ?? [], child.id).map(node => subAnnotationLabel(node.quotedText)),
        ...(followUps?.length ? { followUps } : {}),
      } } : {}),
    };
  });
}

export function annotationReferenceText(reference: AnnotationReference): string {
  if (reference.mode === 'note') return `笔记：\n${reference.note || ''}`;
  const parent = `批注问题：\n${reference.question}\n批注回答：\n${reference.answer}`;
  const child = reference.subAnnotation;
  if (!child) return parent;
  const content = child.note !== undefined ? `子批注笔记（读者自己的理解）：\n${child.note}`
    : `子批注问题：\n${child.question}\n子批注回答：\n${child.answer}`;
  return [
    child.path?.length ? `子批注路径：${child.path.join(' → ')}` : parent,
    `子批注选段：\n${child.quotedText}\n${content}`,
    ...(child.followUps?.map((turn, index) => `第 ${index + 1} 轮续问：\n${turn.question}\n回答：\n${turn.answer}`) ?? []),
  ].join('\n\n');
}

export function chatQuestionContent(message: ChatMessage, question: string): string {
  if (!message.annotationReferences?.length && !message.textReference) return question;
  const references = (message.annotationReferences || []).map((reference, index) => `引用批注 ${index + 1}（${reference.label}）：\n原文选段：\n${reference.quote}\n${annotationReferenceText(reference)}`).join('\n\n');
  const quote = message.textReference ? `用户选中的引用文字（${message.textReference.label}）：\n${message.textReference.text}` : '';
  const header = message.textReference ? TEXT_REFERENCE_HEADER : ANNOTATION_REFERENCE_HEADER;
  const content = `${header}\n\n${[quote, references].filter(Boolean).join('\n\n')}\n\n用户本次聊天问题：\n${question}`;
  if (content.length > 2_000_000) throw new Error('引用的批注内容过长，请减少选择后再发送。');
  return content;
}
/** A round starts at a user question and includes its following assistant messages. */
export function chatRound(messages: readonly ChatMessage[], messageId: string): ChatMessage[] {
  const index = messages.findIndex(message => message.id === messageId);
  if (index < 0) throw new Error('这轮对话已不存在。');
  let start = index;
  while (start > 0 && messages[start].role !== 'user') start--;
  let end = start + 1;
  while (end < messages.length && messages[end].role !== 'user') end++;
  return messages.slice(start, end);
}
