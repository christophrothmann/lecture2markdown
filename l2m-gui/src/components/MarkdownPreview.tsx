import React, { useState, useEffect, useRef } from 'react';
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
  Loader2,
  Sparkles,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { save as saveFileDialog, open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { generateAnkiCardsFromMarkdown, exportCardsToAnkiTsv } from '../utils/anki';
import { loadPdfDocument, renderSlideToCanvas } from '../utils/pdfRenderer';
import { parseMarkdownSlides, type SlideSection } from '../utils/slideParser';

interface MarkdownPreviewProps {
  content: string;
  fileName: string;
  pdfPath?: string | null;
  onSaveFile: () => void;
  onNewConversion: () => void;
  onDelete?: () => void;
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
  const [savedToast, setSavedToast] = useState<{ message: string; path?: string } | null>(null);
  const [activePdfPath, setActivePdfPath] = useState<string | null>(pdfPath || null);

  useEffect(() => {
    if (pdfPath) {
      setActivePdfPath(pdfPath);
    }
  }, [pdfPath]);

  // Split-Screen State & Canvas Ref
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPdfJsRendered, setIsPdfJsRendered] = useState<boolean>(false);
  const [slides, setSlides] = useState<SlideSection[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(0);
  const [currentSlideImage, setCurrentSlideImage] = useState<string | null>(null);
  const [isLoadingSlideImage, setIsLoadingSlideImage] = useState<boolean>(false);

  // Parse markdown into distinct slide sections with 1:1 page mapping
  useEffect(() => {
    const parsed = parseMarkdownSlides(content);
    setSlides(parsed.length > 0 ? parsed : [{ slideNumber: 1, title: 'Vorlesung', content }]);
    setCurrentSlideIndex(0);
  }, [content]);

  const [slideImageError, setSlideImageError] = useState<string | null>(null);

  // Load and render slide with PDF.js (0 Python, 100% Zero-Config client-side)
  useEffect(() => {
    if (activeView !== 'split' || !activePdfPath || slides.length === 0) {
      if (!activePdfPath) {
        setCurrentSlideImage(null);
        setIsPdfJsRendered(false);
      }
      return;
    }

    const currentSlide = slides[currentSlideIndex];
    const targetPage = currentSlide?.slideNumber || currentSlideIndex + 1;

    setIsLoadingSlideImage(true);
    setSlideImageError(null);

    let isCancelled = false;

    loadPdfDocument(activePdfPath)
      .then(async (loaded) => {
        if (isCancelled) return;
        if (canvasRef.current) {
          const safePage = Math.min(Math.max(1, targetPage), loaded.numPages);
          await renderSlideToCanvas(loaded.doc, safePage, canvasRef.current);
          if (!isCancelled) {
            setIsPdfJsRendered(true);
            setIsLoadingSlideImage(false);
          }
        }
      })
      .catch((pdfJsErr) => {
        if (isCancelled) return;
        console.warn('PDF.js rendering fallback to native backend:', pdfJsErr);
        const pageIndex = Math.max(0, targetPage - 1);
        invoke<string>('get_slide_image_native', {
          pdfPath: activePdfPath,
          pageIndex,
        })
          .then((base64) => {
            if (!isCancelled) {
              setCurrentSlideImage(`data:image/webp;base64,${base64}`);
              setIsPdfJsRendered(false);
              setIsLoadingSlideImage(false);
            }
          })
          .catch((nativeErr) => {
            if (!isCancelled) {
              console.error('Foliengrafik konnte nicht geladen werden:', nativeErr);
              setCurrentSlideImage(null);
              setIsPdfJsRendered(false);
              setSlideImageError(String(pdfJsErr));
              setIsLoadingSlideImage(false);
            }
          });
      });

    return () => {
      isCancelled = true;
    };
  }, [activeView, currentSlideIndex, activePdfPath, slides]);

  const handleSelectPdfManually = async () => {
    try {
      const selected = await openFileDialog({
        multiple: false,
        filters: [{ name: 'PDF Vorlesungen', extensions: ['pdf'] }],
      });
      if (selected && typeof selected === 'string') {
        setActivePdfPath(selected);
      }
    } catch (e) {
      console.error('PDF-Auswahl fehlgeschlagen:', e);
    }
  };

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
        await invoke('save_text_file_native', {
          filePath: savePath,
          content: tsvContent,
        });
        setAnkiExported(true);
        setSavedToast({
          message: `🃏 ${cards.length} Anki-Lernkarten erfolgreich gespeichert!`,
          path: savePath,
        });
        setTimeout(() => setAnkiExported(false), 2500);
        setTimeout(() => setSavedToast(null), 4500);
      }
    } catch (err) {
      console.error('Anki Export fehlgeschlagen:', err);
      alert(`Fehler beim Speichern des Anki-Decks:\n${err}`);
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
      {/* Toast Notification Banner */}
      {savedToast && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs font-medium animate-fade-in shrink-0">
          <div className="flex items-center space-x-2 truncate">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{savedToast.message}</span>
            {savedToast.path && (
              <span className="text-[10px] text-emerald-400/70 truncate max-w-[280px]">({savedToast.path})</span>
            )}
          </div>
          <button
            onClick={() => setSavedToast(null)}
            className="text-emerald-400/80 hover:text-emerald-300 ml-2 cursor-pointer font-bold"
          >
            ✕
          </button>
        </div>
      )}

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

            {/* Slide Image / Canvas High-Res Rendering */}
            <div className="flex-1 flex items-center justify-center bg-black/40 rounded-lg border border-border/30 overflow-hidden min-h-0 relative p-2">
              {isLoadingSlideImage && (
                <div className="absolute inset-0 bg-background/60 backdrop-blur-xs flex flex-col items-center justify-center space-y-2 text-slate-400 z-10">
                  <Loader2 className="w-6 h-6 animate-spin text-accent" />
                  <span className="text-xs">Rendere Folie...</span>
                </div>
              )}

              <canvas
                ref={canvasRef}
                className={`max-w-full max-h-full object-contain rounded shadow-md transition-opacity duration-150 ${
                  activePdfPath && isPdfJsRendered ? 'block' : 'hidden'
                }`}
              />

              {!isPdfJsRendered && currentSlideImage && (
                <img
                  src={currentSlideImage}
                  alt={`Folie ${currentSlideIndex + 1}`}
                  className="max-w-full max-h-full object-contain rounded"
                />
              )}

              {!activePdfPath && (
                <div className="text-center p-6 text-slate-500 space-y-3">
                  <FileText className="w-10 h-10 mx-auto opacity-40 text-accent" />
                  <div>
                    <p className="text-xs font-semibold text-slate-300">Folie {currentSlideIndex + 1}: {currentSlide.title}</p>
                    <p className="text-[11px] text-slate-400 mt-1">Keine Original-PDF-Datei verknüpft</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleSelectPdfManually}
                    className="px-3 py-1.5 bg-surface hover:bg-surface-hover border border-border text-slate-200 rounded-xl text-xs font-semibold transition inline-flex items-center gap-1.5 cursor-pointer shadow-sm"
                    title="Wähle die zugehörige PDF-Datei aus, um die Original-Folien synchron anzuzeigen"
                  >
                    <FileText className="w-3.5 h-3.5 text-accent" /> PDF verknüpfen
                  </button>
                </div>
              )}

              {activePdfPath && !isPdfJsRendered && !currentSlideImage && !isLoadingSlideImage && (
                <div className="text-center p-6 text-slate-500 space-y-2">
                  <FileText className="w-8 h-8 mx-auto opacity-40 text-rose-400" />
                  <p className="text-xs text-rose-300">Folie konnte nicht gerendert werden</p>
                  <button
                    type="button"
                    onClick={handleSelectPdfManually}
                    className="px-2.5 py-1 bg-surface border border-border text-slate-300 rounded-lg text-xs"
                  >
                    Andere PDF wählen
                  </button>
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
