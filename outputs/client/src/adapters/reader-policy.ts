import { DEFAULT_INPUT_CAP, MAX_INPUT_CAP } from '../../shared/reader-budget.mjs';
import type { ModelSettings } from '../domain/types';
import type { ReaderPolicy } from '../domain/reader-report';

export interface ReaderOptions { enabled:boolean; inputCap:number; maxUSD?:number }
const key='ai4u.reader.context.v1';
const defaults:ReaderOptions={enabled:true,inputCap:DEFAULT_INPUT_CAP};
export function readReaderOptions():ReaderOptions {
  try {
    const o=JSON.parse(localStorage.getItem(key)??'null');
    if (!o || typeof o.enabled!=='boolean' || !Number.isSafeInteger(o.inputCap) || o.inputCap<256 || o.inputCap>MAX_INPUT_CAP || (o.maxUSD!==undefined && !(Number.isFinite(o.maxUSD) && o.maxUSD>0))) return defaults;
    return {enabled:o.enabled,inputCap:o.inputCap,...(o.maxUSD!==undefined?{maxUSD:o.maxUSD}:{})};
  } catch { return defaults; }
}
export function saveReaderOptions(options:ReaderOptions) {localStorage.setItem(key,JSON.stringify(options));}
export function readerPolicy(settings:ModelSettings):ReaderPolicy|undefined {
  const options=readReaderOptions();
  if (!options.enabled) return;
  return {inputCap:options.inputCap,maxUSD:options.maxUSD,connection:{id:settings.activeProfileId,model:settings.model,mode:settings.mode,apiFormat:settings.apiFormat,baseURL:settings.baseURL}};
}
