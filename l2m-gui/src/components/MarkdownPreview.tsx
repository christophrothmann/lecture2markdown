import React, { useState } from 'react';
import { Copy, Save, Check, FileText, PlusCircle } from 'lucide-react';

interface MarkdownPreviewProps {
  content: string;
  fileName: string;
  onSaveFile: () => void;
  onNewConversion: () => void;
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  content,
  fileName,
  onSaveFile,
  onNewConversion,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error('Kopieren fehlgeschlagen:', err);
    }
  };

  const characterCount = content.length;
  const lineCount = content.split('\n').length;

  return (
    <div className="glass-card rounded-2xl p-6 space-y-4 flex flex-col h-full">
      <div className="flex flex-wrap items-center justify-between border-b border-border pb-4 gap-3">
        <div className="flex items-center space-x-2">
          <FileText className="w-5 h-5 text-accent" />
          <div>
            <h3 className="text-sm font-bold text-slate-100">{fileName}</h3>
            <p className="text-[10px] text-slate-400">
              {characterCount.toLocaleString('de-DE')} Zeichen • {lineCount} Zeilen
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onNewConversion}
            className="px-4 py-2 bg-surface hover:bg-surface-hover border border-border text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            title="Neue Vorlesungs-PDF konvertieren"
          >
            <PlusCircle className="w-4 h-4 text-accent" /> Neue Vorlesung
          </button>

          <button
            type="button"
            onClick={onSaveFile}
            className="px-4 py-2 bg-surface hover:bg-surface-hover border border-border text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            title="Speicherort wählen und als .md Datei sichern"
          >
            <Save className="w-4 h-4 text-slate-400" /> Speichern
          </button>

          <button
            type="button"
            onClick={handleCopyAll}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition border cursor-pointer ${
              copied
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                : 'bg-accent hover:bg-accent-hover text-white border-transparent shadow-lg shadow-accent/20'
            }`}
            title="Gesamtes Markdown in Zwischenablage kopieren"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4" /> Kopiert!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" /> Markdown kopieren
              </>
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto max-h-[420px] bg-background/80 p-4 rounded-xl border border-border/50 text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">
        {content}
      </div>
    </div>
  );
};
