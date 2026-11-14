import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ProviderType } from '../components/ApiKeyModal';
import type { BatchQueueItem } from '../components/BatchQueue';
import type { HistoryItem } from '../components/HistorySidebar';
import {
  deduplicateHistory,
  loadHistoryItemContent,
  saveHistoryItemContent,
  saveHistoryMeta,
} from '../utils/historyStorage';

export type AppMainView = 'dropzone' | 'batch' | 'preview';

interface UseBatchQueueOptions {
  activeProvider: ProviderType;
  apiKey: string;
  history: HistoryItem[];
  activeMainView: AppMainView;
  hasPreview: boolean;
  setHistory: Dispatch<SetStateAction<HistoryItem[]>>;
  setMarkdownResult: Dispatch<SetStateAction<string | null>>;
  setPreviewFileName: Dispatch<SetStateAction<string>>;
  setPreviewPdfPath: Dispatch<SetStateAction<string | null>>;
  setSelectedHistoryId: Dispatch<SetStateAction<string | null>>;
  setActiveMainView: Dispatch<SetStateAction<AppMainView>>;
}

export function useBatchQueue({
  activeProvider,
  apiKey,
  history,
  activeMainView,
  hasPreview,
  setHistory,
  setMarkdownResult,
  setPreviewFileName,
  setPreviewPdfPath,
  setSelectedHistoryId,
  setActiveMainView,
}: UseBatchQueueOptions) {
  const [queue, setQueue] = useState<BatchQueueItem[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [activeQueueId, setActiveQueueId] = useState<string | null>(null);
  const queueRef = useRef<BatchQueueItem[]>([]);
  const cancelBatchRef = useRef(false);
  const activeJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    listen<string>('python-event', (event) => {
      try {
        const payload = JSON.parse(event.payload);
        if (payload.type === 'start') {
          if (activeJobIdRef.current) {
            setHistory((prev) =>
              prev.map((item) =>
                item.id === activeJobIdRef.current
                  ? { ...item, totalPages: payload.total_pages, progressTotal: payload.total_pages }
                  : item
              )
            );
          }
        } else if (payload.type === 'progress') {
          setQueue((prev) =>
            prev.map((item) =>
              item.id === activeQueueId
                ? { ...item, progressCurrent: payload.completed, progressTotal: payload.total }
                : item
            )
          );

          if (activeJobIdRef.current) {
            setHistory((prev) =>
              prev.map((item) =>
                item.id === activeJobIdRef.current
                  ? { ...item, progressCurrent: payload.completed, progressTotal: payload.total }
                  : item
              )
            );
          }
        }
      } catch {
        // Ignore malformed progress events.
      }
    }).then((unlisten) => {
      unlistenFn = unlisten;
    });

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, [activeQueueId, setHistory]);

  const addQueueItems = (items: BatchQueueItem[]) => {
    setQueue((prev) => [...prev, ...items]);
  };

  const clearQueueItems = () => {
    setQueue([]);
  };

  const updateItemRange = (id: string, start: number, end: number, mode: 'all' | 'custom') => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, startPage: start, endPage: end, rangeMode: mode } : item))
    );
  };

  const removeQueueItem = (id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const clearQueue = () => {
    setQueue([]);
    if (activeMainView === 'batch') {
      setActiveMainView(hasPreview ? 'preview' : 'dropzone');
    }
  };

  const cancelBatch = async () => {
    cancelBatchRef.current = true;
    try {
      await invoke('cancel_conversion_native');
    } catch (e) {
      console.error('Fehler beim Abbrechen:', e);
    }
    setIsBatchRunning(false);
    setActiveQueueId(null);
    if (activeJobIdRef.current) {
      setHistory((prev) => prev.filter((item) => item.id !== activeJobIdRef.current));
    }
  };

  const startBatch = async () => {
    if (queue.length === 0 || !apiKey) return;
    setIsBatchRunning(true);
    cancelBatchRef.current = false;
    setActiveMainView('batch');

    for (let i = 0; i < queue.length; i++) {
      if (cancelBatchRef.current) break;
      const itemSnapshot = queue[i];

      const currentItem = queueRef.current.find((item) => item.id === itemSnapshot.id);
      if (!currentItem || currentItem.status === 'completed') continue;

      setActiveQueueId(currentItem.id);

      const targetStart = currentItem.rangeMode === 'custom' ? currentItem.startPage : 1;
      const targetEnd = currentItem.rangeMode === 'custom' ? currentItem.endPage : currentItem.totalPages;
      const targetCount = Math.max(1, targetEnd - targetStart + 1);

      setQueue((prev) =>
        prev.map((item) =>
          item.id === currentItem.id
            ? { ...item, status: 'processing', progressCurrent: 0, progressTotal: targetCount }
            : item
        )
      );

      const jobId = Date.now().toString();
      activeJobIdRef.current = jobId;

      const inProgressItem: HistoryItem = {
        id: jobId,
        fileName: currentItem.fileName,
        filePath: currentItem.filePath,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: '',
        totalPages: targetCount,
        status: 'processing',
        progressCurrent: 0,
        progressTotal: targetCount,
      };

      const inProgressKey = (currentItem.filePath || currentItem.fileName.replace(/\.(pdf|md)$/i, '')).toLowerCase().trim();
      setHistory((prev) => {
        const filtered = prev.filter((item) => {
          const itemKey = (item.filePath || item.fileName.replace(/\.(pdf|md)$/i, '')).toLowerCase().trim();
          return itemKey !== inProgressKey && item.id !== jobId && item.status !== 'processing';
        });
        return [inProgressItem, ...filtered];
      });

      try {
        const { streamTranscribePdfSlides } = await import('../utils/pdfRenderer');
        const markdown = await streamTranscribePdfSlides(
          currentItem.filePath,
          activeProvider,
          apiKey,
          currentItem.fileName,
          {
            startPage: currentItem.rangeMode === 'custom' ? targetStart : undefined,
            endPage: currentItem.rangeMode === 'custom' ? targetEnd : undefined,
            onSlideCompleted: (completed, total) => {
              setQueue((prev) =>
                prev.map((item) =>
                  item.id === currentItem.id
                    ? { ...item, progressCurrent: completed, progressTotal: total }
                    : item
                )
              );
              setHistory((prev) =>
                prev.map((item) =>
                  item.id === jobId
                    ? { ...item, progressCurrent: completed, progressTotal: total }
                    : item
                )
              );
            },
          }
        );

        setQueue((prev) =>
          prev.map((item) =>
            item.id === currentItem.id
              ? { ...item, status: 'completed', markdownResult: markdown }
              : item
          )
        );

        saveHistoryItemContent(jobId, markdown);
        setHistory((prev) => {
          const updated = prev.map((item) =>
            item.id === jobId
              ? {
                  ...item,
                  status: 'completed' as const,
                  content: '',
                  totalPages: targetCount,
                  filePath: currentItem.filePath,
                }
              : item
          );
          const deduped = deduplicateHistory(updated);
          saveHistoryMeta(deduped);
          return deduped;
        });

        setMarkdownResult(markdown);
        setPreviewFileName(currentItem.fileName.replace('.pdf', '.md'));
        setPreviewPdfPath(currentItem.filePath);
        setSelectedHistoryId(jobId);
      } catch (err: unknown) {
        const errorMessage = String(err);
        if (cancelBatchRef.current || errorMessage.toLowerCase().includes('abgebrochen')) {
          setQueue((prev) =>
            prev.map((item) => (item.id === currentItem.id ? { ...item, status: 'pending' } : item))
          );
          break;
        }

        setQueue((prev) =>
          prev.map((item) =>
            item.id === currentItem.id
              ? { ...item, status: 'error', error: errorMessage }
              : item
          )
        );
        alert(`Fehler bei "${currentItem.fileName}":\n${errorMessage}`);
      }
    }

    setIsBatchRunning(false);
    setActiveQueueId(null);
  };

  const openQueueItemPreview = async (item: BatchQueueItem) => {
    let content = item.markdownResult || '';
    if (!content) {
      const historyItem = history.find(
        (entry) => entry.id === item.id || (item.filePath && entry.filePath === item.filePath)
      );
      if (historyItem) {
        content = await loadHistoryItemContent(historyItem);
      }
    }

    if (content) {
      setMarkdownResult(content);
      setPreviewFileName(item.fileName.replace(/\.pdf$/i, '.md'));
      setPreviewPdfPath(item.filePath);
      setActiveMainView('preview');
    }
  };

  return {
    queue,
    isBatchRunning,
    activeQueueId,
    addQueueItems,
    clearQueueItems,
    updateItemRange,
    removeQueueItem,
    clearQueue,
    cancelBatch,
    startBatch,
    openQueueItemPreview,
  };
}
