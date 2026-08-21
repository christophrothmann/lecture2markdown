import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, Settings, CheckCircle, Sparkles, FileText, Play, RefreshCw, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { save as saveFileDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ApiKeyModal, type ProviderType } from './components/ApiKeyModal';
import { Dropzone } from './components/Dropzone';
import { ProgressDashboard } from './components/ProgressDashboard';
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

  const [selectedFilePath, setSelectedFilePath] = useState<string>('');
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [pageCount, setPageCount] = useState<number>(0);
  const [converting, setConverting] = useState<boolean>(false);
  const [progress, setProgress] = useState<{ completed: number; total: number; lastModel: string; usedModels: string[] }>({
    completed: 0,
    total: 0,
    lastModel: '',
    usedModels: [],
  });

  const [markdownResult, setMarkdownResult] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('conversion_history') || '[]');
    } catch {
      return [];
    }
  });

  // Load API Keys securely from Rust backend on startup
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

  const activeJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    listen<string>('python-event', (event) => {
      try {
        const payload = JSON.parse(event.payload);
        if (payload.type === 'start') {
          setProgress({ completed: 0, total: payload.total_pages, lastModel: '', usedModels: [] });
          setPageCount(payload.total_pages);
          setHistory((prev) =>
            prev.map((item) =>
              item.id === activeJobIdRef.current
                ? { ...item, totalPages: payload.total_pages, progressTotal: payload.total_pages }
                : item
            )
          );
        } else if (payload.type === 'progress') {
          setProgress((prev) => ({
            completed: payload.completed,
            total: payload.total,
            lastModel: payload.model_used,
            usedModels: payload.model_used ? [...prev.usedModels, payload.model_used] : prev.usedModels,
          }));
          setHistory((prev) =>
            prev.map((item) =>
              item.id === activeJobIdRef.current
                ? { ...item, progressCurrent: payload.completed, progressTotal: payload.total }
                : item
            )
          );
        }
      } catch {
        // Ignore unformatted logs
      }
    }).then((unlisten) => {
      unlistenFn = unlisten;
    });

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

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
  };

  const handleClearHistory = () => {
    setHistory([]);
    localStorage.removeItem('conversion_history');
  };

  const handleCancelConversion = async () => {
    try {
      await invoke('cancel_conversion_native');
    } catch (e) {
      console.error('Fehler beim Abbrechen:', e);
    }
    setConverting(false);
    if (activeJobIdRef.current) {
      setHistory((prev) => prev.filter((h) => h.id !== activeJobIdRef.current));
    }
  };

  const handleFileSelectedPath = async (filePath: string, fileName: string) => {
    setSelectedFilePath(filePath);
    setSelectedFileName(fileName);
    setMarkdownResult(null);
    setPageCount(0);
    try {
      const total = await invoke<number>('get_pdf_page_count_native', { pdfPath: filePath });
      setDetectedTotalPages(total);
      setStartPage(1);
      setEndPage(total);
      setRangeMode('all');
    } catch (e) {
      console.error('Fehler beim Ermitteln der Seitenzahl:', e);
    }
  };

  const handleResetSelectedFile = () => {
    setSelectedFilePath('');
    setSelectedFileName('');
    setPageCount(0);
    setDetectedTotalPages(0);
    setRangeMode('all');
    setMarkdownResult(null);
    setConverting(false);
  };

  const currentActiveKey = providerKeys[activeProvider] || '';

  const handleStartConversion = async () => {
    if (!selectedFilePath || !currentActiveKey) return;
    const jobId = Date.now().toString();
    activeJobIdRef.current = jobId;

    const targetStart = rangeMode === 'custom' ? startPage : 1;
    const targetEnd = rangeMode === 'custom' ? endPage : detectedTotalPages || 1;
    const targetCount = Math.max(1, targetEnd - targetStart + 1);

    setConverting(true);
    setMarkdownResult(null);

    const inProgressItem: HistoryItem = {
      id: jobId,
      fileName: selectedFileName,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content: '',
      totalPages: targetCount,
      status: 'processing',
      progressCurrent: 0,
      progressTotal: targetCount,
    };

    setHistory((prev) => [inProgressItem, ...prev.filter((h) => h.id !== jobId && h.status !== 'processing')]);

    try {
      const realGeneratedMarkdown = await invoke<string>('convert_lecture_native', {
        pdfPath: selectedFilePath,
        outputPath: '',
        provider: activeProvider,
        apiKey: currentActiveKey,
        startPage: rangeMode === 'custom' ? targetStart : undefined,
        endPage: rangeMode === 'custom' ? targetEnd : undefined,
      });

      setMarkdownResult(realGeneratedMarkdown);
      setConverting(false);

      setHistory((prev) => {
        const updated = prev.map((item) =>
          item.id === jobId
            ? {
                ...item,
                status: 'completed' as const,
                content: realGeneratedMarkdown,
                totalPages: progress.total || targetCount || item.totalPages || 1,
              }
            : item
        );
        const toPersist = updated.filter((h) => h.status === 'completed' || !h.status).slice(0, 10);
        localStorage.setItem('conversion_history', JSON.stringify(toPersist));
        return updated;
      });
    } catch (error: any) {
      if (error && error.includes('abgebrochen')) {
        // Silent cancel without alert
      } else {
        alert(`Fehler bei der Konvertierung:\n${error}`);
      }
      setConverting(false);
      setHistory((prev) => prev.filter((item) => item.id !== jobId));
    }
  };

  const handleSaveFileLocally = async () => {
    if (!markdownResult || !selectedFileName) return;

    const defaultName = `${selectedFileName.replace('.pdf', '')}.md`;

    try {
      const filePath = await saveFileDialog({
        defaultPath: defaultName,
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
      link.download = defaultName;
      link.click();
      URL.revokeObjectURL(url);
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
          {/* State 1: Dropzone (No File selected) */}
          {!selectedFilePath && !converting && !markdownResult && (
            <Dropzone onFileSelectedPath={handleFileSelectedPath} disabled={!currentActiveKey} />
          )}

          {/* State 2: Selected File Card */}
          {selectedFilePath && !converting && !markdownResult && (
            <div className="glass-card rounded-2xl p-8 space-y-6 text-center">
              <div className="p-4 bg-card border border-border rounded-2xl w-16 h-16 mx-auto flex items-center justify-center text-accent">
                <FileText className="w-8 h-8" />
              </div>

              <div>
                <h3 className="text-lg font-bold text-slate-100">{selectedFileName}</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Bereit zur Konvertierung via <strong className="text-slate-200">{PROVIDER_NAMES[activeProvider]}</strong>
                  {detectedTotalPages > 0 && <span> • <strong>{detectedTotalPages} Folien erkannt</strong></span>}
                </p>
              </div>

              {/* Page Range Filter Card */}
              {detectedTotalPages > 0 && (
                <div className="bg-surface/80 border border-border rounded-xl p-4 max-w-sm mx-auto space-y-3 text-left">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-accent" />
                      Seitenbereich
                    </span>
                    <div className="flex bg-card rounded-lg p-0.5 border border-border text-[11px]">
                      <button
                        onClick={() => {
                          setRangeMode('all');
                          setStartPage(1);
                          setEndPage(detectedTotalPages);
                        }}
                        className={`px-2.5 py-1 rounded-md transition font-medium cursor-pointer ${
                          rangeMode === 'all'
                            ? 'bg-accent text-white font-bold'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Alle ({detectedTotalPages})
                      </button>
                      <button
                        onClick={() => setRangeMode('custom')}
                        className={`px-2.5 py-1 rounded-md transition font-medium cursor-pointer ${
                          rangeMode === 'custom'
                            ? 'bg-accent text-white font-bold'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Benutzerdefiniert
                      </button>
                    </div>
                  </div>

                  {rangeMode === 'custom' && (
                    <div className="pt-1 space-y-2">
                      <div className="flex items-center justify-center space-x-3 text-xs">
                        <div className="flex items-center space-x-1.5">
                          <span className="text-slate-400">Von:</span>
                          <input
                            type="number"
                            min={1}
                            max={endPage}
                            value={startPage}
                            onChange={(e) => {
                              const val = parseInt(e.target.value) || 1;
                              setStartPage(Math.max(1, Math.min(val, endPage)));
                            }}
                            className="w-16 bg-card border border-border rounded-lg px-2 py-1 text-center font-mono font-bold text-slate-100 focus:outline-none focus:border-accent"
                          />
                        </div>
                        <span className="text-slate-500 font-bold">bis</span>
                        <div className="flex items-center space-x-1.5">
                          <span className="text-slate-400">Bis:</span>
                          <input
                            type="number"
                            min={startPage}
                            max={detectedTotalPages}
                            value={endPage}
                            onChange={(e) => {
                              const val = parseInt(e.target.value) || startPage;
                              setEndPage(Math.max(startPage, Math.min(val, detectedTotalPages)));
                            }}
                            className="w-16 bg-card border border-border rounded-lg px-2 py-1 text-center font-mono font-bold text-slate-100 focus:outline-none focus:border-accent"
                          />
                        </div>
                      </div>

                      <div className="text-center text-[11px] text-emerald-400 font-medium">
                        {endPage - startPage + 1} von {detectedTotalPages} Folien ausgewählt
                        {endPage - startPage + 1 < detectedTotalPages && (
                          <span className="text-slate-400">
                            {' '}
                            (spart ~{Math.round((1 - (endPage - startPage + 1) / detectedTotalPages) * 100)}% Kosten & Zeit)
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-center space-x-4 pt-2">
                <button
                  onClick={handleResetSelectedFile}
                  className="px-5 py-3 bg-surface hover:bg-surface-hover border border-border text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4 text-slate-400" /> Andere Datei auswählen
                </button>

                <button
                  onClick={handleStartConversion}
                  className="px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-xl text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-lg shadow-accent/20"
                >
                  <Play className="w-4 h-4 fill-white" /> Konvertierung starten
                </button>
              </div>
            </div>
          )}

          {/* State 3: Active Conversion Dashboard */}
          {converting && selectedFileName && (
            <ProgressDashboard
              fileName={selectedFileName}
              completedPages={progress.completed}
              totalPages={progress.total}
              lastModelUsed={progress.lastModel || PROVIDER_NAMES[activeProvider]}
              usedModels={progress.usedModels}
              onCancel={handleCancelConversion}
            />
          )}

          {/* State 4: Finished Markdown Preview */}
          {markdownResult && selectedFileName && (
            <MarkdownPreview
              content={markdownResult}
              fileName={selectedFileName.replace('.pdf', '.md')}
              onSaveFile={handleSaveFileLocally}
              onNewConversion={handleResetSelectedFile}
            />
          )}
        </div>

        {/* Right Column: History Sidebar */}
        <div className="lg:col-span-1">
          <HistorySidebar
            items={history}
            onSelect={(item) => {
              setSelectedFileName(item.fileName);
              setSelectedFilePath(item.fileName);
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
