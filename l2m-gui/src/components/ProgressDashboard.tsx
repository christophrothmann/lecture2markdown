import React, { useState, useEffect, useRef } from 'react';
import { Loader2, Zap, Sparkles, Coins, CheckCircle2, XCircle, Clock } from 'lucide-react';

interface ProgressDashboardProps {
  fileName: string;
  completedPages: number;
  totalPages: number;
  lastModelUsed: string;
  usedModels?: string[];
  onCancel?: () => void;
}

// Exact cost rates in EUR per slide from LiteLLM model_prices_and_context_window.json
const LITELLM_RATES_EUR: Record<string, number> = {
  // Google Gemini
  'gemini-2.0-flash': 0.00015,
  'gemini-1.5-pro': 0.0030,
  // OpenAI
  'gpt-4o-mini': 0.0003,
  'gpt-4o': 0.0045,
  // Anthropic Claude
  'claude-3-5-haiku': 0.0015,
  'claude-3-7-sonnet': 0.0060,
  // Mistral AI
  'pixtral-12b-2409': 0.0002,
  'mistral-ocr-latest': 0.0010,
  // Instant Cache-Hit
  'cache-hit': 0.0000,
};

const getModelRate = (modelName: string): number => {
  const m = (modelName || '').toLowerCase();
  if (m === 'cache-hit') return 0.0;
  for (const [key, rate] of Object.entries(LITELLM_RATES_EUR)) {
    if (m.includes(key.toLowerCase())) return rate;
  }
  if (m.includes('pro') || m.includes('sonnet') || m.includes('ocr') || (m.includes('gpt-4o') && !m.includes('mini'))) {
    return 0.004;
  }
  return 0.0003;
};

const formatEta = (seconds: number): string => {
  if (seconds <= 0) return 'Gleich fertig...';
  if (seconds < 60) return `~${seconds}s verbleibend`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `~${mins}m ${secs}s verbleibend` : `~${mins}m verbleibend`;
};

export const ProgressDashboard: React.FC<ProgressDashboardProps> = ({
  fileName,
  completedPages,
  totalPages,
  lastModelUsed,
  usedModels = [],
  onCancel,
}) => {
  const startTimeRef = useRef<number>(Date.now());
  const [etaText, setEtaText] = useState<string>('Berechne Restzeit...');

  useEffect(() => {
    if (completedPages === 0) {
      startTimeRef.current = Date.now();
      setEtaText('Berechne Restzeit...');
    } else {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const avgPerSlide = elapsed / completedPages;
      const remaining = Math.max(0, totalPages - completedPages);
      const estSeconds = Math.round(remaining * avgPerSlide);
      setEtaText(formatEta(estSeconds));
    }
  }, [completedPages, totalPages]);

  const percentage = totalPages > 0 ? Math.round((completedPages / totalPages) * 100) : 0;
  
  // Calculate exact dynamic accumulated costs based on each completed slide's model
  const accumulatedCost = usedModels.length > 0
    ? usedModels.reduce((acc, m) => acc + getModelRate(m), 0)
    : completedPages * getModelRate(lastModelUsed);

  const formattedCost = accumulatedCost.toFixed(4);

  const isCache = (lastModelUsed || '').toLowerCase() === 'cache-hit';

  const isVisual = (model: string) => {
    const m = (model || '').toLowerCase();
    return (
      m.includes('pro') ||
      m.includes('sonnet') ||
      m.includes('ocr') ||
      m.includes('large') ||
      (m.includes('gpt-4o') && !m.includes('mini'))
    );
  };

  const isVision = isVisual(lastModelUsed);

  return (
    <div className="glass-card rounded-2xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-accent/20 text-accent rounded-xl">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-100">{fileName}</h4>
            <p className="text-xs text-slate-400">Verarbeite Vorlesung...</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {lastModelUsed && (
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
                isCache
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : isVision
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  : 'bg-blue-500/10 text-blue-400 border-blue-500/30'
              }`}
            >
              {isCache ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>⚡ Cache-Hit (0.00 €)</span>
                </>
              ) : isVision ? (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>{lastModelUsed} (Vision)</span>
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5 text-blue-400" />
                  <span>{lastModelUsed} (Text)</span>
                </>
              )}
            </span>
          )}

          {onCancel && (
            <button
              onClick={onCancel}
              className="inline-flex items-center space-x-1.5 px-3 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-full text-xs font-semibold transition cursor-pointer"
              title="Konvertierung abbrechen"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>Abbrechen</span>
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-xs font-semibold">
          <span className="text-slate-300 flex items-center gap-2">
            <span>Folie {completedPages} von {totalPages}</span>
            {totalPages > 0 && completedPages < totalPages && (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 font-normal">
                • <Clock className="w-3 h-3 text-accent" /> {etaText}
              </span>
            )}
          </span>
          <span className="text-accent font-mono">{percentage}%</span>
        </div>

        <div className="w-full h-3 bg-background border border-border rounded-full overflow-hidden p-0.5">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300 ease-out"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-400 bg-background/60 p-3 rounded-xl border border-border/50">
        <div className="flex items-center space-x-2">
          <Coins className="w-4 h-4 text-emerald-400" />
          <span>Geschätzte API-Kosten (LiteLLM-Tarife):</span>
        </div>
        <span className="font-mono text-emerald-400 font-bold">
          ~{formattedCost} €
        </span>
      </div>
    </div>
  );
};
