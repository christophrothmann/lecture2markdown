import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, Settings, ChevronDown } from 'lucide-react';
import { save as saveFileDialog } from '@tauri-apps/plugin-dialog';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ApiKeyModal, type ProviderType } from './components/ApiKeyModal';
import { Dropzone, type SelectedFileInfo } from './components/Dropzone';
import { BatchQueue, type BatchQueueItem } from './components/BatchQueue';
import { MarkdownPreview } from './components/MarkdownPreview';
import { HistorySidebar, type HistoryItem } from './components/HistorySidebar';

const PROVIDER_NAMES: Record<ProviderType, string> = {
  openai: 'OpenAI (GPT-4o)',
  google: 'Google (Gemini 2.0 Flash)',
  anthropic: 'Anthropic (Claude 3.7)',
  mistral: 'Mistral (Document OCR)',
};

export function App() {
  const [activeProvider, setActiveProvider] = useState<ProviderType>(() => {
    return (localStorage.getItem('l2m_active_provider') as ProviderType) || 'openai';
  });
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
  const [isKeyModalOpen, setIsKeyModalOpen] = useState<boolean>(false);

  // Batch Queue State
  const [queue, setQueue] = useState<BatchQueueItem[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState<boolean>(false);
  const [activeQueueId, setActiveQueueId] = useState<string | null>(null);

  // Single active conversion state for live progress & preview
  const [activeConvertingFile, setActiveConvertingFile] = useState<string>('');
  const [progress, setProgress] = useState<{ completed: number; total: number; lastModel: string; usedModels: string[] }>({
    completed: 0,
    total: 0,
    lastModel: '',
    usedModels: [],
  });

  const [markdownResult, setMarkdownResult] = useState<string | null>(null);
  const [previewFileName, setPreviewFileName] = useState<string>('');

  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('conversion_history') || '[]');
    } catch {
      return [];
    }
  });

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

  // Listen to Tauri events from Pure-Rust backend
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    listen<string>('python-event', (event) => {
      try {
        const payload = JSON.parse(event.payload);
        if (payload.type === 'start') {
          setProgress({ completed: 0, total: payload.total_pages, lastModel: '', usedModels: [] });
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
          setProgress((prev) => {
            const nextUsed = payload.model_used && payload.model_used !== 'cache-hit'
              ? [...prev.usedModels, payload.model_used]
              : prev.usedModels;
            return {
              completed: payload.completed,
              total: payload.total,
              lastModel: payload.model_used || prev.lastModel,
              usedModels: nextUsed,
            };
          });

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

  const handleClearHistory = () => {
    setHistory([]);
    localStorage.removeItem('conversion_history');
  };

  // Add multiple files to the batch queue
  const handleFilesSelected = async (selectedFiles: SelectedFileInfo[]) => {
    setMarkdownResult(null);
    const newItems: BatchQueueItem[] = [];

    for (const file of selectedFiles) {
      const id = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      let totalPages = 1;
      try {
        const count = await invoke<number>('get_pdf_page_count_native', { pdfPath: file.path });
        if (count && count > 0) totalPages = count;
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
      setActiveConvertingFile(item.fileName);

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
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: '',
        totalPages: targetCount,
        status: 'processing',
        progressCurrent: 0,
        progressTotal: targetCount,
      };

      setHistory((prev) => [inProgressItem, ...prev.filter((h) => h.id !== jobId && h.status !== 'processing')]);

      try {
        const markdown = await invoke<string>('convert_lecture_native', {
          pdfPath: item.filePath,
          outputPath: '',
          provider: activeProvider,
          apiKey: currentActiveKey,
          startPage: item.rangeMode === 'custom' ? targetStart : undefined,
          endPage: item.rangeMode === 'custom' ? targetEnd : undefined,
        });

        // Automatically save Markdown file next to PDF!
        const autoSavePath = item.filePath.replace(/\.pdf$/i, '.md');
        try {
          await writeTextFile(autoSavePath, markdown);
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

        // Update history
        setHistory((prev) => {
          const updated = prev.map((h) =>
            h.id === jobId
              ? {
                  ...h,
                  status: 'completed' as const,
                  content: markdown,
                  totalPages: targetCount,
                }
              : h
          );
          const toPersist = updated.filter((h) => h.status === 'completed' || !h.status).slice(0, 10);
          localStorage.setItem('conversion_history', JSON.stringify(toPersist));
          return updated;
        });

        // Set last result for optional live preview
        setMarkdownResult(markdown);
        setPreviewFileName(item.fileName.replace('.pdf', '.md'));
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
        await writeTextFile(filePath, markdownResult);
        alert(`Erfolgreich gespeichert unter:\n${filePath}`);
      }
    } catch {
      const blob = new Blob([markdownResult], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = previewFileName;
      link.click();
      URL.revokeObjectURL(url);
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
          <div className="p-2 bg-accent text-white rounded-xl shadow-lg">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-100 flex items-center gap-2">
              Lecture2Markdown
            </h1>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Active Provider Selector Badge */}
          <button
            onClick={() => setIsKeyModalOpen(true)}
            className="flex items-center space-x-2 px-3 py-1.5 bg-surface hover:bg-surface-hover border border-border rounded-xl text-xs font-semibold transition cursor-pointer"
            title="Provider wechseln / Key einrichten"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-slate-200">{PROVIDER_NAMES[activeProvider]}</span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>

          <button
            onClick={() => setIsKeyModalOpen(true)}
            className="p-2 bg-surface hover:bg-surface-hover border border-border text-slate-300 rounded-xl transition cursor-pointer"
            title="API-Key Einstellungen"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Layout */}
      <main className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-4 gap-6 max-w-7xl mx-auto w-full">
        {/* Left Column: Dropzone & Active Progress / Preview */}
        <div className="lg:col-span-3 space-y-6 flex flex-col">
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

          {/* State 3: Finished Markdown Preview */}
          {markdownResult && previewFileName && (
            <MarkdownPreview
              content={markdownResult}
              fileName={previewFileName}
              onSaveFile={handleSaveFileLocally}
              onNewConversion={() => {
                setMarkdownResult(null);
                setPreviewFileName('');
                setQueue([]);
              }}
            />
          )}
        </div>

        {/* Right Column: History Sidebar */}
        <div className="lg:col-span-1">
          <HistorySidebar
            items={history}
            onSelect={(item) => {
              setPreviewFileName(item.fileName.replace('.pdf', '.md'));
              setMarkdownResult(item.content);
            }}
            onClear={handleClearHistory}
          />
        </div>
      </main>

      {/* Multi-Provider API Key Modal */}
      <ApiKeyModal
        isOpen={isKeyModalOpen}
        activeProvider={activeProvider}
        providerKeys={providerKeys}
        onSelectProvider={handleSelectProvider}
        onSaveKey={handleSaveProviderKey}
        onClose={() => setIsKeyModalOpen(false)}
      />
    </div>
  );
}

export default App;
