import type { JSONContent } from '@tiptap/core';

export interface WikiPage {
  id: string;
  title: string;
  domains: string[];
  body: JSONContent;
  personalUnderstanding?: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export const wikiRelations = ['related', 'depends_on', 'explains', 'extends'] as const;
export type WikiRelation = typeof wikiRelations[number];
export interface WikiLink {
  id: string;
  fromPageId: string;
  fromBlockId?: string;
  toPageId: string;
  toBlockId?: string;
  relation: WikiRelation;
  source: 'user' | 'ai_proposed';
  status: 'accepted' | 'proposed' | 'rejected';
}

export const referenceKinds = ['pdf_excerpt', 'annotation', 'ai_inquiry', 'web_summary'] as const;
export type ReferenceKind = typeof referenceKinds[number];
export interface ReferenceLocator {
  documentId?: string;
  conversationId?: string;
  messageId?: string;
  versionId?: string;
  annotationId?: string;
  subAnnotationId?: string;
  page?: number;
  bbox?: [number, number, number, number];
  start?: number;
  quote?: string;
  url?: string;
}

export interface ReferenceItem {
  id: string;
  kind: ReferenceKind;
  title: string;
  content: string;
  sourceId: string;
  sourceTitle: string;
  locator?: ReferenceLocator;
  linkedPageIds: string[];
  createdAt: number;
}

export interface SourceCitation {
  refId: string;
  label: string;
  sourceId: string;
  locator: ReferenceLocator;
}

export interface WikiRecord { page: WikiPage; links: WikiLink[] }
export type WikiDraft = Pick<WikiPage, 'title' | 'domains' | 'body' | 'personalUnderstanding'>;
export type WikiRevision = Pick<WikiPage, 'revision' | 'updatedAt'>;
export interface WikiRevisionKey { id: string; revision: number }
export interface WikiSaveRequest { id?: string; expectedRevision: number; draft: WikiDraft }

export interface WikiRepository {
  exportHistory: () => Promise<WikiPage[]>;
  importHistory: (pages: WikiPage[], cards?: string) => Promise<number>;
  list: () => Promise<WikiRecord[]>;
  save: (request: WikiSaveRequest) => Promise<WikiRecord>;
  history: (id: string) => Promise<WikiRevision[]>;
  revision: (key: WikiRevisionKey) => Promise<WikiPage>;
  restore: (request: WikiRevisionKey & { expectedRevision: number }) => Promise<WikiRecord>;
}
