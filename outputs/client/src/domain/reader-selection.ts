import { foldSearchText, normalizeSearchText } from './reader-navigation';

/** PDF.js inserts line breaks into extracted pages that are absent from the
 * selectable DOM. Match the actual surrounding characters of the selection. */
export function sourceSelectionStart(source:string, rendered:string, selector:{start:number;end:number;quote:string}):number|undefined {
  const {start,end,quote}=selector;
  if (!quote || rendered.slice(start,end)!==quote) return;
  if (source===rendered) return start;
  const norm=normalizeSearchText(source);
  const term=foldSearchText(quote);
  if (!term) return;
  const before=foldSearchText(rendered.slice(Math.max(0,start-85),start));
  const after=foldSearchText(rendered.slice(end,end+85));
  let best=-1, location:number|undefined, count=0;
  for (let i=norm.text.indexOf(term);i>=0;i=norm.text.indexOf(term,i+term.length)) {
    count++;
    let left=0,right=0;
    while (left<before.length && before[before.length-left-1]===norm.text[i-left-1]) left++;
    while (right<after.length && after[right]===norm.text[i+term.length+right]) right++;
    const score=left+right;
    if (score>best) {best=score;location=norm.starts[i];}
    else if (score===best) location=undefined;
  }
  return count===1 || best>=6 ? location : undefined;
}
