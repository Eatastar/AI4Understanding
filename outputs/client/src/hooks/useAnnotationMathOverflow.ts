import { useLayoutEffect, type RefObject } from 'react';

// Only promote an inline formula if one of KaTeX's nonbreaking spans is
// wider than the line. The LaTeX and MathML stay in their original nodes.
export function useAnnotationMathOverflow(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      for (const formula of root.querySelectorAll<HTMLElement>('.annotation-markdown .katex')) {
        if (formula.closest('.katex-display')) continue;
        const block = formula.closest<HTMLElement>('p, li, h1, h2, h3, h4, h5, h6, th, td, .annotation-markdown');
        if (!block?.clientWidth) continue;
        const style = getComputedStyle(block);
        const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const width = block.clientWidth - padding;
        const oversized = [...formula.querySelectorAll<HTMLElement>('.katex-html > .base')].some(base =>
          Math.max(base.scrollWidth, base.getBoundingClientRect().width) > width + 1);
        formula.toggleAttribute('data-annotation-formula-overflow', oversized);
      }
    };
    const resize = new ResizeObserver(measure);
    const mutations = new MutationObserver(measure);
    resize.observe(root);
    mutations.observe(root, { subtree: true, childList: true, characterData: true });
    root.addEventListener('toggle', measure, true);
    root.ownerDocument.fonts.addEventListener('loadingdone', measure);
    measure();
    return () => {
      resize.disconnect();
      mutations.disconnect();
      root.removeEventListener('toggle', measure, true);
      root.ownerDocument.fonts.removeEventListener('loadingdone', measure);
    };
  }, [ref]);
}
