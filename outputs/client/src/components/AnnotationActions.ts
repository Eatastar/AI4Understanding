import { createContext } from 'react';
import type { Dispatch } from 'react';
import type { AnnotationWindowAction, ChildAnnotationWindow } from '../domain/companion-view';
import type { AnnotationAnchors } from './annotation-anchors';
import type { SubAnnotationStreams } from '../domain/sub-annotation-streams';
import type { SubAnnotationDraft, SubAnnotationEdit } from '../domain/sub-annotations';
import type { ReaderReport } from '../domain/reader-report';
import type { Annotation, DocumentAttachment, SubAnnotation } from '../domain/types';

export type SubAnnotationQuestion =
  | { childId: string; question: string; draft?: SubAnnotationDraft }
  | { childId: string; question: string; followUp: true; retryId?: string };

interface AnnotationActionsValue {
  sourceDocument?:(a:Annotation,r:ReaderReport)=>DocumentAttachment|undefined;
  openSource?:(a:Annotation,r:ReaderReport,id:string)=>void;
  feedback?:(a:Annotation,id:string,feedback:SubAnnotation['feedback'])=>void;
  lastOpenedSlot: (groupId: string) => string | undefined;
  addSlot: (annotation: Annotation) => void;
  editChild: (annotation: Annotation, id: string, patch: SubAnnotationEdit) => boolean;
  saveChildNote: (annotation: Annotation, id: string, draft: SubAnnotationDraft, note: string) => boolean;
  askChild: (annotation: Annotation, input: SubAnnotationQuestion) => boolean;
  deleteChild: (annotation: Annotation, id: string) => void;
  anchors: AnnotationAnchors;
  childWindows: ReadonlyMap<string, readonly ChildAnnotationWindow[]>;
  windowOrder: ReadonlyMap<string, number>;
  dispatchWindow: Dispatch<AnnotationWindowAction>;
  hoveredChild: { id: string; ownerId: string } | null;
  setHoveredChild: (id: string, ownerId: string, hovered: boolean) => void;
  streams: SubAnnotationStreams;
}

export const AnnotationActions = createContext<AnnotationActionsValue | null>(null);
