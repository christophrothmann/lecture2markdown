import React, { useState, useEffect } from 'react';
import { Sparkles, X, FileText, Loader2, CheckCircle2, Zap, UploadCloud } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { sendNotification, isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { useTranslation } from 'react-i18next';
import type { ProviderType } from './ApiKeyModal';
import type { HistoryItem } from './HistorySidebar';
import { extractPdfSlidesWebp } from '../utils/pdfRenderer';

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
  const { t } = useTranslation();
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent || '');
  const shortcutText = isMac ? '⌘ + ⇧ + L' : 'Ctrl + Shift + L';
  const pasteShortcutText = isMac ? '⌘ + V' : 'Ctrl + V';
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

  const playSuccessChime = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.12); // A5

      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    } catch {}
  };

  const handleProcessFile = async (pdfPath: string, fileName: string) => {
    setCurrentFileName(fileName);
    setStatus('processing');
    setProgressCurrent(0);
    setProgressTotal(0);
    setErrorMessage('');

    try {
      const slides = await extractPdfSlidesWebp(pdfPath);
      const markdown = await invoke<string>('transcribe_slides_native', {
        slides,
        provider: activeProvider,
        apiKey,
        fileName,
      });

      // Automatically copy markdown file descriptor to native clipboard
      const cleanName = fileName.replace(/\.pdf$/i, '');
      const targetMdPath = pdfPath.replace(/\.pdf$/i, '.md');

      // Auto-save markdown file next to source PDF
      try {
        await invoke('save_text_file_native', {
          filePath: targetMdPath,
          content: markdown,
        });
      } catch {}

      // Copy to clipboard as native file object
      try {
        await invoke('copy_file_to_clipboard_native', {
          fileName: `${cleanName}.md`,
          content: markdown,
        });
      } catch {
        await navigator.clipboard.writeText(markdown);
      }

      // Play completion chime
      playSuccessChime();

      // Trigger system notification
      try {
        let hasPermission = await isPermissionGranted();
        if (!hasPermission) {
          const perm = await requestPermission();
          hasPermission = perm === 'granted';
        }
        if (hasPermission) {
          sendNotification({
            title: 'Lecture2Markdown',
            body: `${fileName} wurde erfolgreich konvertiert und ins Clipboard kopiert!`,
          });
        }
      } catch {}

      setStatus('success');

      // Register in History
      if (onSuccess) {
        onSuccess({
          id: `item-${Date.now()}`,
          fileName,
          filePath: pdfPath,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          content: result.markdown,
          totalPages: result.total_pages || 1,
          status: 'completed',
        });
      }

      setTimeout(() => {
        onClose();
        setStatus('idle');
      }, 2500);
    } catch (e: any) {
      console.error('Quick-Drop Konvertierungsfehler:', e);
      setStatus('error');
      setErrorMessage(e?.toString() || 'Fehler bei der Konvertierung');
    }
  };

  const handleClickPickFile = async () => {
    if (status === 'processing') return;

    try {
      const selected = await openFileDialog({
        multiple: false,
        filters: [{ name: t('dropzone.browse_filter'), extensions: ['pdf'] }],
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
                {t('quickdrop.title')}
              </h3>
              <p className="text-[10px] text-slate-400">
                {t('quickdrop.shortcut_label')}{' '}
                <kbd className="px-1 py-0.5 bg-surface border border-border rounded text-[9px] font-mono">{shortcutText}</kbd>
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
                {isDragging ? t('quickdrop.drop_active') : t('quickdrop.drop_prompt')}
              </p>
              <p className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto">
                {t('quickdrop.subtitle')}
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
                  ? t('quickdrop.converting_slide', { current: progressCurrent, total: progressTotal, percent })
                  : t('quickdrop.converting')}
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
              <p className="text-sm font-bold text-slate-100">{t('quickdrop.copied_badge')}</p>
              <p className="text-[11px] text-slate-400 mt-1">
                {t('quickdrop.paste_hint', { key: pasteShortcutText })}
              </p>
            </div>
          </div>
        )}

        {/* State 4: Error State */}
        {status === 'error' && (
          <div className="py-6 text-center space-y-2 text-rose-400">
            <p className="text-xs font-bold">{t('quickdrop.error_title')}</p>
            <p className="text-[10px] text-slate-400 whitespace-pre-wrap">{errorMessage}</p>
          </div>
        )}
      </div>
    </div>
  );
};
export default QuickDropOverlay;
