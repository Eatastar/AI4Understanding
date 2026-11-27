const encoder = new TextEncoder();
export const DEFAULT_INPUT_CAP = 12000;
export const MAX_INPUT_CAP = 200000;

// Both the planner and the transport count the actual serialized text. The
// margin covers role framing. This is a local estimate, not provider usage.
export function countReaderInput(value) {
  const wire = JSON.stringify(value);
  let ascii = 0, punctuation = 0, otherBytes = 0;
  for (const char of wire) {
    const code = char.codePointAt(0);
    if (code < 128) {
      if (/[A-Za-z0-9\s]/u.test(char)) ascii++;
      else punctuation++;
    } else otherBytes += code < 2048 ? 2 : code < 65536 ? 3 : 4;
  }
  return { estimate: 96 + Math.ceil(ascii / 3 + punctuation + otherBytes / 1.7), upper: 96 + encoder.encode(wire).length };
}

export function hasReaderRates(connection) {
  if (!connection || connection.mode === 'demo' || connection.model !== 'gpt-6.2-sol' || connection.apiFormat !== 'openai-responses') return false;
  try { const url = new URL(connection.baseURL); return url.origin === 'https://api.openai.com' && /^\/v1\/?$/u.test(url.pathname); }
  catch { return false; }
}

// OpenAI standard text rates, 2026-11-27. No service tier, cache retention
// extension, tools, or images are requested by this reader path.
export function readerCostLimit(upper, output) {
  const long = upper > 272000;
  return (upper * (long ? 5 : 2.5) + output * (long ? 15 : 10)) / 1000000;
}
export function receiptCost(usage) {
  const { inputTokens: input, outputTokens: output, cacheReadTokens: read, cacheWriteTokens: write } = usage ?? {};
  if (![input,output,read,write].every(n => Number.isSafeInteger(n) && n >= 0) || read + write > input) return;
  const factor = input > 272000 ? 2 : 1;
  return (((input-read-write)*2 + read*0.1 + write*2.5)*factor + output*(factor===2 ? 15 : 10)) / 1000000;
}

export function checkReaderBudget(body, guard, connection) {
  if (!guard || !Number.isInteger(guard.inputCap) || guard.inputCap < 256 || guard.inputCap > MAX_INPUT_CAP ||
      ![2048,4096].includes(guard.outputCap) || (guard.maxUSD !== undefined && (!Number.isFinite(guard.maxUSD) || guard.maxUSD <= 0))) throw new Error('阅读资料预算无效，请检查阅读设置。');
  const count = countReaderInput(body);
  if (count.estimate > guard.inputCap) throw new Error('本次必需原文超过输入上限，请缩小选区、选择按需引用或提高阅读预算。');
  if (guard.maxUSD !== undefined) {
    if (!hasReaderRates(connection)) throw new Error('此连接没有可核实的单价，无法按金额限定本次请求。可使用输入 token 上限。');
    if (readerCostLimit(count.upper,guard.outputCap) > guard.maxUSD) throw new Error('本次请求的保守费用估算超过单题金额上限，请调整阅读预算或选区。');
  }
  return count;
}
