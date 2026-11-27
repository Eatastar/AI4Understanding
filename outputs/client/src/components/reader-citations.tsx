import { createContext, useContext, type ReactNode } from 'react';
import type { Annotation } from '../domain/types';
import type { ReaderReport } from '../domain/reader-report';
import { AnnotationActions } from './AnnotationActions';

export const ReaderCitations=createContext<{ids:readonly string[];open:(id:string)=>void}|null>(null);
export function AnswerCitations({annotation,report,children}:{annotation:Annotation;report?:ReaderReport;children:ReactNode}) {
  const action=useContext(AnnotationActions)?.openSource;
  return <ReaderCitations.Provider value={report && action ? {ids:report.cited,open:id=>action(annotation,report,id)}:null}>{children}</ReaderCitations.Provider>;
}
