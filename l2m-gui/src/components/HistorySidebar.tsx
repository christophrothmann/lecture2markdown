import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { History, Trash2, Loader2, Copy, Check, X, FileText, ListChecks, CheckSquare, Square, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HistoryItem } from '../utils/historyStorage';
import { parseMarkdownSlides } from '../utils/slideParser';
import type { BatchQueueItem } from './BatchQueue';

export type { HistoryItem };

interface HistorySidebarProps {
  items: HistoryItem[];
  queueItems?: BatchQueueItem[];
  selectedItemId?: string | null;
  isOpen?: boolean;
  onSelect: (item: HistoryItem) => void | Promise<void>;
  onClear: () => void;
  onDeleteItems?: (itemIds: string[]) => void;
  onResolveContent?: (item: HistoryItem) => Promise<string>;
  onRemoveQueueItem?: (id: string) => void;
  onOpenBatchQueue?: () => void;
  onClose?: () => void;
}

const INITIAL_BATCH_SIZE = 12;
const BATCH_INCREMENT = 10;

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  items,
  queueItems,
  selectedItemId,
  isOpen,
  onSelect,
  onClear,
  onDeleteItems,
  onResolveContent,
  onRemoveQueueItem,
  onOpenBatchQueue,
  onClose,
}) => {
  const { t } = useTranslation();

  // Multi-Selection State for Selective Deletion
  const [isSelectMode, setIsSelectMode] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Incremental Lazy-Rendering (Virtual / Infinite Window)
  const [visibleLimit, setVisibleLimit] = useState<number>(INITIAL_BATCH_SIZE);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isCopyingId, setIsCopyingId] = useState<string | null>(null);

  // Hover Preview State (Interactive Flyout with Slide 1, 2 & scrollable slides)
  interface PreviewSlide {
    slideNumber: number;
    title: string;
    content: string;
  }

  interface PreviewInfo {
    item: HistoryItem;
    title: string;
    slides: PreviewSlide[];
    totalSlides: number;
    targetTop: number;
  }
  const [previewInfo, setPreviewInfo] = useState<PreviewInfo | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheRef = useRef<Map<string, { title: string; slides: PreviewSlide[]; totalSlides: number }>>(new Map());
  const previewCardRef = useRef<HTMLDivElement | null>(null);

  const cancelCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const forceClosePreview = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    cancelCloseTimer();
    setPreviewInfo(null);
  };

  const scheduleClosePreview = (delay = 300) => {
    cancelCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setPreviewInfo(null);
      closeTimerRef.current = null;
    }, delay);
  };

  // Force close preview immediately whenever the sidebar drawer closes
  useEffect(() => {
    if (isOpen === false) {
      forceClosePreview();
    }
  }, [isOpen]);

  // Dynamically clamp preview card position with generous bottom margin (56px) directly via DOM style (no re-render loop)
  useLayoutEffect(() => {
    if (!previewInfo || !previewCardRef.current) return;
    const cardEl = previewCardRef.current;
    const cardHeight = cardEl.offsetHeight;
    const windowHeight = window.innerHeight;
    const BOTTOM_PADDING = 56; // 56px (~3.5rem) - generous margin above the bottom window edge/dock
    const TOP_PADDING = 24;    // 24px (~1.5rem) - comfortable top margin

    let top = previewInfo.targetTop;
    // Clamp bottom: ensure the preview card stays well above the bottom edge
    if (top + cardHeight > windowHeight - BOTTOM_PADDING) {
      top = Math.max(TOP_PADDING, windowHeight - BOTTOM_PADDING - cardHeight);
    }
    // Clamp top: ensure the preview card never overflows the top margin
    if (top < TOP_PADDING) {
      top = TOP_PADDING;
    }

    cardEl.style.top = `${top}px`;
  }, [previewInfo, isPreviewLoading]);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  // Reset or prune selection if items change
  useEffect(() => {
    if (items.length === 0) {
      if (isSelectMode) setIsSelectMode(false);
      if (selectedIds.size > 0) setSelectedIds(new Set());
    } else if (selectedIds.size > 0) {
      const validIds = new Set(items.map((it) => it.id));
      const filtered = new Set(Array.from(selectedIds).filter((id) => validIds.has(id)));
      if (filtered.size !== selectedIds.size) {
        setSelectedIds(filtered);
      }
    }
  }, [items, isSelectMode, selectedIds]);

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
    cancelCloseTimer();
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

  const allSelected = items.length > 0 && selectedIds.size === items.length;

  const handleToggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((it) => it.id)));
    }
  };

  const handleToggleItemSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (window.confirm(t('history.delete_selected_confirm', { count }))) {
      const idsToDelete = Array.from(selectedIds);
      if (onDeleteItems) {
        onDeleteItems(idsToDelete);
      } else if (count === items.length) {
        onClear();
      }
      setSelectedIds(new Set());
      setIsSelectMode(false);
    }
  };

  const handleItemMouseEnter = (e: React.MouseEvent<HTMLDivElement>, item: HistoryItem) => {
    if (isOpen === false || isSelectMode || item.status === 'processing') return;

    cancelCloseTimer();

    // If already showing preview for this item, keep it active
    if (previewInfo && previewInfo.item.id === item.id) {
      return;
    }

    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
    }

    const target = e.currentTarget;

    hoverTimerRef.current = setTimeout(async () => {
      const rect = target.getBoundingClientRect();
      const targetTop = rect.top;

      // Check cache first for 0ms response
      if (cacheRef.current.has(item.id)) {
        const cached = cacheRef.current.get(item.id)!;
        // Refresh position in Map for LRU order
        cacheRef.current.delete(item.id);
        cacheRef.current.set(item.id, cached);
        setPreviewInfo({
          item,
          title: cached.title,
          slides: cached.slides,
          totalSlides: cached.totalSlides,
          targetTop,
        });
        return;
      }

      // Show loader state
      setIsPreviewLoading(true);
      setPreviewInfo({
        item,
        title: item.fileName.replace(/\.(pdf|md)$/i, ''),
        slides: [],
        totalSlides: item.totalPages || 1,
        targetTop,
      });

      try {
        let content = item.content;
        if ((!content || !content.trim()) && onResolveContent) {
          content = await onResolveContent(item);
        }

        let title = item.fileName.replace(/\.(pdf|md)$/i, '');
        let previewSlides: PreviewSlide[] = [];
        let totalSlides = item.totalPages || 1;

        if (content && content.trim()) {
          const parsed = parseMarkdownSlides(content);
          if (parsed.length > 0) {
            totalSlides = parsed.length;
            if (parsed[0].title) title = parsed[0].title;
            // Provide parsed slides (up to 12) so user can scroll through slide 1, slide 2, etc.
            previewSlides = parsed.slice(0, 12).map((s) => {
              const cleanContent = s.content
                .replace(/^##\s*\[?(?:Folie|Slide)?\s*\d+\]?[^\n]*\n*/i, '')
                .trim();
              return {
                slideNumber: s.slideNumber,
                title: s.title,
                content: cleanContent || s.content.trim(),
              };
            });
          } else {
            const lines = content.split('\n').slice(0, 25).join('\n').trim();
            previewSlides = [
              {
                slideNumber: 1,
                title: 'Folie 1',
                content: lines,
              },
            ];
          }
        }

        const resolved = { title, slides: previewSlides, totalSlides };
        // Enforce LRU cap of 50 items to keep memory footprint minimal
        while (cacheRef.current.size >= 50) {
          const oldestKey = cacheRef.current.keys().next().value;
          if (oldestKey) cacheRef.current.delete(oldestKey);
          else break;
        }
        cacheRef.current.set(item.id, resolved);

        setPreviewInfo((current) => {
          if (!current || current.item.id !== item.id) return current;
          return {
            item,
            title,
            slides: previewSlides,
            totalSlides,
            targetTop,
          };
        });
      } catch (err) {
        console.error('Fehler beim Laden der Folien-Vorschau:', err);
      } finally {
        setIsPreviewLoading(false);
      }
    }, 250);
  };

  const handleItemMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    scheduleClosePreview(300);
  };

  const handlePreviewMouseEnter = () => {
    if (isOpen === false) return;
    cancelCloseTimer();
  };

  const handlePreviewMouseLeave = () => {
    scheduleClosePreview(300);
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

  const activeQueueItems = (queueItems || []).filter(
    (q) => q.status === 'processing' || q.status === 'pending'
  );

  const activeQueueKeys = new Set(
    activeQueueItems.map((q) => (q.filePath || q.fileName.replace(/\.(pdf|md)$/i, '')).toLowerCase().trim())
  );
  const filteredHistoryItems = items.filter((h) => {
    if (h.status === 'processing') return false;
    const hKey = (h.filePath || h.fileName.replace(/\.(pdf|md)$/i, '')).toLowerCase().trim();
    return !activeQueueKeys.has(hKey);
  });

  const visibleItems = filteredHistoryItems.slice(0, visibleLimit);
  const totalItemCount = filteredHistoryItems.length + activeQueueItems.length;

  return (
    <div className="glass-card rounded-2xl p-5 space-y-4 flex flex-col h-full">
      {/* Header */}
      {!isSelectMode ? (
        <div className="flex items-center justify-between border-b border-border pb-3 shrink-0">
          <div className="flex items-center space-x-2 text-slate-200">
            <History className="w-4 h-4 text-accent" />
            <h3 className="text-xs font-bold uppercase tracking-wider">{t('history.title')}</h3>
            {totalItemCount > 0 && (
              <span className="text-[10px] text-slate-400 bg-surface px-1.5 py-0.5 rounded-full border border-border">
                {totalItemCount}
              </span>
            )}
          </div>

          <div className="flex items-center space-x-1.5">
            {items.length > 0 && (
              <button
                onClick={() => setIsSelectMode(true)}
                className="inline-flex items-center space-x-1 text-xs text-slate-400 hover:text-slate-100 px-2 py-1 hover:bg-surface-hover rounded-lg transition cursor-pointer border border-transparent hover:border-border"
                title={t('history.select_mode')}
              >
                <ListChecks className="w-3.5 h-3.5 text-accent" />
                <span>{t('history.select_mode')}</span>
              </button>
            )}

            {onClose && (
              <button
                onClick={() => {
                  forceClosePreview();
                  onClose();
                }}
                className="text-slate-400 hover:text-slate-200 p-1 hover:bg-surface-hover rounded-lg transition cursor-pointer"
                title={t('common.close', { defaultValue: 'Schließen' })}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between border-b border-border pb-3 shrink-0">
          <button
            onClick={handleToggleSelectAll}
            className="flex items-center space-x-1.5 text-xs text-slate-200 hover:text-white transition cursor-pointer font-medium"
            title={allSelected ? t('history.deselect_all') : t('history.select_all')}
          >
            {allSelected ? (
              <CheckSquare className="w-4 h-4 text-accent" />
            ) : (
              <Square className="w-4 h-4 text-slate-400" />
            )}
            <span className="text-xs">
              {selectedIds.size > 0
                ? t('history.selected_count', { count: selectedIds.size })
                : t('history.select_all')}
            </span>
          </button>

          <div className="flex items-center space-x-1.5">
            <button
              onClick={handleDeleteSelected}
              disabled={selectedIds.size === 0}
              className={`inline-flex items-center space-x-1 text-xs px-2.5 py-1 rounded-lg transition cursor-pointer font-medium ${
                selectedIds.size > 0
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                  : 'bg-surface text-slate-500 border border-border cursor-not-allowed opacity-50'
              }`}
              title={t('history.delete_selected', { count: selectedIds.size })}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t('history.delete_selected', { count: selectedIds.size })}</span>
            </button>

            <button
              onClick={() => {
                setIsSelectMode(false);
                setSelectedIds(new Set());
              }}
              className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1 hover:bg-surface-hover rounded-lg transition cursor-pointer border border-border"
            >
              {t('history.cancel_selection')}
            </button>
          </div>
        </div>
      )}

      {/* Scrollable Items List with Lazy Loading Window */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-1 custom-scrollbar"
      >
        {totalItemCount === 0 ? (
          <p className="text-xs text-slate-500 text-center py-6">
            {t('history.empty_title')}
          </p>
        ) : (
          <>
            {/* Active Queue Items (Wird konvertiert & In Warteschlange in blue/accent tone) */}
            {!isSelectMode &&
              activeQueueItems.map((qItem) => {
                const isProcessing = qItem.status === 'processing';
                const effectiveTotal =
                  qItem.rangeMode === 'custom'
                    ? qItem.endPage - qItem.startPage + 1
                    : qItem.totalPages;

                return (
                  <div
                    key={`queue-${qItem.id}`}
                    onClick={() => {
                      forceClosePreview();
                      if (onOpenBatchQueue) {
                        onOpenBatchQueue();
                      }
                      if (onClose) {
                        onClose();
                      }
                    }}
                    className={`p-3 border rounded-xl transition group flex items-center justify-between cursor-pointer ${
                      isProcessing
                        ? 'border-accent/40 bg-accent/5 shadow-sm shadow-accent/5'
                        : 'border-accent/25 bg-accent/5 hover:bg-accent/10'
                    }`}
                    title={t('batch.back_to_queue')}
                  >
                    <div className="space-y-1.5 min-w-0 pr-2 flex-1">
                      <p className="text-xs font-semibold truncate text-accent font-bold">
                        {qItem.fileName}
                      </p>

                      {isProcessing ? (
                        <div className="inline-flex items-center space-x-1.5 px-2 py-0.5 bg-accent/15 border border-accent/30 rounded-md text-[10px] text-accent font-medium">
                          <Loader2 className="w-3 h-3 animate-spin text-accent" />
                          <span>
                            {t('history.status_converting')}{' '}
                            {`(${qItem.progressCurrent || 0}/${qItem.progressTotal || effectiveTotal})`}
                          </span>
                        </div>
                      ) : (
                        <div className="inline-flex items-center space-x-1.5 px-2 py-0.5 bg-slate-800/80 border border-slate-700 rounded-md text-[10px] text-slate-300 font-medium">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span>{t('history.status_queued')}</span>
                        </div>
                      )}
                    </div>

                    {!isProcessing && onRemoveQueueItem && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveQueueItem(qItem.id);
                        }}
                        className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition cursor-pointer shrink-0"
                        title={t('common.delete')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}

            {visibleItems.map((item) => {
              const isProcessing = item.status === 'processing';
              const isSelected = selectedItemId === item.id;
              const isChecked = selectedIds.has(item.id);
              const isCopying = isCopyingId === item.id;
              const isCopied = copiedId === item.id;

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (isProcessing) return;
                    if (isSelectMode) {
                      handleToggleItemSelect(item.id);
                    } else {
                      forceClosePreview();
                      onSelect(item);
                    }
                  }}
                  onMouseEnter={(e) => handleItemMouseEnter(e, item)}
                  onMouseLeave={handleItemMouseLeave}
                  className={`p-3 border rounded-xl transition group flex items-center justify-between ${
                    isProcessing
                      ? 'border-accent/40 bg-accent/5 cursor-default'
                      : isSelectMode
                        ? isChecked
                          ? 'bg-accent/15 border-accent shadow-sm cursor-pointer'
                          : 'bg-card/80 hover:bg-surface-hover border-border/70 cursor-pointer'
                        : isSelected
                          ? 'bg-accent/15 border-accent shadow-sm cursor-pointer'
                          : 'bg-card/80 hover:bg-surface-hover border-border/70 cursor-pointer'
                  }`}
                >
                  {isSelectMode && (
                    <div className="mr-2.5 shrink-0 flex items-center">
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center transition ${
                          isChecked
                            ? 'bg-accent border-accent text-white'
                            : 'border-slate-500 group-hover:border-slate-300 bg-background/50'
                        }`}
                      >
                        {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5 min-w-0 pr-2 flex-1">
                    <p
                      className={`text-xs font-semibold truncate transition ${
                        isProcessing || (!isSelectMode && isSelected) || (isSelectMode && isChecked)
                          ? 'text-accent font-bold'
                          : 'text-slate-200 group-hover:text-accent'
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

                  {!isProcessing && !isSelectMode && (
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

      {/* Floating Interactive Hover Preview for Slide 1, 2 & scrollable slides */}
      {previewInfo && (
        <div
          ref={previewCardRef}
          onMouseEnter={handlePreviewMouseEnter}
          onMouseLeave={handlePreviewMouseLeave}
          style={{
            top: `${Math.max(24, Math.min(previewInfo.targetTop, window.innerHeight - 450))}px`,
          }}
          className="fixed right-[calc(24rem+0.5rem)] w-[28rem] max-w-[calc(100vw-26rem)] max-h-[calc(100vh-6rem)] z-50 transition-all duration-150 flex flex-col pointer-events-auto"
        >
          {/* Invisible hit-test bridge extending 16px to the right towards the sidebar drawer */}
          <div className="absolute top-0 -right-4 w-6 h-full pointer-events-auto" />

          <div className="bg-card rounded-2xl p-4 border border-border shadow-2xl space-y-3 pointer-events-auto overflow-hidden flex flex-col max-h-full">
            {/* Top Bar: File Info & Quick Open Button */}
            <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2.5 shrink-0">
              <div className="flex items-center space-x-2 min-w-0 flex-1">
                <span className="p-1.5 bg-accent/15 text-accent rounded-lg shrink-0">
                  <FileText className="w-3.5 h-3.5" />
                </span>
                <span className="text-xs font-bold text-slate-100 truncate" title={previewInfo.item.fileName}>
                  {previewInfo.item.fileName}
                </span>
              </div>

              <div className="flex items-center space-x-2 shrink-0">
                <span className="text-[10px] text-slate-400 font-medium bg-surface px-2 py-0.5 rounded-full border border-border">
                  {t('history.slides_label', { count: previewInfo.totalSlides })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    forceClosePreview();
                    onSelect(previewInfo.item);
                  }}
                  className="px-2.5 py-1 bg-accent hover:bg-accent-hover text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm shadow-accent/20 shrink-0"
                  title={t('history.click_to_open')}
                >
                  <span>{t('history.open', { defaultValue: 'Öffnen' })}</span>
                </button>
              </div>
            </div>

            {/* Slides Content */}
            {isPreviewLoading ? (
              <div className="py-10 flex flex-col items-center justify-center space-y-2">
                <Loader2 className="w-5 h-5 animate-spin text-accent" />
                <span className="text-[10px] text-slate-400">
                  {t('history.loading_preview')}
                </span>
              </div>
            ) : (
              <div className="space-y-3 flex-1 min-h-0 max-h-[30rem] overflow-y-auto overscroll-contain pr-1.5 custom-scrollbar">
                {previewInfo.slides && previewInfo.slides.length > 0 ? (
                  previewInfo.slides.map((slide) => (
                    <div
                      key={slide.slideNumber}
                      className="space-y-2 bg-surface/40 p-3 rounded-xl border border-border/60 hover:border-border transition"
                    >
                      <div className="flex items-center justify-between text-[11px] font-semibold text-slate-200 px-0.5">
                        <span className="flex items-center gap-1.5 text-accent font-bold truncate">
                          <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                          <span className="truncate">{slide.title}</span>
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono bg-background/80 px-1.5 py-0.5 rounded border border-border/40 shrink-0">
                          #{slide.slideNumber}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-300 bg-background/90 p-2.5 rounded-lg border border-border/40 whitespace-pre-wrap leading-relaxed break-words shadow-inner">
                        {slide.content}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-[11px] italic text-slate-400 bg-background p-3 rounded-xl border border-border/50">
                    {previewInfo.item.fileName}
                  </div>
                )}

                {previewInfo.totalSlides > previewInfo.slides.length && (
                  <div className="py-2 text-center text-[10px] text-slate-500 font-medium">
                    + {previewInfo.totalSlides - previewInfo.slides.length} {t('history.more_slides', { defaultValue: 'weitere Folien' })}
                  </div>
                )}
              </div>
            )}

            {/* Footer: Quick Hint */}
            <div className="flex items-center justify-between text-[10px] text-slate-500 pt-2 border-t border-border/40 px-0.5 shrink-0">
              <span>{t('history.click_to_open')}</span>
              <span className="font-mono">{previewInfo.item.timestamp}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HistorySidebar;
