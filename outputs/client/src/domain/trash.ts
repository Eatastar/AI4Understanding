import type { Workspace } from './types';

export type TrashTarget = { kind: 'project'; id: string } | { kind: 'conversation'; id: string } | { kind: 'annotation'; conversationId: string; id: string } | { kind: 'all' };

export function recycleBin(workspace: Workspace) {
  const deleted = workspace.conversations.filter(c => c.deletedAt !== undefined).sort((a, b) => b.deletedAt! - a.deletedAt!);
  const projects = deleted.filter(c => c.isProject);
  const projectIds = new Set(projects.map(c => c.id));
  const conversations = deleted.filter(c => !c.isProject && (!c.projectId || !projectIds.has(c.projectId)));
  const annotations = workspace.conversations.filter(c => c.deletedAt === undefined)
    .flatMap(conversation => conversation.annotations.filter(a => a.deletedAt !== undefined).map(annotation => ({ conversation, annotation })))
    .sort((a, b) => b.annotation.deletedAt! - a.annotation.deletedAt!);
  return { projects, conversations, annotations, count: projects.length + conversations.length + annotations.length };
}

/** Only trash entries can be permanently removed. Active records remain untouched. */
export function permanentlyDelete(workspace: Workspace, target: TrashTarget): Workspace {
  if (target.kind === 'project') {
    const project = workspace.conversations.find(c => c.id === target.id && c.isProject);
    if (!project || project.deletedAt === undefined) throw new Error('请先将项目移入回收站。');
    return { ...workspace, conversations: workspace.conversations.filter(c => c.id !== project.id && c.projectId !== project.id) };
  }
  if (target.kind === 'conversation') {
    const source = workspace.conversations.find(c => c.id === target.id);
    if (!source || source.isProject || source.deletedAt === undefined) throw new Error('请先将这条对话移入回收站。');
    if (source.projectId && workspace.conversations.some(c => c.id === source.projectId && c.deletedAt !== undefined)) {
      throw new Error('请先恢复这条对话所在的项目。');
    }
    return { ...workspace, conversations: workspace.conversations.filter(c => c.id !== source.id) };
  }
  if (target.kind === 'annotation') {
    const source = workspace.conversations.find(c => c.id === target.conversationId && c.deletedAt === undefined);
    const annotation = source?.annotations.find(a => a.id === target.id);
    if (!source || !annotation || annotation.deletedAt === undefined) throw new Error('请先将这条批注移入回收站；所属对话也需要处于正常状态。');
    return { ...workspace, conversations: workspace.conversations.map(c => c.id === source.id ? { ...c, annotations: c.annotations.filter(a => a.id !== target.id), updatedAt: Date.now() } : c) };
  }
  return { ...workspace, conversations: workspace.conversations.filter(c => c.deletedAt === undefined).map(c => {
    const annotations = c.annotations.filter(a => a.deletedAt === undefined);
    return annotations.length === c.annotations.length ? c : { ...c, annotations, updatedAt: Date.now() };
  }) };
}
