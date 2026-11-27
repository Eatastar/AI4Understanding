declare module '*/shared/research.mjs' {
  export type ResearchScope = 'project' | 'papers' | 'web';
  export const RESEARCH_BUDGETS: Readonly<Record<ResearchScope, Readonly<{ queries: number; candidates: number; results: number }>>>;
  export const RESEARCH_TARGET_LIMIT: number;
  export const PAPER_RESEARCH_MS: number;
  export function isEnglishResearchQuery(value: unknown): boolean;
  export function needsCurrentProofSources(question: string, focus?: string): boolean;
  export function hasProofCheckDetails(value: unknown): boolean;
  export function researchTextKey(value: unknown): string;
  export function matchesResearchTarget(value: unknown, target: string): boolean;
  export function matchesProofWork(value: unknown, work: string): boolean;
  export function proofWorkHint(sources: readonly { title: string; authors?: string; excerpt?: string }[], minimumMatches?: number): string | undefined;
  export function targetedResearchQuery(query: string, target?: string): string;
  export function researchTitleKey(title: string): string;
  export function researchDoi(value: unknown): string;
  export function researchUrlKey(value?: string): string;
}
