import React, { useState, useEffect, useRef } from 'react';
import { History, Trash2, Loader2, Copy, Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HistoryItem } from '../utils/historyStorage';

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

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

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
    const target = e.currentTarget;
    if (target.scrollTop + target.clientHeight >= target.scrollHeight - 80) {
      if (visibleLimit < items.length) {
        setVisibleLimit((prev) => Math.min(prev + BATCH_INCREMENT, items.length));
      }
    }
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
    </div>
  );
};

export default HistorySidebar;
