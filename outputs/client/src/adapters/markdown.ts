interface MathDelimiterOptions {
  /** Ranges of code, HTML and existing math identified by a Markdown parser. */
  protectedRanges: readonly (readonly [start: number, end: number])[];
}

/** Adapt model TeX delimiters for remark-math without changing saved replies. */
export function normalizeMathDelimiters(source: string, options?: MathDelimiterOptions): string {
  const output: string[] = [];
  let offset = 0;
  let rangeIndex = 0;

  const escaped = (index: number) => {
    let slashes = 0;
    while (index > 0 && source[--index] === '\\') slashes += 1;
    return slashes % 2 === 1;
  };
  const findDelimiter = (delimiter: string, from: number) => {
    let index = source.indexOf(delimiter, from);
    while (index !== -1) {
      if (!escaped(index)) return index;
      index = source.indexOf(delimiter, index + delimiter.length);
    }
    return -1;
  };

  while (offset < source.length) {
    const protectedRange = options?.protectedRanges[rangeIndex];
    if (protectedRange && offset >= protectedRange[0]) {
      output.push(source.slice(offset, protectedRange[1]));
      offset = protectedRange[1];
      rangeIndex += 1;
      continue;
    }
    // Code examples must keep their literal delimiters, including while a fenced
    // block is still arriving. Only the presentation copy is ever normalized.
    if (!options && (offset === 0 || source[offset - 1] === '\n')) {
      const end = source.indexOf('\n', offset);
      const lineEnd = end === -1 ? source.length : end + 1;
      const line = source.slice(offset, lineEnd);
      const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        const close = new RegExp('^ {0,3}' + fence[1][0] + '{' + fence[1].length + ',}[ \\t\\r]*$');
        let cursor = lineEnd;
        while (cursor < source.length) {
          const next = source.indexOf('\n', cursor);
          const nextEnd = next === -1 ? source.length : next;
          if (close.test(source.slice(cursor, nextEnd))) {
            cursor = next === -1 ? source.length : next + 1;
            break;
          }
          cursor = next === -1 ? source.length : next + 1;
        }
        output.push(source.slice(offset, cursor));
        offset = cursor;
        continue;
      }
      if (/^(?: {4}|\t)/.test(line)) {
        output.push(line);
        offset = lineEnd;
        continue;
      }
    }

    if (!options && source[offset] === '`' && !escaped(offset)) {
      let count = 1;
      while (source[offset + count] === '`') count += 1;
      let end = offset + count;
      while (end < source.length) {
        if (source[end] !== '`') { end += 1; continue; }
        let run = 1;
        while (source[end + run] === '`') run += 1;
        if (run === count) { end += run; break; }
        end += run;
      }
      output.push(source.slice(offset, end));
      offset = end;
      continue;
    }

    // Do not reinterpret delimiters inside an existing $ / $$ math expression.
    if (!options && source[offset] === '$' && !escaped(offset)) {
      const delimiter = source[offset + 1] === '$' ? '$$' : '$';
      const end = findDelimiter(delimiter, offset + delimiter.length);
      if (end !== -1) {
        output.push(source.slice(offset, end + delimiter.length));
        offset = end + delimiter.length;
        continue;
      }
    }

    const bracket = source[offset] === '\\' && (source[offset + 1] === '(' || source[offset + 1] === '[');
    const dollars = options && source.startsWith('$$', offset) && source[offset - 1] !== '$' && source[offset + 2] !== '$';
    if ((bracket || dollars) && !escaped(offset)) {
      const display = dollars || source[offset + 1] === '[';
      const end = findDelimiter(dollars ? '$$' : display ? '\\]' : '\\)', offset + 2);
      if (end !== -1 && (!protectedRange || end + 2 <= protectedRange[0])) {
        const body = source.slice(offset + 2, end);
        if (!display) output.push('$' + body + '$');
        else if (!options) output.push('\n\n$$\n' + body.trim() + '\n$$\n\n');
        else if (!body.includes('\n')) output.push('$$' + body + '$$');
        else {
          // Keep display fences in their Markdown list or quote instead of
          // introducing an unindented block between two list items.
          const line = source.slice(source.lastIndexOf('\n', offset - 1) + 1, offset);
          const prefix = line.match(/^[\t >]*/u)?.[0] ?? '';
          const indent = prefix + (line.slice(prefix.length).match(/^(?:[-+*]|\d+[.)])\s*$/u) ? ' '.repeat(line.length - prefix.length) : '');
          const opening = /^[ \t\r]*\n/u.test(body) ? '' : '\n' + indent;
          const closing = /^[\t >]*$/u.test(body.slice(body.lastIndexOf('\n') + 1)) ? '' : '\n' + indent;
          output.push('$$' + opening + body + closing + '$$');
        }
        offset = end + 2;
        continue;
      }
    }
    output.push(source[offset]);
    offset += 1;
  }
  return output.join('');
}
