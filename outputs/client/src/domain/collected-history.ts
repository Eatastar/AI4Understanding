import type { Annotation, CollectedTurn, Workspace } from './types';
import { chatTurns, readChatTurns } from './chat-turns';
import { findConversation, projectChats } from './projects';

export interface CollectionChoice {
  id: string;
  conversationId: string;
  sourceTitle: string;
  createdAt: number;
  preview: string;
  related: boolean;
  fromAnnotation?: true;
}

export function collectionChoices(workspace: Workspace, projectId: string, annotation: Annotation): CollectionChoice[] {
  const owner = findConversation(workspace, annotation.conversationId);
  if (!owner || (owner.isProject ? owner.id !== projectId : owner.projectId !== projectId)) return [];
  const choices: CollectionChoice[] = [];
  if (annotation.mode !== 'note' && annotation.status === 'answered') {
    choices.push({ id: annotation.id, conversationId: owner.id, sourceTitle: owner.title, createdAt: annotation.createdAt, preview: annotation.question, related: true, fromAnnotation: true });
  }
  for (const conversation of projectChats(workspace, projectId)) {
    const messages = new Map(conversation.messages.map(message => [message.id, message]));
    for (const turn of chatTurns(conversation.messages)) {
      const message = messages.get(turn.id);
      const version = message?.versions.find(item => item.id === message.activeVersionId);
      if (message?.role !== 'user' || !version) continue;
      const related = Boolean(message.annotationReferences?.some(ref => ref.annotationId === annotation.id)
        || (message.useCollectedHistory && conversation.collectedHistory?.annotationId === annotation.id));
      choices.push({ id: turn.id, conversationId: conversation.id, sourceTitle: conversation.title, createdAt: version.createdAt, preview: turn.preview, related });
    }
  }
  return choices.sort((a, b) => a.createdAt - b.createdAt);
}

export function collectHistory(workspace: Workspace, projectId: string, annotation: Annotation, ids: readonly string[]): CollectedTurn[] {
  const selected = new Set(ids);
  const choices = collectionChoices(workspace, projectId, annotation).filter(choice => selected.has(choice.id));
  if (!choices.length || choices.length !== selected.size) throw new Error('所选对话已变化，请重新选择。');
  const turns = new Map(projectChats(workspace, projectId).flatMap(chat => readChatTurns(chat, selected)).map(turn => [turn.id, turn]));
  return choices.map(choice => {
    const content = choice.fromAnnotation ? { question: annotation.question, answers: [annotation.answer] } : turns.get(choice.id)!;
    return { conversationId: choice.conversationId, ...(choice.fromAnnotation ? {} : { turnId: choice.id }), sourceTitle: choice.sourceTitle, createdAt: choice.createdAt, question: content.question, answers: content.answers };
  });
}

