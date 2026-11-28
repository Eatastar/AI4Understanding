import { desktop, type DesktopBridge } from './desktop';
import type { KnowledgeCard } from '../domain/knowledge';
import type { ReferenceLocator, WikiPage } from '../knowledge/wiki-types';
import { walkWikiDocument } from '../knowledge/wiki-document';

export interface KnowledgeBackup { wiki: WikiPage[]; cards: KnowledgeCard[] }

export async function snapshotKnowledge(bridge: DesktopBridge | undefined = desktop()): Promise<KnowledgeBackup | undefined> {
  if (!bridge?.wiki && !bridge?.knowledge) return undefined;
  const [wiki, library] = await Promise.all([bridge.wiki?.exportHistory(), bridge.knowledge?.list()]);
  return { wiki: wiki ?? [], cards: library?.cards ?? [] };
}

export async function restoreKnowledge(raw: unknown, remapped = new Map<string,string>()) {
  if (raw === undefined) return;
  const bridge = desktop();
  const archive = raw as KnowledgeBackup;
  if (!bridge?.wiki || !bridge.knowledge || !archive || !Array.isArray(archive.wiki) || !Array.isArray(archive.cards))
    throw new Error('请使用桌面版并选择完整的 Wiki 与知识卡片备份。');
  const mapped = (id: string) => remapped.get(id) ?? id;
  // The parsed archive belongs to this import. Preserve labels, block IDs and quotes.
  for (const page of archive.wiki) walkWikiDocument(page.body, node => {
    if (node.type !== 'sourceCite' || !node.attrs) return;
    const attrs = node.attrs;
    attrs.sourceId = mapped(attrs.sourceId);
    let parts: unknown;
    try { parts = JSON.parse(attrs.refId); } catch { /* Earlier references can use plain IDs. */ }
    if (Array.isArray(parts)) attrs.refId = JSON.stringify(parts.map((part, i) => i && typeof part === 'string' ? mapped(part) : part));
    const locator = attrs.locator as ReferenceLocator | undefined;
    if (locator) for (const key of ['documentId','conversationId','messageId','versionId','annotationId','subAnnotationId'] as const) {
      if (locator[key]) locator[key] = mapped(locator[key]!);
    }
  });
  for (const card of archive.cards) {
    if (card.source) card.source.docId = mapped(card.source.docId);
    if (card.origin?.chatId) card.origin.chatId = mapped(card.origin.chatId);
    if (card.projectId) card.projectId = mapped(card.projectId);
  }
  const cards = JSON.stringify(archive.cards);
  await bridge.wiki.importHistory(archive.wiki, cards);
  await bridge.knowledge.importCards(cards);
}
