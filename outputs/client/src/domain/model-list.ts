export interface DiscoveredModel { id: string; label?: string }

const modelNames = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
/** Sort the actual API IDs naturally, keeping provider IDs and the input array intact. */
export function sortDiscoveredModels(models: readonly DiscoveredModel[]): DiscoveredModel[] {
  return [...models].sort((left, right) => modelNames.compare(left.id, right.id) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

const normalize = (text: string) => text.normalize('NFKC').toLowerCase();
const compact = (text: string) => text.replace(/[\s._:/-]+/gu, '');

/** Search IDs and friendly labels without changing the API ID that is selected. */
export function filterModels<T extends DiscoveredModel>(models: readonly T[], query: string): readonly T[] {
  const tokens = normalize(query).trim().split(/\s+/u).filter(Boolean);
  if (!tokens.length) return models;
  return models.filter(model => {
    const searchable = normalize(model.id + ' ' + (model.label || ''));
    const joined = compact(searchable);
    return tokens.every(token => searchable.includes(token) || Boolean(compact(token) && joined.includes(compact(token))));
  });
}
