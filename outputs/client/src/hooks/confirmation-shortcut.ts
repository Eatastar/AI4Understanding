import { useEffect } from 'react';

export const confirmShortcut = { 'data-confirm-action': '', 'aria-keyshortcuts': 'Control+Enter Meta+Enter' } as const;
export const confirmationScope = { 'data-confirm-scope': '' } as const;

const actionSelector = 'button[data-confirm-action]';
const scopeSelector = 'dialog[open], [role="dialog"], [data-confirm-scope]';

export function isConfirmationChord(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>) {
  return event.key === 'Enter' && event.ctrlKey !== event.metaKey && !event.shiftKey && !event.altKey;
}

function visibleAction(button: Element): button is HTMLButtonElement {
  return button instanceof HTMLButtonElement && button.matches(actionSelector)
    && !button.closest('[hidden], [inert], [aria-hidden="true"]')
    && button.checkVisibility({ visibilityProperty: true });
}

function confirmationButton(target: Element) {
  const scope = target.closest(scopeSelector);
  const owner = (target instanceof HTMLInputElement || target instanceof HTMLButtonElement || target instanceof HTMLTextAreaElement)
    ? target.form : null;
  const form = owner ?? target.closest('form');
  const inForm = form ? Array.from(form.elements).filter(visibleAction).filter(button => button.closest(scopeSelector) === scope) : [];
  const candidates = inForm.length ? inForm : Array.from(scope?.querySelectorAll(actionSelector) ?? [])
    .filter(visibleAction).filter(button => button.closest(scopeSelector) === scope);
  return candidates.find(button => button === target || button.contains(target))
    ?? (candidates.length === 1 ? candidates[0] : undefined);
}

export function useConfirmationShortcut() {
  useEffect(() => {
    const composing = new WeakSet<Element>();
    const start = (event: Event) => { if (event.target instanceof Element) composing.add(event.target); };
    const end = (event: Event) => { if (event.target instanceof Element) composing.delete(event.target); };
    const confirm = (event: KeyboardEvent) => {
      if (!isConfirmationChord(event) || event.defaultPrevented || !(event.target instanceof Element)) return;
      const target = event.target;
      if (document.querySelector('dialog:modal') && !target.closest('dialog:modal')) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (target.closest('[data-recording-shortcut]')) return;
      if (event.isComposing || event.keyCode === 229 || composing.has(target) || event.getModifierState('AltGraph')) {
        event.stopPropagation();
        return;
      }
      const button = confirmationButton(target);
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat && !button.matches(':disabled') && button.getAttribute('aria-disabled') !== 'true') button.click();
    };
    document.addEventListener('compositionstart', start, true);
    document.addEventListener('compositionend', end, true);
    window.addEventListener('keydown', confirm, true);
    return () => {
      document.removeEventListener('compositionstart', start, true);
      document.removeEventListener('compositionend', end, true);
      window.removeEventListener('keydown', confirm, true);
    };
  }, []);
}
