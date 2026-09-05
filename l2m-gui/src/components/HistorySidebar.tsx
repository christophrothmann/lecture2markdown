import React, { useState, useEffect, useRef } from 'react';
import { History, Trash2, Loader2, Copy, Check, X, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HistoryItem } from '../utils/historyStorage';
import { parseMarkdownSlides } from '../utils/slideParser';

export type { HistoryItem };

interface HistorySidebarProps {
  items: HistoryItem[];
  selectedItemId?: string | null;
  onSelect: (item: HistoryItem) => void | Promise<void>;
  onClear: () => void;
  onResolveContent?: (item: HistoryItem) => Promise<string>;
  onClose?: () => void;
}

const INITIAL_BATCH_SIZE = 12;
const BATCH_INCREMENT = 10;

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  items,
  selectedItemId,
  onSelect,
  onClear,
  onResolveContent,
  onClose,
}) => {
  const { t } = useTranslation();

  // Incremental Lazy-Rendering (Virtual / Infinite Window)
  const [visibleLimit, setVisibleLimit] = useState<number>(INITIAL_BATCH_SIZE);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isCopyingId, setIsCopyingId] = useState<string | null>(null);

  // 300ms Debounced Hover Preview State (Deckblatt / Slide 1)
  interface PreviewInfo {
    item: HistoryItem;
    title: string;
    slideContent: string;
    totalSlides: number;
    top: number;
  }
  const [previewInfo, setPreviewInfo] = useState<PreviewInfo | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheRef = useRef<Map<string, { title: string; slideContent: string; totalSlides: number }>>(new Map());

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  // Keep visibleLimit bounded if items count decreases
  useEffect(() => {
    if (items.length === 0) {
      setVisibleLimit(INITIAL_BATCH_SIZE);
    } else if (visibleLimit < INITIAL_BATCH_SIZE) {
      setVisibleLimit(INITIAL_BATCH_SIZE);
    }
  }, [items.length, visibleLimit]);

  // IntersectionObserver: automatically load next batch when scrolling near bottom
  useEffect(() => {
    if (!sentinelRef.current || visibleLimit >= items.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first && first.isIntersecting) {
          setVisibleLimit((prev) => Math.min(prev + BATCH_INCREMENT, items.length));
        }
      },
      {
        root: scrollContainerRef.current,
        rootMargin: '100px', // Preload before hitting the very bottom
        threshold: 0.1,
      }
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [items.length, visibleLimit]);

  // Fallback onScroll listener in case IntersectionObserver is delayed
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (previewInfo) {
      setPreviewInfo(null);
    }
    const target = e.currentTarget;
    if (target.scrollTop + target.clientHeight >= target.scrollHeight - 80) {
      if (visibleLimit < items.length) {
        setVisibleLimit((prev) => Math.min(prev + BATCH_INCREMENT, items.length));
      }
    }
  };

  const handleItemMouseEnter = (e: React.MouseEvent<HTMLDivElement>, item: HistoryItem) => {
    if (item.status === 'processing') return;

    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
    }

    const target = e.currentTarget;

    hoverTimerRef.current = setTimeout(async () => {
      const rect = target.getBoundingClientRect();
      // Ensure preview card stays comfortably in viewport
      const top = Math.min(Math.max(rect.top - 10, 16), window.innerHeight - 340);

      // Check cache first for 0ms response
      if (cacheRef.current.has(item.id)) {
        const cached = cacheRef.current.get(item.id)!;
        setPreviewInfo({
          item,
          title: cached.title,
          slideContent: cached.slideContent,
          totalSlides: cached.totalSlides,
          top,
        });
        return;
      }

      // Show loader state
      setIsPreviewLoading(true);
      setPreviewInfo({
        item,
        title: item.fileName.replace(/\.(pdf|md)$/i, ''),
        slideContent: '',
        totalSlides: item.totalPages || 1,
        top,
      });

      try {
        let content = item.content;
        if ((!content || !content.trim()) && onResolveContent) {
          content = await onResolveContent(item);
        }

        let title = item.fileName.replace(/\.(pdf|md)$/i, '');
        let slideContent = '';
        let totalSlides = item.totalPages || 1;

        if (content && content.trim()) {
          const slides = parseMarkdownSlides(content);
          if (slides.length > 0) {
            totalSlides = slides.length;
            if (slides[0].title) title = slides[0].title;
            slideContent = slides[0].content.trim();
          } else {
            const lines = content.split('\n').slice(0, 12).join('\n').trim();
            slideContent = lines;
          }
        }

        const resolved = { title, slideContent, totalSlides };
        cacheRef.current.set(item.id, resolved);

        setPreviewInfo((current) => {
          if (!current || current.item.id !== item.id) return current;
          return {
            item,
            title,
            slideContent,
            totalSlides,
            top,
          };
        });
      } catch (err) {
        console.error('Fehler beim Laden der Folien-Vorschau:', err);
      } finally {
        setIsPreviewLoading(false);
      }
    }, 300);
  };

  const handleItemMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setPreviewInfo(null);
  };

  const handleCopyItem = async (e: React.MouseEvent, item: HistoryItem) => {
    e.stopPropagation();
    setIsCopyingId(item.id);
    try {
      let text = item.content;
      if ((!text || !text.trim()) && onResolveContent) {
        text = await onResolveContent(item);
      }
      if (text) {
        await navigator.clipboard.writeText(text);
        setCopiedId(item.id);
        setTimeout(() => setCopiedId((current) => (current === item.id ? null : current)), 2000);
      }
    } catch {
      // Ignore clipboard error
    } finally {
      setIsCopyingId(null);
    }
  };

  const visibleItems = items.slice(0, visibleLimit);

  return (
    <div className="glass-card rounded-2xl p-5 space-y-4 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-3 shrink-0">
        <div className="flex items-center space-x-2 text-slate-200">
          <History className="w-4 h-4 text-accent" />
          <h3 className="text-xs font-bold uppercase tracking-wider">{t('history.title')}</h3>
          {items.length > 0 && (
            <span className="text-[10px] text-slate-400 bg-surface px-1.5 py-0.5 rounded-full border border-border">
              {items.length}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-1.5">
          {items.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm(t('history.clear_confirm'))) {
                  onClear();
                }
              }}
              className="text-slate-500 hover:text-rose-400 p-1 hover:bg-rose-500/10 rounded-lg transition cursor-pointer"
              title={t('history.clear_history')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          {onClose && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 p-1 hover:bg-surface-hover rounded-lg transition cursor-pointer"
              title={t('common.close', { defaultValue: 'Schließen' })}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Items List with Lazy Loading Window */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-1 custom-scrollbar"
      >
        {items.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-6">
            {t('history.empty_title')}
          </p>
        ) : (
          <>
            {visibleItems.map((item) => {
              const isProcessing = item.status === 'processing';
              const isSelected = selectedItemId === item.id;
              const isCopying = isCopyingId === item.id;
              const isCopied = copiedId === item.id;

              return (
                <div
                  key={item.id}
                  onClick={() => !isProcessing && onSelect(item)}
                  onMouseEnter={(e) => handleItemMouseEnter(e, item)}
                  onMouseLeave={handleItemMouseLeave}
                  className={`p-3 border rounded-xl transition group flex items-center justify-between ${
                    isProcessing
                      ? 'border-accent/40 bg-accent/5 cursor-default'
                      : isSelected
                      ? 'bg-accent/15 border-accent shadow-sm cursor-pointer'
                      : 'bg-card/80 hover:bg-surface-hover border-border/70 cursor-pointer'
                  }`}
                >
                  <div className="space-y-1.5 min-w-0 pr-2 flex-1">
                    <p
                      className={`text-xs font-semibold truncate transition ${
                        isProcessing || isSelected ? 'text-accent font-bold' : 'text-slate-200 group-hover:text-accent'
                      }`}
                    >
                      {item.fileName}
                    </p>

                    {isProcessing ? (
                      <div className="inline-flex items-center space-x-1.5 px-2 py-0.5 bg-accent/15 border border-accent/30 rounded-md text-[10px] text-accent font-medium">
                        <Loader2 className="w-3 h-3 animate-spin text-accent" />
                        <span>
                          {t('history.status_in_progress')}{' '}
                          {item.progressTotal && item.progressTotal > 0
                            ? `(${item.progressCurrent || 0}/${item.progressTotal})`
                            : ''}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center space-x-2 text-[10px] text-slate-400">
                        <span>{t('history.slides_label', { count: item.totalPages })}</span>
                        <span>•</span>
                        <span>{item.timestamp}</span>
                      </div>
                    )}
                  </div>

                  {!isProcessing && (
                    <button
                      onClick={(e) => handleCopyItem(e, item)}
                      disabled={isCopying}
                      className={`p-1.5 rounded-lg border transition shrink-0 cursor-pointer ${
                        isCopied
                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                          : 'bg-background text-slate-400 hover:text-slate-100 border-border hover:border-accent/40'
                      }`}
                      title={isCopied ? t('history.copy_success') : t('history.copy_item')}
                    >
                      {isCopying ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                      ) : isCopied ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              );
            })}

            {/* Sentinel element to trigger next batch when scrolling near bottom */}
            {visibleLimit < items.length && (
              <div ref={sentinelRef} className="py-2.5 flex items-center justify-center space-x-2 text-slate-500">
                <Loader2 className="w-3 h-3 animate-spin text-accent" />
                <span className="text-[10px] font-mono">
                  {t('history.loaded_count', { current: visibleLimit, total: items.length })}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Floating Teaser Hover Preview for Slide 1 (Deckblatt) */}
      {previewInfo && (
        <div
          style={{ top: `${previewInfo.top}px` }}
          className="fixed right-[calc(24rem+1.5rem)] w-[28rem] max-w-[calc(100vw-27rem)] z-50 pointer-events-none transition-all duration-200"
        >
          <div className="glass-card rounded-2xl p-5 border border-border/80 shadow-2xl space-y-3.5 bg-card/95 backdrop-blur-xl pointer-events-auto overflow-hidden">
            {/* Top Bar: Slide 1 Badge & File Info */}
            <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3">
              <div className="flex items-center space-x-2 min-w-0 flex-1">
                <span className="p-1.5 bg-accent/15 text-accent rounded-lg shrink-0">
                  <FileText className="w-3.5 h-3.5" />
                </span>
                <span className="text-xs font-bold text-slate-100 truncate" title={previewInfo.item.fileName}>
                  {previewInfo.item.fileName}
                </span>
              </div>
              <span className="text-[10px] font-semibold text-accent bg-accent/10 px-2.5 py-1 rounded-full border border-accent/30 shrink-0 whitespace-nowrap">
                {t('history.slide_1_preview')}
              </span>
            </div>

            {/* Slide Content */}
            {isPreviewLoading ? (
              <div className="py-8 flex flex-col items-center justify-center space-y-2">
                <Loader2 className="w-5 h-5 animate-spin text-accent" />
                <span className="text-[10px] text-slate-400">
                  {t('history.loading_preview')}
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                {previewInfo.title && (
                  <h4 className="text-xs font-bold text-slate-200 line-clamp-2 leading-snug px-0.5">
                    {previewInfo.title}
                  </h4>
                )}
                {previewInfo.slideContent ? (
                  <div className="text-[11px] font-mono text-slate-300 bg-background/90 p-3.5 rounded-xl border border-border/60 max-h-56 overflow-y-auto custom-scrollbar whitespace-pre-wrap leading-relaxed break-words shadow-inner">
                    {previewInfo.slideContent}
                  </div>
                ) : (
                  <div className="text-[11px] italic text-slate-400 bg-background/90 p-3 rounded-xl border border-border/50">
                    {previewInfo.item.fileName}
                  </div>
                )}
              </div>
            )}

            {/* Footer: Quick Hint */}
            <div className="flex items-center justify-between text-[10px] text-slate-400 pt-2 border-t border-border/40 px-0.5">
              <span>{t('history.slides_label', { count: previewInfo.totalSlides })}</span>
              <span className="text-accent font-medium">{t('history.click_to_open')}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HistorySidebar;
