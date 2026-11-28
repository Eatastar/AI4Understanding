import type { PDFPageProxy } from 'pdfjs-dist';

type Content = Awaited<ReturnType<PDFPageProxy['getTextContent']>>;
export type PdfRun = Extract<Content['items'][number], { str: string }>;
type Operators = Awaited<ReturnType<PDFPageProxy['getOperatorList']>>;
type OpNames = Pick<typeof import('pdfjs-dist')['OPS'], 'save'|'restore'|'transform'|'constructPath'|'paintFormXObjectBegin'|'paintFormXObjectEnd'|'endPath'>;
type Matrix = readonly number[];
function multiply(m: Matrix, n: Matrix) {
  return [m[0]*n[0]+m[2]*n[1], m[1]*n[0]+m[3]*n[1], m[0]*n[2]+m[2]*n[3], m[1]*n[2]+m[3]*n[3], m[0]*n[4]+m[2]*n[5]+m[4], m[1]*n[4]+m[3]*n[5]+m[5]];
}

/** Express the selection in its own baseline coordinates, even on a rotated page. */
export function selectionLayout(runs: readonly PdfRun[]) {
  const axis = runs.find(r => r.str.trim() && Math.hypot(r.transform[0], r.transform[1]) > 0);
  const angle = axis ? Math.atan2(axis.transform[1], axis.transform[0]) : 0;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const boxes = runs.filter(r => r.str.trim()).map(r => {
    const [, , c, d, x, y] = r.transform, h = Math.hypot(c, d), left = x*cos+y*sin;
    return { left, right: left + r.width, y: -x*sin+y*cos, h, short: r.str.trim().length <= 12 && r.width < h*5 };
  }).filter(b => b.h > 0);
  // Compare only selected glyphs. Words wrapped between prose lines have a
  // normal line advance; scripts sit between baselines and use a smaller font.
  let stacked = false;
  for (let i = 0; i < boxes.length && !stacked; i++) {
    const a = boxes[i];
    for (const b of boxes.slice(i+1)) {
      const h = Math.max(a.h,b.h), dy = Math.abs(a.y-b.y);
      const gap = Math.max(a.left-b.right,b.left-a.right);
      if (Math.min(a.h,b.h) < .89*h && dy > .13*h && dy < .85*h && gap >= -.35*h && gap < .7*h) { stacked=true; break; }
    }
  }
  if (!stacked) {
    const rows: (typeof boxes)[] = [];
    for (const b of boxes.filter(b=>b.short).sort((a,b)=>a.left-b.left)) {
      const row=rows.find(row=>Math.abs(row[0].y-b.y) < .26*Math.min(row[0].h,b.h));
      if (row) row.push(b); else rows.push([b]);
    }
    stacked=rows.some((upper,i)=>rows.slice(i+1).some(lower=>{
      const h=Math.max(upper[0].h,lower[0].h), dy=Math.abs(upper[0].y-lower[0].y);
      if (dy < .65*h || dy > 2.4*h) return false;
      let firstEnd: number|undefined;
      for (const a of upper) {
        const b=lower.find(b=>Math.abs(a.left-b.left)<.45*h);
        if (!b) continue;
        if (firstEnd===undefined) firstEnd=Math.max(a.right,b.right);
        else if (Math.min(a.left,b.left)>firstEnd+.2*h) return true;
      }
      return false;
    }));
  }
  return { stacked, boxes, cos, sin };
}

/** A drawn bar can be the only distinction between two otherwise identical glyphs.
 * Follow the PDF graphics state, and ignore rules outside the selected characters. */
export function hasSelectionBar(layout: ReturnType<typeof selectionLayout>, ops: Operators, names: OpNames) {
  const short = layout.boxes.filter(b => b.short);
  if (!short.length) return false;
  const stack: Matrix[] = [];
  let matrix: Matrix = [1,0,0,1,0,0];
  for (let i=0; i<ops.fnArray.length; i++) {
    const op=ops.fnArray[i], args=ops.argsArray[i];
    if (op===names.save || op===names.paintFormXObjectBegin) {
      stack.push(matrix);
      if (op===names.paintFormXObjectBegin && args?.[0]?.length===6) matrix=multiply(matrix,args[0]);
    } else if (op===names.restore || op===names.paintFormXObjectEnd) {
      matrix=stack.pop() ?? [1,0,0,1,0,0];
    } else if (op===names.transform) matrix=multiply(matrix,args);
    else if (op===names.constructPath && args?.[0]!==names.endPath && args?.[2]?.length===4) {
      const [x0,y0,x1,y1]=args[2];
      const points=[[x0,y0],[x1,y0],[x0,y1],[x1,y1]].map(([x,y]) => {
        const u=matrix[0]*x+matrix[2]*y+matrix[4], v=matrix[1]*x+matrix[3]*y+matrix[5];
        return [u*layout.cos+v*layout.sin,-u*layout.sin+v*layout.cos];
      });
      const left=Math.min(...points.map(p=>p[0])), right=Math.max(...points.map(p=>p[0]));
      const bottom=Math.min(...points.map(p=>p[1])), top=Math.max(...points.map(p=>p[1]));
      if (short.some(b => top-bottom < .15*b.h && right-left >= .26*b.h && right-left <= 8*b.h &&
        (b.left+b.right)/2 >= left-.1*b.h && (b.left+b.right)/2 <= right+.1*b.h &&
        bottom-b.y > .28*b.h && bottom-b.y < 1.55*b.h)) return true;
    }
  }
  return false;
}
