import { useCallback, useEffect, useState } from 'react';
import { desktop } from '../adapters/desktop';
import type { KnowledgeDraft, KnowledgeLibrary } from '../domain/knowledge';

const EMPTY_LIBRARY: KnowledgeLibrary = { cards: [], recovered: false };

export function useKnowledgeBase() {
  const bridge = desktop()?.knowledge;
  const [library, setLibrary] = useState(EMPTY_LIBRARY);
  const [loading, setLoading] = useState(Boolean(bridge));
  const [loadError, setLoadError] = useState(false);
  const reload = useCallback(async () => {
    if (!bridge) return;
    setLoading(true);
    try {
      setLibrary(await bridge.list());
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [bridge]);
  useEffect(() => { void reload(); }, [reload]);

  async function save(draft: KnowledgeDraft) {
    if (!bridge) return;
    setLibrary(await bridge.save(draft));
    setLoadError(false);
  }

  async function remove(id: string) {
    if (!bridge) return;
    setLibrary(await bridge.remove(id));
    setLoadError(false);
  }

  async function importCards(raw: string) {
    if (!bridge) throw new Error('请在桌面版导入知识库。');
    const { added, skipped, ...next } = await bridge.importCards(raw);
    setLibrary(next);
    setLoadError(false);
    return { added, skipped };
  }

  return { ...library, available: Boolean(bridge), loading, loadError, reload, save, remove, importCards };
}
