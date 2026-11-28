export const DEFAULT_INPUT_CAP: number;
export const MAX_INPUT_CAP: number;
export function selectionImageReserve(width: number, height: number): number;
export interface ReaderGuard { connection?:ReaderConnection; inputCap: number; outputCap: number; maxUSD?: number }
export interface ReaderConnection { apiFormat: string; model: string; baseURL: string; mode?: string }
export function countReaderInput(value: unknown): { estimate: number; upper: number };
export function hasReaderRates(connection?: ReaderConnection): boolean;
export function readerCostLimit(upper: number, output: number): number;
export function receiptCost(usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }): number | undefined;
export function checkReaderBudget(body: unknown, guard: ReaderGuard, connection?: ReaderConnection): { estimate: number; upper: number };
