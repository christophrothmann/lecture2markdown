import React from 'react';
import { Loader2, Zap, Sparkles, Coins } from 'lucide-react';

interface ProgressDashboardProps {
  fileName: string;
  completedPages: number;
  totalPages: number;
  lastModelUsed: string;
}

export const ProgressDashboard: React.FC<ProgressDashboardProps> = ({
  fileName,
  completedPages,
  totalPages,
  lastModelUsed,
}) => {
  const percentage = totalPages > 0 ? Math.round((completedPages / totalPages) * 100) : 0;
  
  // Estimate cost (~0.0001€ per gpt-4o-mini page, ~0.003€ per gpt-4o page)
  const estimatedCostEuro = (completedPages * 0.0003).toFixed(4);

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

        <div className="flex items-center space-x-2">
          {lastModelUsed && (
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
                lastModelUsed === 'gpt-4o'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  : 'bg-blue-500/10 text-blue-400 border-blue-500/30'
              }`}
            >
              {lastModelUsed === 'gpt-4o' ? (
                <>
                  <Sparkles className="w-3.5 h-3.5" /> gpt-4o (Diagramm)
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" /> gpt-4o-mini (Text)
                </>
              )}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-xs font-semibold">
          <span className="text-slate-300">
            Folie {completedPages} von {totalPages}
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
          <span>Geschätzte API-Kosten:</span>
        </div>
        <span className="font-mono text-emerald-400 font-bold">
          ~{estimatedCostEuro} €
        </span>
      </div>
    </div>
  );
};
