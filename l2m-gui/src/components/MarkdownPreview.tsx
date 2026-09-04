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
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { FlashcardInspectorTab } from './FlashcardInspectorTab';
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
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [ankiExported, setAnkiExported] = useState(false);
  const [activeView, setActiveView] = useState<'markdown' | 'split' | 'flashcards'>('markdown');
  const [flashcardCount, setFlashcardCount] = useState<number>(0);
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

    let isCancelled = false;

    async function renderPage() {
      setIsLoadingSlideImage(true);
      try {
        const pdfDoc = await loadPdfDocument(activePdfPath!);
        if (isCancelled) return;

        if (canvasRef.current) {
          await renderSlideToCanvas(pdfDoc, targetPage, canvasRef.current, 1.8);
          setIsPdfJsRendered(true);
          setCurrentSlideImage(null);
        }
      } catch {
        // Fallback to native backend rendering if PDF.js fails
        if (!isCancelled) {
          try {
            const base64 = await invoke<string>('get_slide_image_native', {
              pdfPath: activePdfPath,
              pageIndex: targetPage - 1,
            });
            if (!isCancelled && base64) {
              setCurrentSlideImage(`data:image/webp;base64,${base64}`);
              setIsPdfJsRendered(false);
            }
          } catch {
            if (!isCancelled) {
              setCurrentSlideImage(null);
              setIsPdfJsRendered(false);
            }
          }
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingSlideImage(false);
        }
      }
    }

    renderPage();

    return () => {
      isCancelled = true;
    };
  }, [activeView, activePdfPath, currentSlideIndex, slides]);

  // Keyboard navigation for Split-Screen slide browsing
  useEffect(() => {
    if (activeView !== 'split') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'Left') {
        setCurrentSlideIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight' || e.key === 'Right') {
        setCurrentSlideIndex((prev) => Math.min(slides.length - 1, prev + 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeView, slides.length]);

  const handleSelectPdfManually = async () => {
    try {
      const selected = await openFileDialog({
        multiple: false,
        filters: [{ name: t('dropzone.browse_filter'), extensions: ['pdf'] }],
      });
      if (selected && typeof selected === 'string') {
        setActivePdfPath(selected);
      }
    } catch {
      // User cancelled
    }
  };

  const handleCopyAsFile = async () => {
    try {
      const cleanName = fileName ? fileName.replace(/\.pdf$/i, '') : 'Vorlesung';
      await invoke('copy_file_to_clipboard_native', {
        fileName: `${cleanName}.md`,
        content,
      });

      setCopied(true);
      setSavedToast({
        message: t('preview.copy_file_success'),
      });
      setTimeout(() => setCopied(false), 3000);
      setTimeout(() => setSavedToast(null), 6000);
    } catch {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const handleExportAnki = () => {
    setActiveView((prev) => (prev === 'flashcards' ? 'markdown' : 'flashcards'));
  };

  const handleDragStart = (e: React.DragEvent) => {
    const cleanName = fileName || 'Vorlesung.md';
    e.dataTransfer.setData('text/plain', content);
    e.dataTransfer.setData(
      'DownloadURL',
      `text/markdown:${cleanName}:data:text/markdown;charset=utf-8,${encodeURIComponent(content)}`
    );
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
              <span className="text-[10px] text-emerald-400/70 truncate max-w-[280px]">
                ({savedToast.path})
              </span>
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
            title={t('preview.drag_hint')}
          >
            <GripVertical className="w-3.5 h-3.5 text-slate-500 group-hover:text-accent transition" />
            <FileText className="w-4 h-4 text-accent" />
            <span className="text-xs font-bold text-slate-200">{fileName}</span>
          </div>

          <p className="text-[10px] text-slate-400 hidden sm:block">
            {characterCount.toLocaleString()} {t('preview.character_count', { defaultValue: 'Zeichen' })} • {lineCount} {t('preview.line_count', { defaultValue: 'Zeilen' })}
          </p>
        </div>

        {/* Action Controls & Apple-Style Segmented View Switch */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Apple-Style Segmented Control */}
          <div className="flex items-center bg-background/80 p-1 rounded-xl border border-border/80">
            <button
              type="button"
              onClick={() => setActiveView('markdown')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition cursor-pointer ${
                activeView === 'markdown'
                  ? 'bg-surface text-slate-100 shadow-sm border border-border'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('preview.tab_markdown')}
            </button>
            <button
              type="button"
              onClick={() => setActiveView('split')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                activeView === 'split'
                  ? 'bg-surface text-slate-100 shadow-sm border border-border'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 text-accent" />
              {t('preview.tab_split')}
            </button>
            <button
              type="button"
              onClick={() => setActiveView('flashcards')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                activeView === 'flashcards'
                  ? 'bg-surface text-slate-100 shadow-sm border border-border'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>
                {t('preview.tab_flashcards', { defaultValue: 'Lernkarten' })}
                {flashcardCount > 0 ? ` (${flashcardCount})` : ''}
              </span>
            </button>
          </div>

          <button
            type="button"
            onClick={onNewConversion}
            className="px-3 py-1.5 bg-surface hover:bg-surface-hover border border-border text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            title={t('preview.new_conversion')}
          >
            <PlusCircle className="w-3.5 h-3.5 text-accent" /> {t('preview.new_conversion')}
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
            title={t('preview.anki_export_tooltip')}
          >
            {ankiExported ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" /> {t('common.done')}
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-amber-400" /> {t('preview.anki_export')}
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onSaveFile}
            className="px-3 py-1.5 bg-surface hover:bg-surface-hover border border-border text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            title={t('preview.save_markdown')}
          >
            <Save className="w-3.5 h-3.5 text-slate-400" /> {t('common.save')}
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
            title={t('preview.copy_file_tooltip')}
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5" /> {t('common.copied')}
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" /> {t('preview.copy_file')}
              </>
            )}
          </button>

          {onDelete && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(t('preview.delete_confirm'))) {
                  onDelete();
                }
              }}
              className="p-1.5 bg-surface hover:bg-rose-500/10 border border-border hover:border-rose-500/30 text-slate-400 hover:text-rose-400 rounded-xl text-xs font-semibold flex items-center justify-center transition cursor-pointer"
              title={t('preview.delete_entry')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Content: Standard Markdown vs Synchronized Split-Screen vs Integrated Flashcards */}
      <div
        className={
          activeView === 'markdown'
            ? 'flex-1 overflow-y-auto min-h-0 bg-background/80 p-4 rounded-xl border border-border/50 text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed'
            : 'hidden'
        }
      >
        {content}
      </div>

      <div
        className={
          activeView === 'split'
            ? 'flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 min-h-0'
            : 'hidden'
        }
      >
        {/* Left Column: Visual Slide Viewer & Navigator */}
        <div className="flex flex-col bg-background/80 p-4 rounded-xl border border-border/50 min-h-0 space-y-3">
          <div className="flex items-center justify-between border-b border-border/60 pb-2 shrink-0">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-slate-200">
                {t('preview.slide_counter', { current: currentSlideIndex + 1, total: slides.length })}
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
                className="p-1.5 bg-surface hover:bg-surface-hover border border-border text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition cursor-pointer"
                title="←"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentSlideIndex((prev) => Math.min(slides.length - 1, prev + 1))}
                disabled={currentSlideIndex === slides.length - 1}
                className="p-1.5 bg-surface hover:bg-surface-hover border border-border text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition cursor-pointer"
                title="→"
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
                <span className="text-xs">{t('preview.pdf_loading', { page: currentSlideIndex + 1 })}</span>
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
                alt={`Slide ${currentSlideIndex + 1}`}
                className="max-w-full max-h-full object-contain rounded"
              />
            )}

            {!activePdfPath && (
              <div className="text-center p-6 text-slate-500 space-y-3">
                <FileText className="w-10 h-10 mx-auto opacity-40 text-accent" />
                <div>
                  <p className="text-xs font-semibold text-slate-300">
                    {t('preview.slide_counter', { current: currentSlideIndex + 1, total: slides.length })}: {currentSlide.title}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">{t('preview.no_pdf_linked')}</p>
                </div>
                <button
                  type="button"
                  onClick={handleSelectPdfManually}
                  className="px-3 py-1.5 bg-surface hover:bg-surface-hover border border-border text-slate-200 rounded-xl text-xs font-semibold transition inline-flex items-center gap-1.5 cursor-pointer shadow-sm"
                >
                  <FileText className="w-3.5 h-3.5 text-accent" /> {t('preview.link_pdf')}
                </button>
              </div>
            )}

            {activePdfPath && !isPdfJsRendered && !currentSlideImage && !isLoadingSlideImage && (
              <div className="text-center p-6 text-slate-500 space-y-2">
                <FileText className="w-8 h-8 mx-auto opacity-40 text-rose-400" />
                <p className="text-xs text-rose-300">
                  {t('preview.pdf_no_page', { page: currentSlideIndex + 1 })}
                </p>
                <button
                  type="button"
                  onClick={handleSelectPdfManually}
                  className="px-2.5 py-1 bg-surface border border-border text-slate-300 rounded-lg text-xs cursor-pointer"
                >
                  {t('preview.choose_other_pdf')}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Synchronized Markdown Text */}
        <div className="flex flex-col bg-background/80 p-4 rounded-xl border border-border/50 min-h-0 space-y-2">
          <div className="flex items-center justify-between border-b border-border/60 pb-2 shrink-0">
            <span className="text-xs font-bold text-slate-200">{t('preview.notes_title')}</span>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(currentSlide.content);
              }}
              className="text-[10px] font-semibold text-accent hover:text-accent-hover transition flex items-center gap-1 cursor-pointer"
              title={t('preview.copy_slide')}
            >
              <Copy className="w-3 h-3" /> {t('preview.copy_slide')}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">
            {currentSlide.content}
          </div>
        </div>
      </div>

      <div
        className={
          activeView === 'flashcards'
            ? 'flex-1 flex flex-col min-h-0'
            : 'hidden'
        }
      >
        <FlashcardInspectorTab
          markdownContent={content}
          defaultTitle={fileName}
          activePdfPath={activePdfPath}
          onLinkPdfRequested={handleSelectPdfManually}
          onCardCountChange={(cnt) => setFlashcardCount(cnt)}
          onSuccessToast={(msg, path) => {
            setAnkiExported(true);
            setSavedToast({ message: msg, path });
            setTimeout(() => setAnkiExported(false), 4000);
            setTimeout(() => setSavedToast(null), 6000);
          }}
        />
      </div>
    </div>
  );
};
export default MarkdownPreview;
