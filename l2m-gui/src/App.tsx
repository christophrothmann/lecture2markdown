import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { BookOpen, Settings, Sparkles, Zap, Loader2, PlusCircle, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { save as saveFileDialog, open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useTranslation } from 'react-i18next';
import type { ProviderType } from './components/ApiKeyModal';
import { Dropzone, type SelectedFileInfo } from './components/Dropzone';
import { BatchQueue, type BatchQueueItem } from './components/BatchQueue';
import { HistorySidebar, type HistoryItem } from './components/HistorySidebar';
import {
  loadHistoryMeta,
  saveHistoryMeta,
  loadHistoryItemContent,
  saveHistoryItemContent,
  deleteHistoryItemContent,
  clearAllHistoryStorage,
  deduplicateHistory,
} from './utils/historyStorage';
import { extractPdfSlidesWebp, loadPdfDocument } from './utils/pdfRenderer';

// Lazy-loaded heavy components for instant startup (0ms initial bundle delay)
const MarkdownPreview = lazy(() =>
  import('./components/MarkdownPreview').then((m) => ({ default: m.MarkdownPreview }))
);
const ApiKeyModal = lazy(() =>
  import('./components/ApiKeyModal').then((m) => ({ default: m.ApiKeyModal }))
);
const QuickDropOverlay = lazy(() =>
  import('./components/QuickDropOverlay').then((m) => ({ default: m.QuickDropOverlay }))
);

const PROVIDER_NAMES: Record<ProviderType, string> = {
  openai: 'OpenAI (GPT-4o)',
  google: 'Google (Gemini 2.0 Flash)',
  anthropic: 'Anthropic (Claude 3.7)',
  mistral: 'Mistral (Document OCR)',
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent || '');
const quickDropShortcut = isMac ? '⌘ + ⇧ + L' : 'Ctrl + Shift + L';

export function App() {
  const { t } = useTranslation();
  const [activeProvider, setActiveProvider] = useState<ProviderType>(() => {
    return (localStorage.getItem('l2m_active_provider') as ProviderType) || 'openai';
  });
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
  const [isKeyModalOpen, setIsKeyModalOpen] = useState<boolean>(false);
  const [isQuickDropOpen, setIsQuickDropOpen] = useState<boolean>(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(true);

  // Background Auto-Update State
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);

  // Batch Queue State
  const [queue, setQueue] = useState<BatchQueueItem[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState<boolean>(false);
  const [activeQueueId, setActiveQueueId] = useState<string | null>(null);

  // Markdown Preview & Selected History item
  const [markdownResult, setMarkdownResult] = useState<string | null>(null);
  const [previewFileName, setPreviewFileName] = useState<string>('');
  const [previewPdfPath, setPreviewPdfPath] = useState<string | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryItem[]>(() => loadHistoryMeta());

  const cancelBatchRef = useRef<boolean>(false);
  const activeJobIdRef = useRef<string | null>(null);

  // Load API Keys from Rust backend on startup
  useEffect(() => {
    invoke<Record<string, string>>('get_api_keys_native')
      .then((keys) => {
        setProviderKeys(keys || {});
        const currentKey = keys ? keys[activeProvider] : '';
        if (!currentKey) {
          setIsKeyModalOpen(true);
        }
      })
      .catch(() => {
        setIsKeyModalOpen(true);
      });
  }, [activeProvider]);

  // Non-blocking asynchronous update check (0ms delay for app startup)
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const update = await check();
        if (update && update.available) {
          setUpdateAvailable(true);
        }
      } catch (err) {
        console.warn('[Updater] Check failed:', err);
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  const handleApplyUpdate = async () => {
    setIsUpdating(true);
    try {
      const update = await check();
      if (update && update.available) {
        await update.downloadAndInstall();
        await relaunch();
      }
    } catch (e) {
      alert(t('header.update_error', { error: String(e) }));
      setIsUpdating(false);
    }
  };

  // Shortcut listener for Spotlight Quick-Drop (Native Rust Global Hook + In-App Fallback)
  useEffect(() => {
    let unlistenEvent: (() => void) | null = null;

    // Listen to native global shortcut triggered by Rust backend
    listen('open-quick-drop', () => {
      setIsQuickDropOpen(true);
    }).then((unlisten) => {
      unlistenEvent = unlisten;
    });

    // In-app key listener
    const handleLocalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        setIsQuickDropOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleLocalKey);

    return () => {
      if (unlistenEvent) unlistenEvent();
      window.removeEventListener('keydown', handleLocalKey);
    };
  }, []);

  // Listen to Tauri events from Pure-Rust backend
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
          // Update active queue item progress
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
        // Ignore parsing error
      }
    }).then((unlisten) => {
      unlistenFn = unlisten;
    });

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, [activeQueueId]);

  const handleSaveProviderKey = async (provider: ProviderType, key: string) => {
    setProviderKeys((prev) => ({ ...prev, [provider]: key }));
    try {
      await invoke('save_api_key_native', { provider, key });
    } catch (e) {
      console.error('Key konnte nicht im Backend gespeichert werden:', e);
    }
  };

  const handleSelectProvider = (provider: ProviderType) => {
    setActiveProvider(provider);
    localStorage.setItem('l2m_active_provider', provider);
  };

  const handleQuickDropSuccess = (item: HistoryItem) => {
    if (item.content) {
      saveHistoryItemContent(item.id, item.content);
    }
    setHistory((prev) => {
      const itemKey = (item.filePath || item.fileName.replace(/\.(pdf|md)$/i, '')).toLowerCase().trim();
      const filtered = prev.filter((h) => {
        const hKey = (h.filePath || h.fileName.replace(/\.(pdf|md)$/i, '')).toLowerCase().trim();
        return hKey !== itemKey;
      });
      const leanItem: HistoryItem = { ...item, content: '' };
      const updated = [leanItem, ...filtered];
      saveHistoryMeta(updated);
      return updated;
    });
  };

  const handleClearHistory = () => {
    setHistory([]);
    clearAllHistoryStorage();
    if (selectedHistoryId) {
      setMarkdownResult(null);
      setPreviewFileName('');
      setSelectedHistoryId(null);
    }
  };

  const handleDeleteCurrentHistoryItem = () => {
    if (!selectedHistoryId) return;
    deleteHistoryItemContent(selectedHistoryId);
    const updated = history.filter((h) => h.id !== selectedHistoryId);
    setHistory(updated);
    saveHistoryMeta(updated);
    setMarkdownResult(null);
    setPreviewFileName('');
    setSelectedHistoryId(null);
  };

  const handleNewConversion = () => {
    setMarkdownResult(null);
    setPreviewFileName('');
    setPreviewPdfPath(null);
    setSelectedHistoryId(null);
    setQueue([]);
  };

  // Add multiple files to the batch queue
  const handleFilesSelected = async (selectedFiles: SelectedFileInfo[]) => {
    setMarkdownResult(null);
    setSelectedHistoryId(null);
    const newItems: BatchQueueItem[] = [];

    for (const file of selectedFiles) {
      const id = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      let totalPages = 1;
      try {
        const { numPages } = await loadPdfDocument(file.path);
        if (numPages && numPages > 0) totalPages = numPages;
      } catch (e) {
        console.error('Seitenzahl-Ermittlung fehlgeschlagen für:', file.name, e);
      }

      newItems.push({
        id,
        filePath: file.path,
        fileName: file.name,
        totalPages,
        startPage: 1,
        endPage: totalPages,
        rangeMode: 'all',
        status: 'pending',
      });
    }

    setQueue((prev) => [...prev, ...newItems]);
  };

  const handleUpdateItemRange = (id: string, start: number, end: number, mode: 'all' | 'custom') => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, startPage: start, endPage: end, rangeMode: mode } : item))
    );
  };

  const handleRemoveQueueItem = (id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearQueue = () => {
    setQueue([]);
  };

  const handleCancelBatch = async () => {
    cancelBatchRef.current = true;
    try {
      await invoke('cancel_conversion_native');
    } catch (e) {
      console.error('Fehler beim Abbrechen:', e);
    }
    setIsBatchRunning(false);
    setActiveQueueId(null);
    if (activeJobIdRef.current) {
      setHistory((prev) => prev.filter((h) => h.id !== activeJobIdRef.current));
    }
  };

  const currentActiveKey = providerKeys[activeProvider] || '';

  // Sequentially execute batch queue
  const handleStartBatch = async () => {
    if (queue.length === 0 || !currentActiveKey) return;
    setIsBatchRunning(true);
    cancelBatchRef.current = false;

    for (const item of queue) {
      if (cancelBatchRef.current) break;
      if (item.status === 'completed') continue;

      setActiveQueueId(item.id);

      const targetStart = item.rangeMode === 'custom' ? item.startPage : 1;
      const targetEnd = item.rangeMode === 'custom' ? item.endPage : item.totalPages;
      const targetCount = Math.max(1, targetEnd - targetStart + 1);

      // Update queue item status to processing
      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id
            ? { ...q, status: 'processing', progressCurrent: 0, progressTotal: targetCount }
            : q
        )
      );

      const jobId = Date.now().toString();
      activeJobIdRef.current = jobId;

      const inProgressItem: HistoryItem = {
        id: jobId,
        fileName: item.fileName,
        filePath: item.filePath,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: '',
        totalPages: targetCount,
        status: 'processing',
        progressCurrent: 0,
        progressTotal: targetCount,
      };

      const inProgressKey = (item.filePath || item.fileName.replace(/\.(pdf|md)$/i, '')).toLowerCase().trim();
      setHistory((prev) => {
        const filtered = prev.filter((h) => {
          const hKey = (h.filePath || h.fileName.replace(/\.(pdf|md)$/i, '')).toLowerCase().trim();
          return hKey !== inProgressKey && h.id !== jobId && h.status !== 'processing';
        });
        return [inProgressItem, ...filtered];
      });

      try {
        const slides = await extractPdfSlidesWebp(
          item.filePath,
          item.rangeMode === 'custom' ? targetStart : undefined,
          item.rangeMode === 'custom' ? targetEnd : undefined
        );

        const markdown = await invoke<string>('transcribe_slides_native', {
          slides,
          provider: activeProvider,
          apiKey: currentActiveKey,
          fileName: item.fileName,
        });

        // Automatically save Markdown file next to PDF!
        const autoSavePath = item.filePath.replace(/\.pdf$/i, '.md');
        try {
          await invoke('save_text_file_native', {
            filePath: autoSavePath,
            content: markdown,
          });
        } catch (saveErr) {
          console.warn('Auto-Save fehlgeschlagen:', saveErr);
        }

        // Update queue item
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? { ...q, status: 'completed', markdownResult: markdown }
              : q
          )
        );

        // Update history with strict deduplication
        saveHistoryItemContent(jobId, markdown);
        setHistory((prev) => {
          const updated = prev.map((h) =>
            h.id === jobId
              ? {
                  ...h,
                  status: 'completed' as const,
                  content: '',
                  totalPages: targetCount,
                  filePath: item.filePath,
                }
              : h
          );
          const deduped = deduplicateHistory(updated);
          saveHistoryMeta(deduped);
          return deduped;
        });

        // Set last result for optional live preview
        setMarkdownResult(markdown);
        setPreviewFileName(item.fileName.replace('.pdf', '.md'));
        setPreviewPdfPath(item.filePath);
        setSelectedHistoryId(jobId);
      } catch (err: any) {
        if (cancelBatchRef.current || (err && err.includes('abgebrochen'))) {
          setQueue((prev) =>
            prev.map((q) => (q.id === item.id ? { ...q, status: 'pending' } : q))
          );
          break;
        } else {
          setQueue((prev) =>
            prev.map((q) =>
              q.id === item.id
                ? { ...q, status: 'error', error: String(err) }
                : q
            )
          );
          alert(`Fehler bei "${item.fileName}":\n${err}`);
        }
      }
    }

    setIsBatchRunning(false);
    setActiveQueueId(null);
  };

  const handleSaveFileLocally = async () => {
    if (!markdownResult || !previewFileName) return;

    try {
      const filePath = await saveFileDialog({
        defaultPath: previewFileName,
        filters: [{ name: 'Markdown Datei', extensions: ['md'] }],
      });

      if (filePath) {
        await invoke('save_text_file_native', {
          filePath,
          content: markdownResult,
        });
      }
    } catch (e) {
      console.error('Speichern fehlgeschlagen:', e);
      try {
        const blob = new Blob([markdownResult], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = previewFileName;
        link.click();
        URL.revokeObjectURL(url);
      } catch {}
    }
  };

  const handleAddMoreFilesDialog = async () => {
    try {
      const selected = await openFileDialog({
        multiple: true,
        filters: [{ name: 'PDF Vorlesungen', extensions: ['pdf'] }],
      });

      if (selected) {
        const filePaths = Array.isArray(selected) ? selected : [selected];
        const files: SelectedFileInfo[] = filePaths
          .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
          .map((p) => {
            const pathParts = p.split(/[\/\\]/);
            const fileName = pathParts[pathParts.length - 1] || 'Vorlesung.pdf';
            return { path: p, name: fileName };
          });

        if (files.length > 0) {
          await handleFilesSelected(files);
        }
      }
    } catch (e) {
      console.error('Dateidialog Fehler:', e);
    }
  };

  return (
    <div className="min-h-screen bg-background text-slate-100 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="glass-card border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {/* Sidebar Toggle (Left Navigation) */}
          <button
            onClick={() => setIsHistoryOpen((prev) => !prev)}
            className={`p-2 border rounded-xl transition cursor-pointer ${
              isHistoryOpen
                ? 'bg-surface hover:bg-surface-hover border-border text-slate-200'
                : 'bg-surface/50 hover:bg-surface border-border/50 text-slate-400'
            }`}
            title={isHistoryOpen ? t('history.hide_sidebar') : t('history.show_sidebar')}
          >
            {isHistoryOpen ? (
              <PanelLeftClose className="w-4 h-4 text-slate-300" />
            ) : (
              <PanelLeftOpen className="w-4 h-4 text-slate-400" />
            )}
          </button>

          <div className="p-2 bg-accent text-white rounded-xl shadow-lg">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-100 flex items-center gap-2">
              Lecture2Markdown
            </h1>
            <p className="text-[10px] font-medium text-slate-400">v{__APP_VERSION__}</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Update Available Badge / Action */}
          {updateAvailable && (
            <button
              onClick={handleApplyUpdate}
              disabled={isUpdating}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-semibold transition cursor-pointer shadow-sm"
              title={t('header.update_tooltip')}
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isUpdating ? t('header.loading_update') : t('header.update_available')}</span>
            </button>
          )}

          {/* New Conversion Button (Visible in Detail View, left of Quick-Drop) */}
          {markdownResult && (
            <button
              onClick={handleNewConversion}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-surface hover:bg-surface-hover border border-border text-slate-200 rounded-xl text-xs font-semibold transition cursor-pointer shadow-sm"
              title={t('preview.new_conversion')}
            >
              <PlusCircle className="w-3.5 h-3.5 text-accent" />
              <span className="hidden sm:inline">{t('preview.new_conversion')}</span>
            </button>
          )}

          {/* Quick-Drop Spotlight Button */}
          <button
            onClick={() => setIsQuickDropOpen(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-surface hover:bg-surface-hover border border-border rounded-xl text-xs font-semibold transition cursor-pointer text-slate-200"
            title={t('header.quick_drop_title', { shortcut: quickDropShortcut })}
          >
            <Zap className="w-3.5 h-3.5 text-accent" />
            <span className="hidden sm:inline">{t('header.quick_drop')}</span>
          </button>

          {/* Active Provider Status Badge (Informational only) */}
          <div
            className="flex items-center space-x-2 px-3 py-1.5 bg-surface border border-border rounded-xl text-xs font-semibold select-none cursor-default"
            title={`${t('header.active_model_label')}: ${PROVIDER_NAMES[activeProvider]}`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-slate-200">{PROVIDER_NAMES[activeProvider]}</span>
          </div>

          <button
            onClick={() => setIsKeyModalOpen(true)}
            className="p-2 bg-surface hover:bg-surface-hover border border-border text-slate-300 rounded-xl transition cursor-pointer"
            title={t('header.settings_title')}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Layout - Full window width with flexible sidebar */}
      <main className="flex-1 px-6 py-5 flex flex-col lg:flex-row gap-6 w-full items-stretch h-[calc(100vh-76px)] min-h-0">
        {/* Left Column: History Sidebar (Pinned to left, responsive fixed width) */}
        {isHistoryOpen && (
          <div className="w-full lg:w-80 shrink-0 flex flex-col h-full min-h-0">
            <HistorySidebar
              items={history}
              selectedItemId={selectedHistoryId}
              onSelect={async (item) => {
                setSelectedHistoryId(item.id);
                setPreviewFileName(item.fileName.replace('.pdf', '.md'));
                setPreviewPdfPath(item.filePath || null);
                const content = await loadHistoryItemContent(item);
                setMarkdownResult(content);
              }}
              onClear={handleClearHistory}
              onResolveContent={(item) => loadHistoryItemContent(item)}
            />
          </div>
        )}

        {/* Right / Main Column: Dropzone & Active Progress / Preview (Full remaining width) */}
        <div className="flex-1 min-w-0 flex flex-col h-full space-y-6">
          {/* State 1: Dropzone (No files in queue and no preview) */}
          {queue.length === 0 && !markdownResult && (
            <Dropzone onFilesSelected={handleFilesSelected} disabled={!currentActiveKey} />
          )}

          {/* State 2: Batch Queue Dashboard */}
          {queue.length > 0 && !markdownResult && (
            <BatchQueue
              items={queue}
              isConverting={isBatchRunning}
              activeProviderName={PROVIDER_NAMES[activeProvider]}
              onUpdateItemRange={handleUpdateItemRange}
              onRemoveItem={handleRemoveQueueItem}
              onAddMoreFiles={handleAddMoreFilesDialog}
              onClearQueue={handleClearQueue}
              onStartBatch={handleStartBatch}
              onCancelBatch={handleCancelBatch}
            />
          )}

          {/* State 3: Finished Markdown Preview (Full window width) */}
          {markdownResult && previewFileName && (
            <Suspense
              fallback={
                <div className="glass-card rounded-2xl p-12 flex flex-col items-center justify-center space-y-3 min-h-[400px]">
                  <Loader2 className="w-8 h-8 animate-spin text-accent" />
                  <span className="text-xs text-slate-400">{t('preview.loading_preview')}</span>
                </div>
              }
            >
              <MarkdownPreview
                content={markdownResult}
                fileName={previewFileName}
                pdfPath={previewPdfPath}
                onSaveFile={handleSaveFileLocally}
                onNewConversion={handleNewConversion}
                onDelete={selectedHistoryId ? handleDeleteCurrentHistoryItem : undefined}
              />
            </Suspense>
          )}
        </div>
      </main>

      {/* Multi-Provider API Key Modal */}
      {isKeyModalOpen && (
        <Suspense fallback={null}>
          <ApiKeyModal
            isOpen={isKeyModalOpen}
            activeProvider={activeProvider}
            providerKeys={providerKeys}
            onSelectProvider={handleSelectProvider}
            onSaveKey={handleSaveProviderKey}
            onClose={() => setIsKeyModalOpen(false)}
          />
        </Suspense>
      )}

      {/* Spotlight Quick-Drop Overlay */}
      {isQuickDropOpen && (
        <Suspense fallback={null}>
          <QuickDropOverlay
            isOpen={isQuickDropOpen}
            onClose={() => setIsQuickDropOpen(false)}
            activeProvider={activeProvider}
            apiKey={currentActiveKey}
            onSuccess={handleQuickDropSuccess}
          />
        </Suspense>
      )}
    </div>
  );
}

export default App;
