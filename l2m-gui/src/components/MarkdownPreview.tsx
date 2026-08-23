import React, { useState, useEffect } from 'react';
import {
  Copy,
  Save,
  Check,
  FileText,
  PlusCircle,
  Trash2,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Download,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { save as saveFileDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { generateAnkiCardsFromMarkdown, exportCardsToAnkiTsv } from '../utils/anki';

interface MarkdownPreviewProps {
  content: string;
  fileName: string;
  pdfPath?: string | null;
  onSaveFile: () => void;
  onNewConversion: () => void;
  onDelete?: () => void;
}

interface SlideSection {
  slideNumber: number;
  title: string;
  content: string;
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  content,
  fileName,
  pdfPath,
  onSaveFile,
  onNewConversion,
  onDelete,
}) => {
  const [copied, setCopied] = useState(false);
  const [ankiExported, setAnkiExported] = useState(false);
  const [activeView, setActiveView] = useState<'markdown' | 'split'>('markdown');

  // Split-Screen State
  const [slides, setSlides] = useState<SlideSection[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(0);
  const [currentSlideImage, setCurrentSlideImage] = useState<string | null>(null);
  const [isLoadingSlideImage, setIsLoadingSlideImage] = useState<boolean>(false);

  // Parse markdown into slide sections
  useEffect(() => {
    const rawSections = content.split(/\n(?=##\s+|---\s*\n)/);
    const parsed: SlideSection[] = [];
    let counter = 1;

    for (const sec of rawSections) {
      const trimmed = sec.trim();
      if (!trimmed) continue;
      const headerMatch = trimmed.match(/^##\s+(?:Folie|Slide)?\s*(\d+)?(?::|-)?\s*(.*)$/im);
      let num = counter;
      let title = `Folie ${counter}`;

      if (headerMatch) {
        if (headerMatch[1]) {
          num = parseInt(headerMatch[1], 10);
        }
        if (headerMatch[2]?.trim()) {
          title = headerMatch[2].trim();
        }
      }

      parsed.push({
        slideNumber: num,
        title,
        content: trimmed.replace(/^---\s*\n/, ''),
      });
      counter++;
    }

    setSlides(parsed.length > 0 ? parsed : [{ slideNumber: 1, title: 'Vorlesung', content }]);
    setCurrentSlideIndex(0);
  }, [content]);

  // Load slide image when in split view
  useEffect(() => {
    if (activeView !== 'split' || !pdfPath || slides.length === 0) return;

    const currentSlide = slides[currentSlideIndex];
    const pageIndex = currentSlide ? Math.max(0, currentSlide.slideNumber - 1) : currentSlideIndex;

    setIsLoadingSlideImage(true);
    invoke<string>('get_slide_image_native', {
      pdfPath,
      pageIndex,
    })
      .then((base64) => {
        setCurrentSlideImage(`data:image/webp;base64,${base64}`);
        setIsLoadingSlideImage(false);
      })
      .catch((err) => {
        console.warn('Foliengrafik konnte nicht geladen werden:', err);
        setCurrentSlideImage(null);
        setIsLoadingSlideImage(false);
      });
  }, [activeView, currentSlideIndex, pdfPath, slides]);

  // Keyboard navigation for Split-Screen
  useEffect(() => {
    if (activeView !== 'split') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        setCurrentSlideIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        setCurrentSlideIndex((prev) => Math.min(slides.length - 1, prev + 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeView, slides.length]);

  const handleCopyAsFile = async () => {
    try {
      await invoke('copy_file_to_clipboard_native', {
        fileName: fileName || 'Vorlesung.md',
        content,
      });
      await navigator.clipboard.writeText(content).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.warn('File clipboard fallback:', err);
      try {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch {}
    }
  };

  const handleExportAnki = async () => {
    try {
      const cards = generateAnkiCardsFromMarkdown(content, fileName);
      const tsvContent = exportCardsToAnkiTsv(cards);

      const defaultName = fileName.replace(/\.(pdf|md)$/i, '') + '_Anki.txt';
      const savePath = await saveFileDialog({
        defaultPath: defaultName,
        filters: [{ name: 'Anki Flashcard Deck (*.txt)', extensions: ['txt', 'tsv', 'csv'] }],
      });

      if (savePath) {
        await writeTextFile(savePath, tsvContent);
        setAnkiExported(true);
        setTimeout(() => setAnkiExported(false), 2500);
      }
    } catch (err) {
      console.error('Anki Export fehlgeschlagen:', err);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    const cleanName = fileName || 'Vorlesung.md';
    e.dataTransfer.setData('text/plain', content);
    e.dataTransfer.setData('DownloadURL', `text/markdown:${cleanName}:data:text/markdown;charset=utf-8,${encodeURIComponent(content)}`);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const characterCount = content.length;
  const lineCount = content.split('\n').length;
  const currentSlide = slides[currentSlideIndex] || { slideNumber: 1, title: 'Vorlesung', content };

  return (
    <div className="glass-card rounded-2xl p-6 space-y-4 flex flex-col h-full">
      {/* Top Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between border-b border-border pb-4 gap-3 shrink-0">
        <div className="flex items-center space-x-3">
          {/* Draggable File Pill (Direct-Drag out to ChatGPT/Browser) */}
          <div
            draggable
            onDragStart={handleDragStart}
            className="flex items-center space-x-2 px-3 py-1.5 bg-surface hover:bg-surface-hover border border-border hover:border-accent/50 rounded-xl cursor-grab active:cursor-grabbing transition group shadow-sm"
            title="💡 Direct-Drag: Klicke und ziehe diese Datei direkt in dein geöffnetes ChatGPT- oder Gemini-Browserfenster!"
          >
            <GripVertical className="w-3.5 h-3.5 text-slate-500 group-hover:text-accent transition" />
            <FileText className="w-4 h-4 text-accent" />
            <span className="text-xs font-bold text-slate-200">{fileName}</span>
          </div>

          <p className="text-[10px] text-slate-400 hidden sm:block">
            {characterCount.toLocaleString('de-DE')} Zeichen • {lineCount} Zeilen
          </p>
        </div>

        {/* Action Controls & Apple-Style Segmented View Switch */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Apple-Style Segmented Control */}
          <div className="flex items-center bg-background/80 p-1 rounded-xl border border-border/80">
            <button
              type="button"
              onClick={() => setActiveView('markdown')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${
                activeView === 'markdown'
                  ? 'bg-surface text-slate-100 shadow-sm border border-border'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Markdown
            </button>
            <button
              type="button"
              onClick={() => setActiveView('split')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition flex items-center gap-1.5 ${
                activeView === 'split'
                  ? 'bg-surface text-slate-100 shadow-sm border border-border'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 text-accent" />
              Split-View
            </button>
          </div>

          <button
            type="button"
            onClick={onNewConversion}
            className="px-3 py-1.5 bg-surface hover:bg-surface-hover border border-border text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            title="Neue Vorlesungs-PDF konvertieren"
          >
            <PlusCircle className="w-3.5 h-3.5 text-accent" /> Neu
          </button>

          {/* Anki Deck Export Button */}
          <button
            type="button"
            onClick={handleExportAnki}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition border cursor-pointer ${
              ankiExported
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                : 'bg-surface hover:bg-surface-hover border-border text-slate-200'
            }`}
            title="Erstellt automatisch ein fertiges Anki-Lernkarten-Deck (.txt) aus den Vorlesungsfolien"
          >
            {ankiExported ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" /> Anki Deck exportiert!
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Anki Deck
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onSaveFile}
            className="px-3 py-1.5 bg-surface hover:bg-surface-hover border border-border text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            title="Speicherort wählen und als .md Datei sichern"
          >
            <Save className="w-3.5 h-3.5 text-slate-400" /> Speichern
          </button>

          {/* Copy As File Button */}
          <button
            type="button"
            onClick={handleCopyAsFile}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition border cursor-pointer ${
              copied
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                : 'bg-accent hover:bg-accent-hover text-white border-transparent shadow-md'
            }`}
            title="Kopiert die Vorlesung als echte .md-Datei. Beim Einfügen in ChatGPT/Gemini (Strg+V) wird sie direkt als Dokument-Anhang hochgeladen."
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5" /> Als Datei kopiert!
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" /> Als Datei kopieren
              </>
            )}
          </button>

          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="p-1.5 bg-surface hover:bg-rose-500/10 border border-border hover:border-rose-500/30 text-slate-400 hover:text-rose-400 rounded-xl text-xs font-semibold flex items-center justify-center transition cursor-pointer"
              title="Diesen Eintrag aus dem Verlauf löschen"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Content: Standard Markdown vs Synchronized Split-Screen */}
      {activeView === 'markdown' ? (
        <div className="flex-1 overflow-y-auto min-h-0 bg-background/80 p-4 rounded-xl border border-border/50 text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">
          {content}
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 min-h-0">
          {/* Left Column: Visual Slide Viewer & Navigator */}
          <div className="flex flex-col bg-background/80 p-4 rounded-xl border border-border/50 min-h-0 space-y-3">
            <div className="flex items-center justify-between border-b border-border/60 pb-2 shrink-0">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-slate-200">
                  Folie {currentSlideIndex + 1} von {slides.length}
                </span>
                <span className="text-[10px] text-slate-400 truncate max-w-[140px]">
                  {currentSlide.title}
                </span>
              </div>

              {/* Slide Navigation Buttons */}
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  onClick={() => setCurrentSlideIndex((prev) => Math.max(0, prev - 1))}
                  disabled={currentSlideIndex === 0}
                  className="p-1.5 bg-surface hover:bg-surface-hover border border-border text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition"
                  title="Vorherige Folie (Pfeiltaste links)"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentSlideIndex((prev) => Math.min(slides.length - 1, prev + 1))}
                  disabled={currentSlideIndex === slides.length - 1}
                  className="p-1.5 bg-surface hover:bg-surface-hover border border-border text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition"
                  title="Nächste Folie (Pfeiltaste rechts)"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Slide Image or High-Res Rendering */}
            <div className="flex-1 flex items-center justify-center bg-black/40 rounded-lg border border-border/30 overflow-hidden min-h-0 relative">
              {isLoadingSlideImage ? (
                <div className="flex flex-col items-center space-y-2 text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin text-accent" />
                  <span className="text-xs">Lade Original-Folie...</span>
                </div>
              ) : currentSlideImage ? (
                <img
                  src={currentSlideImage}
                  alt={`Folie ${currentSlideIndex + 1}`}
                  className="max-w-full max-h-full object-contain rounded"
                />
              ) : (
                <div className="text-center p-6 text-slate-500">
                  <FileText className="w-10 h-10 mx-auto mb-2 opacity-40 text-accent" />
                  <p className="text-xs font-semibold text-slate-400">Folie {currentSlideIndex + 1}</p>
                  <p className="text-[10px] mt-1 text-slate-500">
                    {currentSlide.title}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Synchronized Markdown Text */}
          <div className="flex flex-col bg-background/80 p-4 rounded-xl border border-border/50 min-h-0 space-y-2">
            <div className="flex items-center justify-between border-b border-border/60 pb-2 shrink-0">
              <span className="text-xs font-bold text-slate-200">LaTeX & Markdown Notizen</span>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(currentSlide.content);
                }}
                className="text-[10px] font-semibold text-accent hover:text-accent-hover transition flex items-center gap-1"
                title="Nur diese Folie kopieren"
              >
                <Copy className="w-3 h-3" /> Folie kopieren
              </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">
              {currentSlide.content}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
