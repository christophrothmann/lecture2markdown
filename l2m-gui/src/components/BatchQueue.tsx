import React from 'react';
import {
  Layers,
  FileText,
  Trash2,
  Plus,
  Play,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Clock,
  SlidersHorizontal,
  RefreshCw,
  FolderDown,
} from 'lucide-react';

export interface BatchQueueItem {
  id: string;
  filePath: string;
  fileName: string;
  totalPages: number;
  startPage: number;
  endPage: number;
  rangeMode: 'all' | 'custom';
  status: 'pending' | 'processing' | 'completed' | 'error';
  progressCurrent?: number;
  progressTotal?: number;
  error?: string;
  markdownResult?: string;
}

interface BatchQueueProps {
  items: BatchQueueItem[];
  isConverting: boolean;
  activeProviderName: string;
  onUpdateItemRange: (id: string, start: number, end: number, mode: 'all' | 'custom') => void;
  onRemoveItem: (id: string) => void;
  onAddMoreFiles: () => void;
  onClearQueue: () => void;
  onStartBatch: () => void;
  onCancelBatch: () => void;
}

export const BatchQueue: React.FC<BatchQueueProps> = ({
  items,
  isConverting,
  activeProviderName,
  onUpdateItemRange,
  onRemoveItem,
  onAddMoreFiles,
  onClearQueue,
  onStartBatch,
  onCancelBatch,
}) => {
  const batchStartTimeRef = React.useRef<number>(Date.now());

  React.useEffect(() => {
    if (isConverting) {
      batchStartTimeRef.current = Date.now();
    }
  }, [isConverting]);

  const totalSlides = items.reduce((acc, item) => {
    const count = item.rangeMode === 'custom' ? item.endPage - item.startPage + 1 : item.totalPages;
    return acc + Math.max(1, count);
  }, 0);

  const completedSlides = items.reduce((acc, item) => {
    if (item.status === 'completed') {
      return acc + (item.rangeMode === 'custom' ? item.endPage - item.startPage + 1 : item.totalPages);
    }
    if (item.status === 'processing') {
      return acc + (item.progressCurrent || 0);
    }
    return acc;
  }, 0);

  const completedItems = items.filter((i) => i.status === 'completed').length;
  const processingItem = items.find((i) => i.status === 'processing');

  const elapsed = (Date.now() - batchStartTimeRef.current) / 1000;
  const avgPerSlide = completedSlides > 0 ? elapsed / completedSlides : 0;
  const remainingSlides = Math.max(0, totalSlides - completedSlides);
  const estSeconds = Math.round(remainingSlides * avgPerSlide);

  const formatBatchEta = (seconds: number): string => {
    if (completedSlides === 0) return 'Berechne Restzeit...';
    if (seconds <= 0) return 'Gleich fertig...';
    if (seconds < 60) return `~${seconds}s verbleibend`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `~${mins}m ${secs}s verbleibend` : `~${mins}m verbleibend`;
  };

  const batchEtaText = formatBatchEta(estSeconds);

  return (
    <div className="glass-card rounded-2xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 pb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-accent/20 text-accent rounded-xl">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              Batch-Warteschlange
              <span className="px-2 py-0.5 bg-surface text-slate-300 rounded-full text-xs font-mono font-semibold border border-border">
                {items.length} {items.length === 1 ? 'Dokument' : 'Dokumente'}
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Automatische Abarbeitung via <strong className="text-slate-200">{activeProviderName}</strong> • {totalSlides} Folien gesamt
            </p>
          </div>
        </div>

        {!isConverting && (
          <div className="flex items-center space-x-2">
            <button
              onClick={onAddMoreFiles}
              className="px-3 py-1.5 bg-surface hover:bg-surface-hover border border-border text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              title="Weitere PDFs hinzufügen"
            >
              <Plus className="w-3.5 h-3.5 text-accent" /> Mehr hinzufügen
            </button>
            <button
              onClick={onClearQueue}
              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition cursor-pointer"
              title="Warteschlange leeren"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Global Progress when Converting */}
      {isConverting && (
        <div className="bg-surface/90 border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-200 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-accent" />
              <span>
                Dokument {completedItems + 1} von {items.length}
                {processingItem && <span className="text-slate-400 font-normal"> ({processingItem.fileName})</span>}
              </span>
              <span className="text-slate-400 font-normal flex items-center gap-1 text-[11px]">
                • <Clock className="w-3 h-3 text-accent" /> {batchEtaText}
              </span>
            </span>
            <span className="font-mono text-accent font-bold">
              {Math.round((completedSlides / (totalSlides || 1)) * 100)}%
            </span>
          </div>

          <div className="w-full h-2.5 bg-background border border-border rounded-full overflow-hidden p-0.5">
            <div
              className="h-full bg-accent rounded-full transition-all duration-300 ease-out"
              style={{ width: `${Math.round((completedSlides / (totalSlides || 1)) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Queue Items List */}
      <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
        {items.map((item, index) => {
          const effectivePages = item.rangeMode === 'custom' ? item.endPage - item.startPage + 1 : item.totalPages;

          return (
            <div
              key={item.id}
              className={`p-4 rounded-xl border transition-all ${
                item.status === 'processing'
                  ? 'bg-accent/5 border-accent shadow-md shadow-accent/5'
                  : item.status === 'completed'
                  ? 'bg-emerald-500/5 border-emerald-500/20'
                  : item.status === 'error'
                  ? 'bg-rose-500/5 border-rose-500/20'
                  : 'bg-card/70 border-border hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                {/* File Title & Icon */}
                <div className="flex items-center space-x-3 min-w-0 flex-1">
                  <div className="p-2 bg-surface border border-border rounded-xl text-accent flex-shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-xs font-bold text-slate-200 truncate">{item.fileName}</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {item.totalPages > 0 ? (
                        <span>
                          {effectivePages} von {item.totalPages} Folien{' '}
                          {item.rangeMode === 'custom' && (
                            <span className="text-accent font-semibold">(Folien {item.startPage}–{item.endPage})</span>
                          )}
                        </span>
                      ) : (
                        <span>Lade Metadaten...</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Status Badge */}
                <div className="flex items-center space-x-3 flex-shrink-0">
                  {item.status === 'pending' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-surface border border-border text-slate-400 rounded-lg text-[11px] font-medium">
                      <Clock className="w-3 h-3" />
                      <span>Wartend</span>
                    </span>
                  )}

                  {item.status === 'processing' && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-accent/20 text-accent border border-accent/40 rounded-lg text-[11px] font-bold animate-pulse">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>
                        Folie {item.progressCurrent || 0}/{item.progressTotal || effectivePages}
                      </span>
                    </span>
                  )}

                  {item.status === 'completed' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-lg text-[11px] font-bold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Gespeichert</span>
                    </span>
                  )}

                  {item.status === 'error' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/30 rounded-lg text-[11px] font-bold">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>Fehler</span>
                    </span>
                  )}

                  {!isConverting && item.status === 'pending' && (
                    <button
                      onClick={() => onRemoveItem(item.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition cursor-pointer"
                      title="Aus Warteschlange entfernen"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Per-item Range Editor (When not converting & pending) */}
              {!isConverting && item.status === 'pending' && item.totalPages > 1 && (
                <div className="mt-3 pt-3 border-t border-border/40 flex items-center justify-between text-[11px]">
                  <div className="flex items-center space-x-2">
                    <span className="text-slate-400 flex items-center gap-1">
                      <SlidersHorizontal className="w-3 h-3 text-slate-500" />
                      Bereich:
                    </span>
                    <button
                      onClick={() => onUpdateItemRange(item.id, 1, item.totalPages, 'all')}
                      className={`px-2 py-0.5 rounded transition ${
                        item.rangeMode === 'all'
                          ? 'bg-accent text-white font-bold'
                          : 'bg-surface text-slate-400 hover:text-slate-200 border border-border'
                      }`}
                    >
                      Alle
                    </button>
                    <button
                      onClick={() => onUpdateItemRange(item.id, item.startPage, item.endPage, 'custom')}
                      className={`px-2 py-0.5 rounded transition ${
                        item.rangeMode === 'custom'
                          ? 'bg-accent text-white font-bold'
                          : 'bg-surface text-slate-400 hover:text-slate-200 border border-border'
                      }`}
                    >
                      Benutzerdefiniert
                    </button>
                  </div>

                  {item.rangeMode === 'custom' && (
                    <div className="flex items-center space-x-1.5 text-slate-300">
                      <span>Von:</span>
                      <input
                        type="number"
                        min={1}
                        max={item.endPage}
                        value={item.startPage}
                        onChange={(e) => {
                          const v = parseInt(e.target.value) || 1;
                          onUpdateItemRange(item.id, Math.max(1, Math.min(v, item.endPage)), item.endPage, 'custom');
                        }}
                        className="w-12 bg-surface border border-border rounded px-1.5 py-0.5 text-center font-mono font-bold text-slate-100"
                      />
                      <span>bis:</span>
                      <input
                        type="number"
                        min={item.startPage}
                        max={item.totalPages}
                        value={item.endPage}
                        onChange={(e) => {
                          const v = parseInt(e.target.value) || item.startPage;
                          onUpdateItemRange(item.id, item.startPage, Math.max(item.startPage, Math.min(v, item.totalPages)), 'custom');
                        }}
                        className="w-12 bg-surface border border-border rounded px-1.5 py-0.5 text-center font-mono font-bold text-slate-100"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Action Footer */}
      <div className="pt-2 flex items-center justify-between border-t border-border/60">
        <div className="text-xs text-slate-400 flex items-center gap-1.5">
          <FolderDown className="w-4 h-4 text-emerald-400" />
          <span>Markdown-Dateien werden automatisch neben den PDFs gespeichert</span>
        </div>

        <div className="flex items-center space-x-3">
          {isConverting ? (
            <button
              onClick={onCancelBatch}
              className="px-5 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-bold transition cursor-pointer"
            >
              Batch abbrechen
            </button>
          ) : (
            <button
              onClick={onStartBatch}
              disabled={items.length === 0}
              className="px-6 py-3 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition cursor-pointer shadow-lg shadow-accent/20"
            >
              <Play className="w-4 h-4 fill-white" />
              Batch starten ({items.length} {items.length === 1 ? 'Datei' : 'Dateien'}, {totalSlides} Folien)
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
