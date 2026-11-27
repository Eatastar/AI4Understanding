import { RECENT_READING_ORDER_LIMIT, type RecentReadingPreferences } from '../domain/local-library';

export interface ReaderSession {
  conversationId: string; documentId: string; mode?: 'focused' | 'split' | 'closed'; projectId?: string;
  workspacePane?: 'overview' | 'chat'; returnWithPreview?: true;
}
const KEY = 'learn-something.reader.session.v1';
const RECENT_READING_KEY = 'learn-something.reader.recent.v1';
export function loadReaderSession(storage?: Pick<Storage, 'getItem'>): ReaderSession | null {
  try {
    const value = JSON.parse((storage || localStorage).getItem(KEY) || 'null');
    if (!value || typeof value.conversationId !== 'string' || !value.conversationId.trim() || value.conversationId.length > 200 || typeof value.documentId !== 'string' || !value.documentId.trim() || value.documentId.length > 200) return null;
    return { conversationId: value.conversationId, documentId: value.documentId, ...(['focused', 'split', 'closed'].includes(value.mode) ? { mode: value.mode } : {}),
      ...(typeof value.projectId === 'string' && value.projectId.length > 0 && value.projectId.length <= 200 ? { projectId: value.projectId } : {}),
      ...(value.workspacePane === 'overview' || value.workspacePane === 'chat' ? { workspacePane: value.workspacePane } : {}),
      ...(value.returnWithPreview === true ? { returnWithPreview: true } : {}),
    };
  } catch { return null; }
}
export function saveReaderSession(value: ReaderSession | null, storage?: Pick<Storage, 'setItem'>) { try { (storage || localStorage).setItem(KEY, JSON.stringify(value)); } catch { /* Reading remains usable with session-only preferences. */ } }

function documentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length <= 200 && !!id.trim()))];
}

export function loadRecentReading(storage?: Pick<Storage, 'getItem'>): RecentReadingPreferences {
  try {
    const value = JSON.parse((storage || localStorage).getItem(RECENT_READING_KEY) || 'null');
    return {
      opened: documentIds(value?.opened).slice(0, RECENT_READING_ORDER_LIMIT),
      hidden: documentIds(value?.hidden),
    };
  } catch { return { opened: [], hidden: [] }; }
}

export function saveRecentReading(value: RecentReadingPreferences, storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    (storage || localStorage).setItem(RECENT_READING_KEY, JSON.stringify(value));
    return true;
  } catch { return false; }
}
