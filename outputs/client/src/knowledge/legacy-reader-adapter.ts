import { canReferenceAnnotation, canReferenceSubAnnotation } from '../domain/chat-references';
import { researchLink, type ResearchSource } from '../domain/inquiry';
import type { KnowledgeCard } from '../domain/knowledge';
import type { Annotation, Conversation, DocumentAttachment, DocumentPage, Workspace } from '../domain/types';
import { referenceBacklinks } from './wiki-document';
import type { ReferenceItem, ReferenceLocator, SourceCitation, WikiRecord } from './wiki-types';

type LegacyDocument = { owner: Conversation; file: DocumentAttachment; page: DocumentPage };
const pageKey = (messageId: string, versionId: string) => messageId + '\0' + versionId;
const refId = (...parts: (string | number)[]) => JSON.stringify(parts);

function documentLocator(entry: LegacyDocument): ReferenceLocator {
  return { documentId: entry.file.id, conversationId: entry.owner.id, page: entry.page.pageNumber, messageId: entry.page.messageId, versionId: entry.page.versionId };
}

function annotationLocator(owner: Conversation, annotation: Annotation, entry?: LegacyDocument): ReferenceLocator {
  const figure = annotation.figure;
  const offset = (annotation.anchor as { sourceStart?: number } | null)?.sourceStart;
  return {
    ...(entry ? documentLocator(entry)
      : figure ? { documentId: figure.documentId, page: figure.pageNumber, conversationId: owner.id }
        : { conversationId: owner.id, messageId: annotation.messageId, versionId: annotation.versionId }),
    annotationId: annotation.id, quote: annotation.quote,
    ...(entry && typeof offset === 'number' ? { start: offset } : {}),
    ...(figure ? { bbox: [figure.rect.x, figure.rect.y, figure.rect.width, figure.rect.height] } : {}),
  };
}

export function hasWikiSource(workspace: Workspace, cards: readonly KnowledgeCard[], { locator, refId: id }: SourceCitation): boolean {
  if (locator.url) return !!researchLink(locator.url);
  if (!locator.conversationId && !locator.documentId) return cards.some(card => refId('card', card.id) === id);
  return workspace.conversations.some(owner => {
    if (owner.deletedAt !== undefined || (locator.conversationId && locator.conversationId !== owner.id)) return false;
    if (locator.annotationId) {
      const note = owner.annotations.find(item => item.id === locator.annotationId && item.deletedAt === undefined);
      if (!note || (locator.subAnnotationId && !note.subAnnotations?.some(child => child.id === locator.subAnnotationId))) return false;
    }
    if (locator.documentId) {
      const file = owner.documents?.find(item => item.id === locator.documentId);
      return !!file && (!locator.page || file.pages.some(page =>
        page.pageNumber === locator.page && (!locator.versionId || page.versionId === locator.versionId)));
    }
    return !locator.messageId || owner.messages.some(message => message.id === locator.messageId &&
      (!locator.versionId || message.versions.some(version => version.id === locator.versionId)));
  });
}

/** Carry only the material explicitly chosen by the reader. */
export function selectedWikiMaterial(owner: Conversation, messageId: string, versionId: string,
  selection?: { quote:string; start?:number }, annotation?: Annotation, childId?: string): ReferenceItem | undefined {
  const file = owner.documents?.find(doc => doc.pages.some(p => p.messageId === messageId && p.versionId === versionId));
  const page = file?.pages.find(p => p.messageId === messageId && p.versionId === versionId);
  const entry = file && page ? {owner, file, page} : undefined;
  const messageIndex = owner.messages.findIndex(m => m.id === messageId);
  const answer = owner.messages[messageIndex]?.versions.find(v => v.id === versionId);
  const child = childId ? annotation?.subAnnotations?.find(c => c.id === childId) : undefined;
  const latest = child?.followUps?.at(-1);
  const content = selection?.quote ?? latest?.answer ?? child?.note ?? child?.answer ?? annotation?.note ?? annotation?.answer ?? answer?.content;
  if (!content?.trim() || (childId && !child)) return;
  const locator: ReferenceLocator = annotation ? annotationLocator(owner,annotation,entry) : entry ? documentLocator(entry) : {conversationId:owner.id,messageId,versionId};
  if (child) locator.subAnnotationId = child.id;
  if (selection) Object.assign(locator,selection);
  const id = selection ? refId('selection', owner.id,messageId,versionId,selection.start ?? -1,content.slice(0,64))
    : latest && child ? refId('follow-up',child.id,latest.id) : child ? refId('child',child.id)
    : annotation ? refId('annotation',annotation.id) : refId('reply',owner.id,messageId,versionId);
  const question = owner.messages[messageIndex-1]?.versions[0]?.content;
  return { id, kind:selection && file?'pdf_excerpt':annotation?'annotation':'ai_inquiry',
    title:(selection?.quote ?? latest?.question ?? child?.question ?? annotation?.question ?? question ?? content).slice(0,180) || owner.title,
    content, sourceId:file?.id ?? owner.id, sourceTitle:file?.name ?? owner.title, locator, linkedPageIds:[], createdAt:annotation?.createdAt ?? answer?.createdAt ?? file?.createdAt ?? owner.createdAt };
}

/** Indexes the loaded reader snapshot. Source strings remain in the reader’s records. */
export function legacyReaderReferences(workspace: Workspace, cards: readonly KnowledgeCard[], wiki: readonly WikiRecord[]): ReferenceItem[] {
  const backlinks = referenceBacklinks(wiki);
  const result: ReferenceItem[] = [];
  const add = (item: Omit<ReferenceItem, 'linkedPageIds'>) => {
    if (item.content) result.push({ ...item, linkedPageIds: backlinks.get(item.id) ?? [] });
  };
  const conversations = workspace.conversations.filter(owner => owner.deletedAt === undefined);
  const pageIndex = new Map<string, LegacyDocument>();
  for (const owner of conversations) {
    for (const file of owner.documents ?? []) {
      for (const page of file.pages) {
        const entry = { owner, file, page };
        pageIndex.set(pageKey(page.messageId, page.versionId), entry);
        add({
          id: refId('page', file.id, page.pageNumber), kind: 'pdf_excerpt', title: page.title || file.name,
          content: page.text, sourceId: file.id, sourceTitle: file.name,
          locator: documentLocator(entry), createdAt: file.createdAt,
        });
      }
    }
  }
  for (const owner of conversations) {
    const web = (source: ResearchSource, createdAt: number, scope: string) => {
      const url = researchLink(source.webUrl);
      if (!url || !source.excerpt) return;
      add({
        id: refId('web', owner.id, scope, source.id), kind: 'web_summary',
        title: source.title, content: source.excerpt, sourceId: source.id,
        sourceTitle: source.title, locator: { url }, createdAt,
      });
    };
    for (const source of owner.inquiry?.sources ?? []) web(source, owner.createdAt, 'project');
    let question = '';
    for (const message of owner.messages) {
      if (message.role === 'user') {
        question = message.versions.find(version => version.id === message.activeVersionId)?.content ?? '';
        continue;
      }
      for (const version of message.versions) {
        if (version.status !== 'complete') continue;
        const locator = { conversationId: owner.id, messageId: message.id, versionId: version.id };
        add({
          id: refId('reply', owner.id, message.id, version.id), kind: 'ai_inquiry',
          title: question || owner.title, content: version.content, sourceId: owner.id,
          sourceTitle: owner.title, locator, createdAt: version.createdAt,
        });
        if (version.research?.kind === 'papers') for (const source of version.research.sources) web(source, version.createdAt, version.id);
      }
    }
    for (const annotation of owner.annotations) {
      if (!canReferenceAnnotation(annotation)) continue;
      const entry = pageIndex.get(pageKey(annotation.messageId, annotation.versionId));
      const locator = annotationLocator(owner, annotation, entry);
      const sourceId = locator.documentId ?? owner.id;
      const sourceTitle = entry?.file.name ?? owner.title;
      const source = { sourceId, sourceTitle };
      if (locator.documentId && annotation.quote.trim() && !annotation.figure) {
        add({ ...source, id: refId('excerpt', annotation.id), kind: 'pdf_excerpt', title: annotation.quote, content: annotation.quote, locator, createdAt: annotation.createdAt });
      }
      add({
        ...source, id: refId('annotation', annotation.id), kind: 'annotation',
        title: annotation.question || annotation.quote, content: annotation.note ?? annotation.answer, locator, createdAt: annotation.createdAt,
      });
      for (const summary of annotation.summaries ?? []) add({
        ...source, id: refId('annotation-summary', summary.id), kind: 'annotation',
        title: annotation.question || annotation.quote, content: summary.content, locator, createdAt: summary.createdAt,
      });
      for (const child of annotation.subAnnotations ?? []) {
        if (!canReferenceSubAnnotation(child)) continue;
        const childLocator = { ...locator, subAnnotationId: child.id };
        add({
          ...source, id: refId('child', child.id), kind: child.note === undefined ? 'ai_inquiry' : 'annotation',
          title: child.question || child.quotedText, content: child.note ?? child.answer, locator: childLocator, createdAt: child.createdAt,
        });
        for (const turn of child.followUps ?? []) add({
          ...source, id: refId('follow-up', child.id, turn.id), kind: 'ai_inquiry',
          title: turn.question, content: turn.answer, locator: childLocator, createdAt: turn.createdAt,
        });
      }
    }
  }
  for (const card of cards) {
    const source = card.source;
    add({
      id: refId('card', card.id), kind: 'annotation', title: card.title, content: card.content,
      sourceId: source?.docId ?? card.origin.chatId ?? card.id, sourceTitle: source?.docTitle ?? card.title, createdAt: card.createdAt,
      ...(source ? { locator: { documentId: source.docId, page: source.page, quote: source.quote } }
        : card.origin.chatId ? { locator: { conversationId: card.origin.chatId } } : {}),
    });
  }
  return result.sort((a, b) => b.createdAt - a.createdAt);
}
