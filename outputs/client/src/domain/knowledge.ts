import type { Annotation, Conversation, DocumentAttachment, InputMessage } from './types';
import { activeVersion } from './workspace';
import { canReferenceSubAnnotation, chatRound } from './chat-references';
import { WORKSPACE_LIMITS } from './capacity';
import type { LocalDocumentReference } from './local-library';

export interface KnowledgeSource {
  docId: string;
  docTitle: string;
  page?: number;
  quote?: string;
  fingerprint?: { size: number; sha256: string };
}

export interface KnowledgeCard {
  id: string;
  title: string;
  content: string;
  tags: string[];
  projectId?: string | null;
  source?: KnowledgeSource;
  origin: { type: 'qa' | 'quote' | 'synthesis'; chatId?: string };
  createdAt: number;
  updatedAt: number;
}

export type KnowledgeDraft = Omit<KnowledgeCard, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };
export interface KnowledgeLibrary { cards: KnowledgeCard[]; recovered: boolean }
export interface KnowledgeImport extends KnowledgeLibrary { added: number; skipped: number }
type ReadingLocation = { documentId: string; pageNumber: number };
type Fingerprint = (document: DocumentAttachment) => Promise<string | null>;

export async function exportKnowledgeCards(cards: readonly KnowledgeCard[], references: readonly LocalDocumentReference[], fingerprint: Fingerprint) {
  const documents = new Map(references.map(ref => [ref.document.id, ref.document]));
  const exported: KnowledgeCard[] = [];
  for (const card of cards) {
    const source = card.source;
    const document = source && !source.fingerprint ? documents.get(source.docId) : undefined;
    const sha256 = document ? await fingerprint(document) : null;
    exported.push(source && document && sha256 ? { ...card, source: { ...source, fingerprint: { size: document.size, sha256 } } } : card);
  }
  return exported;
}

export async function findKnowledgeDocument(source: KnowledgeSource, references: readonly LocalDocumentReference[], fingerprint: Fingerprint) {
  const exact = references.find(ref => ref.document.id === source.docId);
  if (exact || !source.fingerprint) return exact;
  const { size, sha256 } = source.fingerprint;
  for (const ref of references) {
    if (ref.document.size === size && await fingerprint(ref.document) === sha256) return ref;
  }
}

function knowledgeSource(document: DocumentAttachment, page?: number, quote?: string): KnowledgeSource {
  return {
    docId: document.id,
    docTitle: document.name,
    ...(document.kind === 'pdf' && page !== undefined ? { page } : {}),
    ...(quote?.trim() ? { quote: quote.trim() } : {}),
  };
}

function selectionSource(conversation: Conversation, messageId: string, versionId: string, quote: string) {
  for (const document of conversation.documents || []) {
    const page = document.pages.find(item => item.messageId === messageId && item.versionId === versionId);
    if (page) return knowledgeSource(document, page.pageNumber, quote);
  }
}

function draft(question: string, answer: string, conversation: Conversation, source?: KnowledgeSource): KnowledgeDraft {
  const firstLine = (question.trim() || answer.trim()).split('\n', 1)[0].slice(0, 240);
  return {
    title: Array.from(firstLine).slice(0, 120).join('').trim(),
    content: answer,
    tags: [],
    ...(source ? { source } : {}),
    origin: { type: 'qa', ...(conversation.isProject ? {} : { chatId: conversation.id }) },
  };
}

export function knowledgeFromAnswer(conversation: Conversation, messageId: string, versionId: string, location?: ReadingLocation) {
  const answer = conversation.messages.find(message => message.id === messageId && message.role === 'assistant')
    ?.versions.find(version => version.id === versionId && version.status === 'complete');
  if (!answer?.content.trim()) return;
  const question = chatRound(conversation.messages, messageId).find(message => message.role === 'user');
  const textRef = question?.textReference;
  const quoted = textRef && selectionSource(conversation, textRef.messageId, textRef.versionId, textRef.text);
  const content = question ? activeVersion(question).content : '';
  if (quoted) return draft(content, answer.content, conversation, quoted);

  const notes = (question?.annotationReferences || []).flatMap(reference => {
    const annotation = conversation.annotations.find(item => item.id === reference.annotationId && item.deletedAt === undefined);
    const source = annotation && selectionSource(conversation, annotation.messageId, annotation.versionId, reference.quote);
    return source ? [source] : [];
  });
  if (notes.length) {
    const [first] = notes;
    const samePage = notes.every(note => note.docId === first.docId && note.page === first.page);
    if (samePage) {
      const { quote, ...source } = first;
      return draft(content, answer.content, conversation, notes.length === 1 ? first : source);
    }
    return draft(content, answer.content, conversation);
  }

  const documents = (conversation.documents || []).filter(document => !conversation.projectId || question?.documentReference?.ids.includes(document.id));
  const [file] = documents;
  const page = file && location?.documentId === file.id && file.pages.some(item => item.pageNumber === location.pageNumber) ? location.pageNumber : undefined;
  return draft(content, answer.content, conversation, documents.length === 1 ? knowledgeSource(file, page) : undefined);
}

export function knowledgeFromAnnotation(conversation: Conversation, annotation: Annotation, childId?: string) {
  if (annotation.deletedAt !== undefined || annotation.status !== 'answered') return;
  const source = selectionSource(conversation, annotation.messageId, annotation.versionId, annotation.quote);
  if (childId) {
    const child = annotation.subAnnotations?.find(item => item.id === childId);
    if (child && canReferenceSubAnnotation(child)) {
      if (child.note !== undefined) {
        const note = draft('', child.note, conversation, source);
        return { ...note, origin: { ...note.origin, type: 'quote' as const } };
      }
      const followUps = child.followUps?.filter(turn => turn.answer).map(turn => `**${turn.question}**\n\n${turn.answer}`) ?? [];
      return draft(child.question, [child.answer, ...followUps].join('\n\n'), conversation, source);
    }
  } else if (annotation.answer.trim()) return draft(annotation.question, annotation.answer, conversation, source);
}

export function searchKnowledgeCards(cards: readonly KnowledgeCard[], query: string, tag = '') {
  const needle = query.trim().toLowerCase();
  return cards.filter(card => (!tag || card.tags.includes(tag)) && (!needle
    || [card.title, card.content, ...card.tags].some(value => value.toLowerCase().includes(needle))))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function projectKnowledge(cards: readonly KnowledgeCard[], project: Conversation, records: readonly Conversation[]) {
  const threads = records.filter(item => item.projectId === project.id);
  const chats = new Set(threads.map(item => item.id));
  const documents = new Set([project, ...threads].flatMap(item => (item.documents || []).map(file => file.id)));
  return cards.filter(card => card.projectId === undefined
    ? Boolean(card.origin.chatId && chats.has(card.origin.chatId) || card.source && documents.has(card.source.docId))
    : card.projectId === project.id).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function addKnowledgeContext(messages: InputMessage[], cards: readonly KnowledgeCard[]): InputMessage[] {
  if (!cards.length) return messages;
  const background = '以下知识卡片是用户为本轮主动选择的参考资料。请结合用户的实际问题作答。\n\n' +
    JSON.stringify(cards.map(card => ({ title: card.title, content: card.content, ...(card.source ? { source: card.source.docTitle } : {}) })));
  if (background.length > WORKSPACE_LIMITS.text) throw new Error('引用的知识卡片内容过长，请减少选择后再发送。');
  return [...messages.slice(0, -1), { role: 'user', content: background }, ...messages.slice(-1)];
}
