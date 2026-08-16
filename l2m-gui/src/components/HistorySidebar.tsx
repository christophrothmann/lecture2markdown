import React from 'react';
import { History, Copy, Trash2, Loader2 } from 'lucide-react';

export interface HistoryItem {
  id: string;
  fileName: string;
  timestamp: string;
  content: string;
  totalPages: number;
  status?: 'processing' | 'completed' | 'error';
  progressCurrent?: number;
  progressTotal?: number;
}

interface HistorySidebarProps {
  items: HistoryItem[];
  onSelect: (item: HistoryItem) => void;
  onClear: () => void;
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  items,
  onSelect,
  onClear,
}) => {
  return (
    <div className="glass-card rounded-2xl p-5 space-y-4 flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center space-x-2 text-slate-200">
          <History className="w-4 h-4 text-accent" />
          <h3 className="text-xs font-bold uppercase tracking-wider">Verlauf</h3>
        </div>

        {items.length > 0 && (
          <button
            onClick={onClear}
            className="text-slate-500 hover:text-rose-400 transition"
            title="Verlauf leeren"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {items.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-6">
            Noch keine Vorlesungen konvertiert.
          </p>
        ) : (
          items.map((item) => {
            const isProcessing = item.status === 'processing';

            return (
              <div
                key={item.id}
                onClick={() => !isProcessing && onSelect(item)}
                className={`p-3 bg-card border rounded-xl transition group flex items-center justify-between ${
                  isProcessing
                    ? 'border-accent/40 bg-accent/5 cursor-default'
                    : 'hover:bg-surface-hover border-border/70 cursor-pointer'
                }`}
              >
                <div className="space-y-1.5 min-w-0 pr-2 flex-1">
                  <p
                    className={`text-xs font-semibold truncate transition ${
                      isProcessing ? 'text-accent' : 'text-slate-200 group-hover:text-accent'
                    }`}
                  >
                    {item.fileName}
                  </p>

                  {isProcessing ? (
                    <div className="inline-flex items-center space-x-1.5 px-2 py-0.5 bg-accent/15 border border-accent/30 rounded-md text-[10px] text-accent font-medium">
                      <Loader2 className="w-3 h-3 animate-spin text-accent" />
                      <span>
                        Verarbeitung läuft...{' '}
                        {item.progressTotal && item.progressTotal > 0
                          ? `(${item.progressCurrent || 0}/${item.progressTotal})`
                          : ''}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-2 text-[10px] text-slate-400">
                      <span>{item.totalPages} Folien</span>
                      <span>•</span>
                      <span>{item.timestamp}</span>
                    </div>
                  )}
                </div>

                {!isProcessing && (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await navigator.clipboard.writeText(item.content);
                        alert('Markdown kopiert!');
                      } catch {
                        alert('Kopieren fehlgeschlagen.');
                      }
                    }}
                    className="p-1.5 bg-background text-slate-400 hover:text-slate-100 rounded-lg border border-border transition shrink-0"
                    title="Kopieren"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
