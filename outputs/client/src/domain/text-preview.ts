export function textPreview(content: string, limit: number) {
  return content.length > limit ? content.slice(0, limit).replace(/[\uD800-\uDBFF]$/u, '') + '…' : content;
}
