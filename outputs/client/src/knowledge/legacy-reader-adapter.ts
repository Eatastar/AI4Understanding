import { canReferenceAnnotation, canReferenceSubAnnotation } from '../domain/chat-references';
import { researchLink, type ResearchSource } from '../domain/inquiry';
import type { KnowledgeCard } from '../domain/knowledge';
import type { Annotation, Conversation, DocumentAttachment, DocumentPage, Workspace } from '../domain/types';
import { referenceBacklinks } from './wiki-document';
import type { ReferenceItem, ReferenceLocator, WikiRecord } from './wiki-types';

type LegacyDocument = { owner: Conversation; file: DocumentAttachment; page: DocumentPage };
const pageKey = (messageId: string, versionId: string) => messageId + '\0' + versionId;
const refId = (...parts: (string | number)[]) => JSON.stringify(parts);

function documentLocator(entry: LegacyDocument): ReferenceLocator {
  return { documentId: entry.file.id, conversationId: entry.owner.id, page: entry.page.pageNumber };
}

function annotationLocator(owner: Conversation, annotation: Annotation, entry?: LegacyDocument): ReferenceLocator {
  const figure = annotation.figure;
  return {
    ...(entry ? documentLocator(entry)
      : figure ? { documentId: figure.documentId, page: figure.pageNumber, conversationId: owner.id }
        : { conversationId: owner.id, messageId: annotation.messageId, versionId: annotation.versionId }),
    annotationId: annotation.id, quote: annotation.quote,
    ...(figure ? { bbox: [figure.rect.x, figure.rect.y, figure.rect.width, figure.rect.height] } : {}),
  };
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
