import katex from 'katex';

export const wikiMathOptions = { trust: false } as const;

type FormulaPreview = { html: string } | { error: string; infinityHint: boolean };

export function previewWikiFormula(latex: string, displayMode: boolean): FormulaPreview {
  try {
    return { html: katex.renderToString(latex, { ...wikiMathOptions, displayMode, throwOnError: true }) };
  } catch (error) {
    const position = error instanceof katex.ParseError ? error.position : undefined;
    const infinityHint = position !== undefined && latex.slice(0, position).trimEnd().endsWith('^')
      && /^\\inf(?![a-z])/iu.test(latex.slice(position));
    return { error: error instanceof Error ? error.message : String(error), infinityHint };
  }
}
