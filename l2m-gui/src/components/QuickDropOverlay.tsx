import React, { useState, useEffect } from 'react';
import { Sparkles, X, FileText, Loader2, CheckCircle2, Zap, UploadCloud } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { sendNotification, isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import type { ProviderType } from './ApiKeyModal';
import type { HistoryItem } from './HistorySidebar';

interface QuickDropOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  activeProvider: ProviderType;
  apiKey: string;
  onSuccess?: (item: HistoryItem) => void;
}

export const QuickDropOverlay: React.FC<QuickDropOverlayProps> = ({
  isOpen,
  onClose,
  activeProvider,
  apiKey,
  onSuccess,
}) => {
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [currentFileName, setCurrentFileName] = useState<string>('');
  const [progressCurrent, setProgressCurrent] = useState<number>(0);
  const [progressTotal, setProgressTotal] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Native OS Drag & Drop listener via Tauri v2 Webview
  useEffect(() => {
    if (!isOpen) return;

    let unlistenFn: (() => void) | null = null;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'enter' || event.payload.type === 'over') {
          setIsDragging(true);
        } else if (event.payload.type === 'leave') {
          setIsDragging(false);
        } else if (event.payload.type === 'drop') {
          setIsDragging(false);
          const paths = event.payload.paths;
          if (paths && paths.length > 0) {
            const firstPdf = paths.find((p) => p.toLowerCase().endsWith('.pdf'));
            if (firstPdf) {
              const name = firstPdf.split(/[\/\\]/).pop() || 'Vorlesung.pdf';
              handleProcessFile(firstPdf, name);
            } else {
              alert('Bitte ziehe eine gültige .pdf-Vorlesungsdatei hierher.');
            }
          }
        }
      })
      .then((unlisten) => {
        unlistenFn = unlisten;
      });

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, [isOpen, apiKey, activeProvider]);

  // Listen to real-time progress events from backend
  useEffect(() => {
    if (!isOpen || status !== 'processing') return;

    let unlistenFn: (() => void) | null = null;

    listen<string>('python-event', (event) => {
      try {
        const payload = JSON.parse(event.payload);
        if (payload.type === 'start') {
          setProgressTotal(payload.total_pages || 1);
          setProgressCurrent(0);
        } else if (payload.type === 'progress') {
          setProgressCurrent(payload.completed || 0);
          if (payload.total) setProgressTotal(payload.total);
        }
      } catch {}
    }).then((unlisten) => {
      unlistenFn = unlisten;
    });

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, [isOpen, status]);

  // Subtle web audio chime on completion
  const playSuccessChime = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    } catch {}
  };

  const handleProcessFile = async (filePath: string, fileName: string) => {
    if (!apiKey) {
      alert('Bitte richte zuerst deinen API-Key in den Einstellungen ein.');
      onClose();
      return;
    }

    setStatus('processing');
    setCurrentFileName(fileName);
    setProgressCurrent(0);
    setProgressTotal(0);

    try {
      const markdown = await invoke<string>('convert_lecture_native', {
        pdfPath: filePath,
        outputPath: '',
        provider: activeProvider,
        apiKey,
      });

      // 1. Auto-Save Markdown next to PDF via native Rust
      const autoSavePath = filePath.replace(/\.pdf$/i, '.md');
      try {
        await invoke('save_text_file_native', {
          filePath: autoSavePath,
          content: markdown,
        });
      } catch (saveErr) {
        console.warn('Auto-save failed:', saveErr);
      }

      // 2. Put pure file descriptor on system clipboard
      await invoke('copy_file_to_clipboard_native', {
        fileName: fileName.replace(/\.pdf$/i, '.md'),
        content: markdown,
      });

      // 3. Audio & Notification feedback
      playSuccessChime();
      let hasPerm = await isPermissionGranted();
      if (!hasPerm) {
        const perm = await requestPermission();
        hasPerm = perm === 'granted';
      }
      if (hasPerm) {
        sendNotification({
          title: 'Lecture2Markdown',
          body: `✅ ${fileName.replace(/\.pdf$/i, '.md')} liegt im Clipboard bereit!`,
        });
      }

      // 4. Add to history
      if (onSuccess) {
        onSuccess({
          id: Date.now().toString(),
          fileName: fileName.replace(/\.pdf$/i, '.md'),
          filePath,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: markdown,
          totalPages: progressTotal || 1,
          status: 'completed',
        });
      }

      setStatus('success');
      setTimeout(() => {
        setStatus('idle');
        onClose();
      }, 1600);
    } catch (err: any) {
      console.error('Quick drop failed:', err);
      setStatus('error');
      setErrorMessage(String(err));
      setTimeout(() => {
        setStatus('idle');
      }, 3500);
    }
  };

  const handleClickPickFile = async () => {
    if (status === 'processing') return;

    try {
      const selected = await openFileDialog({
        multiple: false,
        filters: [{ name: 'PDF Vorlesungen', extensions: ['pdf'] }],
      });

      if (selected && typeof selected === 'string') {
        const name = selected.split(/[\/\\]/).pop() || 'Vorlesung.pdf';
        handleProcessFile(selected, name);
      }
    } catch {}
  };

  const percent = progressTotal > 0 ? Math.round((progressCurrent / progressTotal) * 100) : 0;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
      <div
        className={`w-full max-w-lg glass-card rounded-2xl p-6 border shadow-2xl transition-all duration-200 ${
          isDragging
            ? 'border-accent ring-4 ring-accent/40 scale-[1.03] bg-surface/90'
            : 'border-border/80 ring-1 ring-white/10'
        }`}
      >
        <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-4">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 bg-accent/20 border border-accent/40 rounded-lg text-accent">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-100">
                Quick-Drop Spotlight
              </h3>
              <p className="text-[10px] text-slate-400">
                Kürzel: <kbd className="px-1 py-0.5 bg-surface border border-border rounded text-[9px] font-mono">⌘ + ⇧ + L</kbd>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-surface transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* State 1: Idle Dropzone & File Picker */}
        {status === 'idle' && (
          <div
            onClick={handleClickPickFile}
            className={`py-8 px-4 flex flex-col items-center justify-center border-2 border-dashed rounded-xl text-center space-y-3 cursor-pointer transition-all duration-150 ${
              isDragging
                ? 'border-accent bg-accent/20 scale-[1.02]'
                : 'border-border/80 hover:border-accent/60 bg-surface/30 hover:bg-surface/60'
            }`}
          >
            <div className={`p-3 rounded-2xl border transition-transform ${isDragging ? 'scale-110 bg-accent text-white border-accent' : 'bg-surface border-border text-accent'}`}>
              {isDragging ? <UploadCloud className="w-7 h-7 animate-bounce" /> : <Sparkles className="w-6 h-6 text-accent" />}
            </div>
            <div>
              <p className="text-sm font-bold text-slate-100">
                {isDragging ? 'PDF jetzt loslassen!' : 'PDF hier ablegen oder klicken'}
              </p>
              <p className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto">
                Konvertiert automatisch im Hintergrund & legt die .md-Datei für ChatGPT / Gemini direkt ins Clipboard.
              </p>
            </div>
          </div>
        )}

        {/* State 2: Live Processing with Progress Bar */}
        {status === 'processing' && (
          <div className="py-6 flex flex-col items-center justify-center space-y-4 text-center">
            <div className="relative">
              <Loader2 className="w-10 h-10 text-accent animate-spin" />
            </div>
            <div className="space-y-1 w-full max-w-xs">
              <p className="text-xs font-bold text-slate-100 truncate">{currentFileName}</p>
              <p className="text-[11px] text-slate-400">
                {progressTotal > 0
                  ? `Folie ${progressCurrent} von ${progressTotal} verarbeitet (${percent}%)`
                  : 'Strukturierte Markdown-Erstellung läuft...'}
              </p>

              {/* Animated Progress Bar */}
              {progressTotal > 0 && (
                <div className="w-full bg-surface border border-border/80 rounded-full h-2 overflow-hidden mt-2 shadow-inner">
                  <div
                    className="bg-accent h-full transition-all duration-300 rounded-full"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* State 3: Success Feedback */}
        {status === 'success' && (
          <div className="py-6 flex flex-col items-center justify-center space-y-2 text-center text-emerald-400 animate-scale-up">
            <CheckCircle2 className="w-10 h-10" />
            <div>
              <p className="text-sm font-bold text-slate-100">Als Datei im Clipboard bereit!</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Wechsle zu ChatGPT / Gemini und drücke <kbd className="px-1.5 py-0.5 bg-surface border border-border rounded text-[10px] font-mono text-slate-200">⌘ + V</kbd>
              </p>
            </div>
          </div>
        )}

        {/* State 4: Error State */}
        {status === 'error' && (
          <div className="py-6 text-center space-y-2 text-rose-400">
            <p className="text-xs font-bold">Fehler bei der Konvertierung</p>
            <p className="text-[10px] text-slate-400 whitespace-pre-wrap">{errorMessage}</p>
          </div>
        )}
      </div>
    </div>
  );
};
