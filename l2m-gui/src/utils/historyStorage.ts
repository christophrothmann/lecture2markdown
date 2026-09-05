import { invoke } from '@tauri-apps/api/core';

export interface HistoryItem {
  id: string;
  fileName: string;
  timestamp: string;
  content?: string;
  totalPages: number;
  filePath?: string;
  status?: 'processing' | 'completed' | 'error';
  progressCurrent?: number;
  progressTotal?: number;
}

const CONVERSION_HISTORY_KEY = 'conversion_history';
const CONTENT_KEY_PREFIX = 'l2m_content_';

// In-memory cache for fast, synchronous repeated lookups without storage overhead
const contentCache = new Map<string, string>();

/**
 * Deduplicates history items based on file path, clean file name, or ID.
 */
export function deduplicateHistory(items: any[]): HistoryItem[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const result: HistoryItem[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const name = typeof item.fileName === 'string' ? item.fileName : '';
    const path = typeof item.filePath === 'string' ? item.filePath : '';
    const key = (path || name.replace(/\.(pdf|md)$/i, '') || item.id || '').toLowerCase().trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

/**
 * Loads history metadata from localStorage.
 * Automatically migrates legacy items containing embedded heavy markdown
 * by moving the content into dedicated cache slots and saving the slim list back.
 */
export function loadHistoryMeta(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(CONVERSION_HISTORY_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    const deduped = deduplicateHistory(parsed);

    let hadLegacyContent = false;
    const slimItems: HistoryItem[] = deduped.map((item) => {
      if (item.content && item.content.trim()) {
        hadLegacyContent = true;
        contentCache.set(item.id, item.content);
        try {
          localStorage.setItem(`${CONTENT_KEY_PREFIX}${item.id}`, item.content);
        } catch {
          // Ignore localStorage quota errors
        }
      }

      // Return slim metadata without heavy markdown content
      const { content: _unused, ...meta } = item;
      return {
        ...meta,
        content: '',
      };
    });

    if (hadLegacyContent) {
      try {
        localStorage.setItem(CONVERSION_HISTORY_KEY, JSON.stringify(slimItems));
      } catch {
        // Ignore
      }
    }

    return slimItems;
  } catch {
    return [];
  }
}

/**
 * Persists history metadata without heavy markdown content, keeping localStorage lean.
 */
export function saveHistoryMeta(items: HistoryItem[]): void {
  try {
    const toPersist = deduplicateHistory(items)
      .filter((h) => h.status === 'completed' || !h.status)
      .slice(0, 100)
      .map((item) => {
        const { content: _unused, ...meta } = item;
        return {
          ...meta,
          content: '',
        };
      });

    localStorage.setItem(CONVERSION_HISTORY_KEY, JSON.stringify(toPersist));
  } catch (e) {
    console.error('Failed to save history metadata:', e);
  }
}

/**
 * Saves heavy markdown content to in-memory cache and dedicated localStorage slot.
 */
export function saveHistoryItemContent(id: string, content: string): void {
  if (!id || !content) return;
  contentCache.set(id, content);
  try {
    localStorage.setItem(`${CONTENT_KEY_PREFIX}${id}`, content);
  } catch {
    // Ignore quota errors if storage is constrained
  }
}

/**
 * Loads markdown content on demand:
 * 1. Checks in-memory cache (0ms delay).
 * 2. If item.filePath is available, tries reading companion .md file via Tauri native IPC.
 * 3. Falls back to dedicated localStorage slot.
 * 4. Falls back to item.content if present.
 */
export async function loadHistoryItemContent(item: HistoryItem): Promise<string> {
  if (!item || !item.id) return '';

  // 1. In-memory cache
  if (contentCache.has(item.id)) {
    const cached = contentCache.get(item.id);
    if (cached) return cached;
  }

  // 2. Embedded content
  if (item.content && item.content.trim()) {
    contentCache.set(item.id, item.content);
    return item.content;
  }

  // 3. Companion .md file on disk
  if (item.filePath) {
    const mdPath = item.filePath.replace(/\.pdf$/i, '.md');
    try {
      const fileContent = await invoke<string>('read_text_file_native', { filePath: mdPath });
      if (fileContent && fileContent.trim()) {
        contentCache.set(item.id, fileContent);
        return fileContent;
      }
    } catch {
      // Companion file might have been moved or deleted; continue to fallback
    }
  }

  // 4. Dedicated localStorage slot
  try {
    const stored = localStorage.getItem(`${CONTENT_KEY_PREFIX}${item.id}`);
    if (stored && stored.trim()) {
      contentCache.set(item.id, stored);
      return stored;
    }
  } catch {
    // Ignore
  }

  return item.content || '';
}

/**
 * Cleans up dedicated content slot for a deleted history item.
 */
export function deleteHistoryItemContent(id: string): void {
  if (!id) return;
  contentCache.delete(id);
  try {
    localStorage.removeItem(`${CONTENT_KEY_PREFIX}${id}`);
  } catch {
    // Ignore
  }
}

/**
 * Clears entire conversion history metadata and all associated content slots.
 */
export function clearAllHistoryStorage(): void {
  contentCache.clear();
  try {
    localStorage.removeItem(CONVERSION_HISTORY_KEY);
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CONTENT_KEY_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Ignore
  }
}
