import { describe, it, expect, beforeEach } from 'bun:test';
import {
  deduplicateHistory,
  loadHistoryMeta,
  saveHistoryMeta,
  saveHistoryItemContent,
  loadHistoryItemContent,
  deleteHistoryItemContent,
  clearAllHistoryStorage,
  type HistoryItem,
} from './historyStorage';

// Mock localStorage for test environment if not fully present
const storageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i: number) => Object.keys(store)[i] || null,
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: storageMock,
  writable: true,
});

describe('historyStorage', () => {
  beforeEach(() => {
    clearAllHistoryStorage();
  });

  it('deduplicates history items based on filePath or clean fileName', () => {
    const rawItems = [
      { id: '1', fileName: 'Lecture1.pdf', filePath: '/docs/Lecture1.pdf', totalPages: 10, timestamp: '10:00' },
      { id: '2', fileName: 'Lecture1.pdf', filePath: '/docs/Lecture1.pdf', totalPages: 10, timestamp: '10:05' },
      { id: '3', fileName: 'Lecture2.pdf', filePath: '/docs/Lecture2.pdf', totalPages: 15, timestamp: '11:00' },
    ];

    const deduped = deduplicateHistory(rawItems);
    expect(deduped.length).toBe(2);
    expect(deduped[0].id).toBe('1');
    expect(deduped[1].id).toBe('3');
  });

  it('automatically migrates legacy items containing embedded markdown', () => {
    const legacyItems = [
      {
        id: 'item-1',
        fileName: 'Biochemie.pdf',
        filePath: '/uni/Biochemie.pdf',
        content: '# Glykolyse\n\nSchritt 1: Hexokinase...',
        totalPages: 24,
        timestamp: '14:30',
        status: 'completed',
      },
    ];

    localStorage.setItem('conversion_history', JSON.stringify(legacyItems));

    const meta = loadHistoryMeta();
    expect(meta.length).toBe(1);
    expect(meta[0].id).toBe('item-1');
    expect(meta[0].content).toBe(''); // Content was stripped from metadata list

    // Verify content was migrated to dedicated slot
    const slotContent = localStorage.getItem('l2m_content_item-1');
    expect(slotContent).toBe('# Glykolyse\n\nSchritt 1: Hexokinase...');
  });

  it('saves and loads item content on demand', async () => {
    const item: HistoryItem = {
      id: 'doc-42',
      fileName: 'Informatik.pdf',
      totalPages: 30,
      timestamp: '09:15',
      status: 'completed',
    };

    saveHistoryItemContent('doc-42', '## [Folie 1] Algorithmen & Datenstrukturen');
    saveHistoryMeta([item]);

    const loadedMeta = loadHistoryMeta();
    expect(loadedMeta[0].content).toBe('');

    const resolvedContent = await loadHistoryItemContent(loadedMeta[0]);
    expect(resolvedContent).toBe('## [Folie 1] Algorithmen & Datenstrukturen');
  });

  it('deletes content slot and clears all storage correctly', () => {
    saveHistoryItemContent('doc-1', 'Content 1');
    saveHistoryItemContent('doc-2', 'Content 2');

    deleteHistoryItemContent('doc-1');
    expect(localStorage.getItem('l2m_content_doc-1')).toBeNull();
    expect(localStorage.getItem('l2m_content_doc-2')).toBe('Content 2');

    clearAllHistoryStorage();
    expect(localStorage.getItem('conversion_history')).toBeNull();
    expect(localStorage.getItem('l2m_content_doc-2')).toBeNull();
  });
});
