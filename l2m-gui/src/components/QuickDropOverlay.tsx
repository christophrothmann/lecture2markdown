import React, { useState, useEffect } from 'react';
import { Sparkles, X, FileText, Loader2, CheckCircle2, Zap } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { sendNotification, isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import type { ProviderType } from './ApiKeyModal';

interface QuickDropOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  activeProvider: ProviderType;
  apiKey: string;
}

export const QuickDropOverlay: React.FC<QuickDropOverlayProps> = ({
  isOpen,
  onClose,
  activeProvider,
  apiKey,
}) => {
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [currentFileName, setCurrentFileName] = useState<string>('');
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
    } catch {
      // Audio fallback ignored
    }
  };

  const handleProcessFile = async (filePath: string, fileName: string) => {
    if (!apiKey) {
      alert('Bitte richte zuerst deinen API-Key in den Einstellungen ein.');
      onClose();
      return;
    }

    setStatus('processing');
    setCurrentFileName(fileName);

    try {
      const markdown = await invoke<string>('convert_lecture_native', {
        pdfPath: filePath,
        outputPath: '',
        provider: activeProvider,
        apiKey,
      });

      // 1. Auto-Save Markdown next to PDF
      const autoSavePath = filePath.replace(/\.pdf$/i, '.md');
      try {
        await writeTextFile(autoSavePath, markdown);
      } catch (saveErr) {
        console.warn('Auto-save failed:', saveErr);
      }

      // 2. Put file descriptor on system clipboard
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
          body: `✅ ${fileName.replace(/\.pdf$/i, '.md')} liegt im Clipboard für ChatGPT bereit!`,
        });
      }

      setStatus('success');
      setTimeout(() => {
        setStatus('idle');
        onClose();
      }, 1400);
    } catch (err: any) {
      console.error('Quick drop failed:', err);
      setStatus('error');
      setErrorMessage(String(err));
      setTimeout(() => {
        setStatus('idle');
      }, 3500);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (status === 'processing') return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const filePath = (file as any).path || file.name;
      handleProcessFile(filePath, file.name);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
      <div
        className={`w-full max-w-lg glass-card rounded-2xl p-6 border shadow-2xl transition-all ${
          isDragging
            ? 'border-accent ring-2 ring-accent/40 scale-[1.02]'
            : 'border-border/80 ring-1 ring-white/10'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
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
                Shortcut: <kbd className="px-1 py-0.5 bg-surface border border-border rounded text-[9px] font-mono">⌘ + ⇧ + L</kbd>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-surface transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Dynamic State View */}
        {status === 'idle' && (
          <div className="py-8 flex flex-col items-center justify-center border-2 border-dashed border-border/80 rounded-xl bg-surface/30 text-center space-y-2">
            <div className="p-3 bg-surface rounded-2xl border border-border text-accent">
              <Sparkles className="w-6 h-6 animate-pulse text-accent" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">
                PDF-Vorlesung hier ablegen
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Konvertiert automatisch & legt die Datei für ChatGPT/Gemini ins Clipboard.
              </p>
            </div>
          </div>
        )}

        {status === 'processing' && (
          <div className="py-8 flex flex-col items-center justify-center space-y-3 text-center">
            <Loader2 className="w-8 h-8 text-accent animate-spin" />
            <div>
              <p className="text-xs font-bold text-slate-100">Konvertiere {currentFileName}...</p>
              <p className="text-[10px] text-slate-400 mt-1">
                Strukturierte Markdown-Erstellung im Hintergrund
              </p>
            </div>
          </div>
        )}

        {status === 'success' && (
          <div className="py-8 flex flex-col items-center justify-center space-y-2 text-center text-emerald-400 animate-scale-up">
            <CheckCircle2 className="w-8 h-8" />
            <p className="text-xs font-bold text-slate-100">Als Datei im Clipboard bereit!</p>
            <p className="text-[10px] text-slate-400">
              Drücke jetzt einfach <kbd className="px-1 py-0.5 bg-surface border border-border rounded text-[9px] font-mono">⌘ + V</kbd> in ChatGPT / Gemini
            </p>
          </div>
        )}

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
