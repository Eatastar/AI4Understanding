import type { Annotation, Conversation } from './types';

export const annotationGroupId = (annotation: Annotation) => annotation.anchorGroupId ?? annotation.id;

const slotIndex = (annotation: Annotation) => annotation.slotIndex ?? 1;

export function groupAnnotations(annotations: readonly Annotation[]): Map<string, Annotation[]> {
  const groups = new Map<string, Annotation[]>();
  for (const annotation of annotations) {
    if (annotation.deletedAt !== undefined) continue;
    const id = annotationGroupId(annotation);
    const slots = groups.get(id);
    if (slots) slots.push(annotation);
    else groups.set(id, [annotation]);
  }
  for (const slots of groups.values()) slots.sort((a, b) => slotIndex(a) - slotIndex(b) || a.createdAt - b.createdAt);
  return groups;
}

export function preferredAnnotationSlot(slots: readonly Annotation[], lastOpenedId?: string): Annotation {
  return slots.find(slot => slot.id === lastOpenedId) ?? slots[0];
}

export function adjacentAnnotationSlot(annotations: readonly Annotation[], removed: Annotation): Annotation | undefined {
  const slots = groupAnnotations(annotations).get(annotationGroupId(removed)) ?? [];
  const index = slots.findIndex(slot => slot.id === removed.id);
  return index < 0 ? undefined : slots[index + 1] ?? slots[index - 1];
}

function textAnchorKey(annotation: Annotation): string | undefined {
  const { anchor } = annotation;
  if (annotation.figure || !anchor || typeof anchor !== 'object' || !('selectors' in anchor) || !Array.isArray(anchor.selectors) || !anchor.selectors.length) return;
  // Offsets distinguish two occurrences of the same quote in one source.
  const selectors = anchor.selectors.map(selector => [selector?.start, selector?.end, selector?.quote]);
  if (selectors.some(([start, end, quote]) => !Number.isFinite(start) || !Number.isFinite(end) || typeof quote !== 'string')) return;
  return JSON.stringify(selectors);
}

/** Attach a new draft to the selected slot, or to an exact re-selection of its text. */
export function appendAnnotation(conversation: Conversation, draft: Annotation, source?: Annotation): Conversation {
  if (conversation.annotations.some(annotation => annotation.id === draft.id)) return conversation;
  const anchor = textAnchorKey(draft);
  const match = source ?? (anchor ? conversation.annotations.find(annotation =>
    annotation.deletedAt === undefined && annotation.messageId === draft.messageId &&
    annotation.versionId === draft.versionId && textAnchorKey(annotation) === anchor) : undefined);
  if (match) {
    const groupId = annotationGroupId(match);
    const lastSlot = conversation.annotations.reduce((last, annotation) =>
      annotationGroupId(annotation) === groupId ? Math.max(last, slotIndex(annotation)) : last, 1);
    draft = { ...draft, anchorGroupId: groupId, slotIndex: lastSlot + 1, quote: match.quote, anchor: match.anchor, color: match.color };
  }
  return { ...conversation, updatedAt: draft.updatedAt, annotations: [...conversation.annotations, draft] };
}
