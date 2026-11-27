import { useCallback, useLayoutEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';

/** The citation owns its own lifetime, including while its destination is loading. */
export function useReferenceHighlight<T extends { reference?: boolean }>(
  focus: T | null, setFocus: Dispatch<SetStateAction<T | null>>, frameDoc?: Document | null,
) {
  const reference = focus?.reference ? focus : null;
  const timer = useRef<number | undefined>(undefined);
  const dismiss = useCallback(() => {
    if (reference) setFocus(current => current === reference ? null : current);
  }, [reference, setFocus]);

  useLayoutEffect(() => {
    if (!reference) return;
    const docs = frameDoc && frameDoc !== document ? [document, frameDoc] : [document];
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    for (const doc of docs) {
      doc.addEventListener('pointerdown', dismiss, true);
      doc.addEventListener('keydown', onKey, true);
    }
    return () => {
      for (const doc of docs) {
        doc.removeEventListener('pointerdown', dismiss, true);
        doc.removeEventListener('keydown', onKey, true);
      }
    };
  }, [reference, dismiss, frameDoc]);

  useLayoutEffect(() => () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, [reference]);

  return useCallback((marker: HTMLElement | null) => {
    if (marker && reference && timer.current === undefined) timer.current = window.setTimeout(dismiss, 3000);
  }, [reference, dismiss]);
}
