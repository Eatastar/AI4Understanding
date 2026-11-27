import type { AnswerRevision, ReaderReport } from './reader-report';
import type { FigureSelection, FigureStroke } from './figure';
import type { Inquiry, ReplyResearch } from './inquiry';
export type GenerationStatus = 'complete' | 'streaming' | 'error' | 'interrupted';
export type AnnotationStatus = 'draft' | 'generating' | 'answered' | 'error' | 'interrupted' | 'noted';

export interface InputMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface MessageVersion {
  id: string;
  content: string;
  status: GenerationStatus;
  createdAt: number;
  modelLabel?: string;
  error?: string;
  context?: InputMessage[];
  research?: ReplyResearch;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  versions: MessageVersion[];
  activeVersionId: string;
  inquiryIntro?: true;
  annotationReferences?: AnnotationReference[];
  textReference?: ChatTextReference;
  documentReference?: { ids: string[]; mode: 'auto' | 'full' | 'relevant' };
  researchSourceIds?: string[];
  useCollectedHistory?: true;
  contextReset?: true;
  sectionTitle?: string;
}

/** An explicit selection copied into one chat question, without creating a note. */
export interface ChatTextReference {
  conversationId: string;
  messageId: string;
  versionId: string;
  label: string;
  text: string;
}

/** A user-selected copy of an annotation, attached to one chat question. */
export interface AnnotationReference {
  annotationId: string;
  label: string;
  quote: string;
  mode: 'ask' | 'note';
  question: string;
  answer: string;
  note?: string;
  subAnnotation?: Pick<SubAnnotation, 'id' | 'quotedText' | 'question' | 'answer' | 'note'> & {
    path?: string[];
    followUps?: Pick<SubAnnotationFollowUp, 'question' | 'answer'>[];
  };
}

export interface Annotation {
  contextReport?: ReaderReport;
  answerRevisions?: AnswerRevision[];
  figure?: FigureSelection;
  modelLabel?: string;
  id: string;
  conversationId: string;
  messageId: string;
  versionId: string;
  quote: string;
  anchor: unknown;
  color: string;
  question: string;
  answer: string;
  mode?: 'ask' | 'note';
  note?: string;
  originalQuestion?: string;
  originalAnswer?: string;
  edited: boolean;
  status: AnnotationStatus;
  createdAt: number;
  updatedAt: number;
  context?: InputMessage[];
  requestPreference?: string;
  documentContextMode?: 'auto' | 'full' | 'relevant';
  error?: string;
  deletedAt?: number;
  reask?: AnnotationAttempt;
  summaries?: AnnotationSummary[];
  anchorGroupId?: string;
  slotIndex?: number;
  subAnnotations?: SubAnnotation[];
}

export interface SubAnnotation {
  contextReport?: ReaderReport;
  answerRevisions?: AnswerRevision[];
  feedback?: {kind: 'dispute' | 'intent_correction' | 'verified_correction' | 'preference'; text:string};
  id: string;
  quotedText: string;
  blockIndex?: number;
  /** UTF-16 offset in the rendered answer text, with each formula represented by its LaTeX. */
  quoteOffset?: number;
  parentAnswerHash?: string;
  /** Identifies the exact question and answer selected, even after an identical regeneration. */
  parentRevisionId?:string;
  question: string;
  answer: string;
  note?: string;
  collapsed?: boolean;
  createdAt: number;
  updatedAt: number;
  /** A replacement request leaves the last successful question and answer available. */
  request?: { question: string; status: 'generating' | 'error' | 'interrupted'; error?: string };
  parentSubId?: string;
  turnIndex?: number;
  followUps?: SubAnnotationFollowUp[];
}

export interface SubAnnotationFollowUp {
  contextReport?: ReaderReport;
  id: string;
  question: string;
  answer: string;
  createdAt: number;
  updatedAt: number;
}

export interface AnnotationSummary {
  id: string;
  content: string;
  createdAt: number;
  conversationId: string;
  turnIds: string[];
}

/** A pending replacement. The current successful exchange stays intact until commit. */
export interface AnnotationAttempt {
  figureStrokes?: FigureStroke[];
  question: string;
  answer: string;
  status: 'draft' | 'generating' | 'error' | 'interrupted';
  context?: InputMessage[];
  requestPreference?: string;
  documentContextMode?: 'auto' | 'full' | 'relevant';
  error?: string;
}

export interface DocumentPage {
  /** Stable chapter metadata for reflowable books; PDF page records stay unchanged. */
  title?: string;
  pageNumber: number;
  text: string;
  messageId: string;
  versionId: string;
}

export interface DocumentAttachment {
  id: string;
  name: string;
  kind: DocumentKind;
  mimeType: string;
  size: number;
  createdAt: number;
  pages: DocumentPage[];
}

export type DocumentKind = 'pdf' | 'text' | 'epub' | 'mobi' | 'azw3';
export const isEbookKind = (kind: DocumentKind) => kind === 'epub' || kind === 'mobi' || kind === 'azw3';

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  annotations: Annotation[];
  documents?: DocumentAttachment[];
  deletedAt?: number;
  /** This chat returns with its project. Individually deleted chats remain in the bin. */
  deletedWithProject?: true;
  /** A project record owns shared documents and their annotations. */
  isProject?: true;
  projectId?: string;
  inquiry?: Inquiry;
  /** Empty text means a new section has been opened without a title. */
  pendingSection?: string;
  customTitle?: true;
  collectedHistory?: { annotationId: string; turns: CollectedTurn[] };
}

export interface CollectedTurn {
  conversationId: string;
  turnId?: string;
  sourceTitle: string;
  createdAt: number;
  question: string;
  answers: string[];
}

export interface Workspace {
  schemaVersion: 1;
  conversations: Conversation[];
  activeConversationId: string;
}

export type ApiFormat = 'openai-chat' | 'openai-responses' | 'anthropic-messages';

export interface ModelProfile {
  imageInput?: 'auto' | 'supported' | 'unsupported';
  id: string;
  name: string;
  apiFormat: ApiFormat;
  baseURL: string;
  model: string;
  systemPrompt: string;
  hasApiKey: boolean;
  keySaved: boolean;
}

export interface ProfileInput {
  imageInput?: 'auto' | 'supported' | 'unsupported';
  id?: string;
  name: string;
  apiFormat: ApiFormat;
  baseURL: string;
  model: string;
  systemPrompt: string;
  apiKey?: string;
  clearApiKey?: boolean;
  activate?: boolean;
}

export interface ModelSettings {
  imageInput?: 'auto' | 'supported' | 'unsupported';
  mode: 'demo' | 'api';
  baseURL: string;
  model: string;
  systemPrompt: string;
  hasApiKey: boolean;
  apiFormat: ApiFormat;
  profiles: ModelProfile[];
  activeProfileId: string | null;
  persistence: 'encrypted' | 'configuration' | 'session';
  storageWarning?: string;
}
