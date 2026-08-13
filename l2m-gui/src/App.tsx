import React, { useState, useEffect } from 'react';
import { BookOpen, Settings, CheckCircle, Sparkles, FileText, Play, RefreshCw } from 'lucide-react';
import { save as saveFileDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ApiKeyModal } from './components/ApiKeyModal';
import { Dropzone } from './components/Dropzone';
import { ProgressDashboard } from './components/ProgressDashboard';
import { MarkdownPreview } from './components/MarkdownPreview';
import { HistorySidebar, type HistoryItem } from './components/HistorySidebar';

export function App() {
  const [apiKey, setApiKey] = useState<string>('');
  const [isKeyModalOpen, setIsKeyModalOpen] = useState<boolean>(false);
  
  const [selectedFilePath, setSelectedFilePath] = useState<string>('');
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [pageCount, setPageCount] = useState<number>(0);
  const [converting, setConverting] = useState<boolean>(false);
  const [progress, setProgress] = useState<{ completed: number; total: number; lastModel: string }>({
    completed: 0,
    total: 0,
    lastModel: '',
  });
  
  const [markdownResult, setMarkdownResult] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('conversion_history') || '[]');
    } catch {
      return [];
    }
  });

  // Load API Key securely from Rust backend store on startup
  useEffect(() => {
    invoke<string>('get_api_key_native')
      .then((storedKey) => {
        if (storedKey) {
          setApiKey(storedKey);
        } else {
          setIsKeyModalOpen(true);
        }
      })
      .catch(() => {
        setIsKeyModalOpen(true);
      });
  }, []);

  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    listen<string>('python-event', (event) => {
      try {
        const payload = JSON.parse(event.payload);
        if (payload.type === 'start') {
          setProgress({ completed: 0, total: payload.total_pages, lastModel: 'gpt-4o-mini' });
          setPageCount(payload.total_pages);
        } else if (payload.type === 'progress') {
          setProgress({
            completed: payload.completed,
            total: payload.total,
            lastModel: payload.model_used,
          });
        }
      } catch {
        // Ignoriere unformatierte Logs
      }
    }).then((unlisten) => {
      unlistenFn = unlisten;
    });

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const handleSaveApiKey = async (key: string) => {
    setApiKey(key);
    try {
      await invoke('save_api_key_native', { key });
    } catch (e) {
      console.error('Key konnte nicht im Backend gespeichert werden:', e);
    }
  };

  const handleClearHistory = () => {
    setHistory([]);
    localStorage.removeItem('conversion_history');
  };

  const handleFileSelectedPath = (filePath: string, fileName: string) => {
    setSelectedFilePath(filePath);
    setSelectedFileName(fileName);
    setMarkdownResult(null);
    setPageCount(0);
  };

  const handleResetSelectedFile = () => {
    setSelectedFilePath('');
    setSelectedFileName('');
    setPageCount(0);
    setMarkdownResult(null);
    setConverting(false);
  };

  const handleStartConversion = async () => {
    if (!selectedFilePath || !apiKey) return;
    setConverting(true);
    setMarkdownResult(null);

    try {
      const realGeneratedMarkdown = await invoke<string>('convert_lecture_native', {
        pdfPath: selectedFilePath,
        outputPath: '',
        apiKey: apiKey,
      });

      setMarkdownResult(realGeneratedMarkdown);
      setConverting(false);

      const newItem: HistoryItem = {
        id: Date.now().toString(),
        fileName: selectedFileName,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        content: realGeneratedMarkdown,
        totalPages: progress.total || pageCount || 1,
      };

      setHistory((prev) => {
        const updated = [newItem, ...prev.slice(0, 9)];
        localStorage.setItem('conversion_history', JSON.stringify(updated));
        return updated;
      });
    } catch (error: any) {
      alert(`Fehler bei der echten Python-Konvertierung:\n${error}`);
      setConverting(false);
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
              Lecture2Markdown <Sparkles className="w-4 h-4 text-amber-400" />
            </h1>
            <p className="text-[11px] text-slate-400">PDF-Vorlesungen in halluzinationsfreies Markdown umwandeln</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {apiKey ? (
            <div className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl text-xs font-semibold">
              <CheckCircle className="w-3.5 h-3.5" />
              <span>API-Key Aktiv</span>
            </div>
          ) : null}

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
            <Dropzone onFileSelectedPath={handleFileSelectedPath} disabled={!apiKey} />
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
                  Bereit zur Konvertierung ({selectedFilePath})
                </p>
              </div>

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
              lastModelUsed={progress.lastModel}
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

      {/* API Key Modal */}
      <ApiKeyModal
        isOpen={isKeyModalOpen}
        apiKey={apiKey}
        onSaveKey={handleSaveApiKey}
        onClose={() => setIsKeyModalOpen(false)}
      />
    </div>
  );
}

export default App;
