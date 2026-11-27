import type { Annotation } from './types';
export const isParentAnswerGenerating = (annotation: Annotation) => annotation.status === 'generating' || annotation.reask?.status === 'generating';
export const isAnnotationGenerating = (annotation: Annotation) => isParentAnswerGenerating(annotation) || Boolean(annotation.subAnnotations?.some(child => child.request?.status === 'generating'));
