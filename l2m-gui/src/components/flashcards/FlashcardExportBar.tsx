import React from 'react';
import {
  Download,
  Copy,
  Check,
  ExternalLink,
  Zap,
  Loader2,
} from 'lucide-react';
import { useTranslation, Trans } from 'react-i18next';

interface FlashcardExportBarProps {
  deckName: string;
  setDeckName: (name: string) => void;
  counts: {
    all: number;
    currentSlide: number;
    enabled: number;
  };
  isAnkiConnectOnline: boolean;
  copiedTsv: boolean;
  isExportingApkg: boolean;
  isOpeningInAnki: boolean;
  isSyncingAnkiConnect: boolean;
  onCopyTsv: () => void;
  onSaveApkgFile: () => void;
  onOpenInAnki: () => void;
  onAnkiConnectSync: () => void;
}

export const FlashcardExportBar: React.FC<FlashcardExportBarProps> = ({
  deckName,
  setDeckName,
  counts,
  isAnkiConnectOnline,
  copiedTsv,
  isExportingApkg,
  isOpeningInAnki,
  isSyncingAnkiConnect,
  onCopyTsv,
  onSaveApkgFile,
  onOpenInAnki,
  onAnkiConnectSync,
}) => {
  const { t } = useTranslation();

  return (
    <div className="p-3.5 bg-surface/70 border border-border/80 rounded-xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
      {/* Left: Deck Name & Status */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold text-slate-300">{t('flashcards.deck_label')}</span>
          <input
            type="text"
            value={deckName}
            onChange={(e) => setDeckName(e.target.value)}
            className="px-2.5 py-1 text-xs bg-surface border border-border rounded-lg text-slate-100 focus:outline-none focus:border-accent max-w-[200px]"
            placeholder={t('flashcards.deck_placeholder')}
          />
        </div>

        <span className="text-xs text-slate-400">
          <Trans
            i18nKey="flashcards.active_count"
            values={{ enabled: counts.enabled, total: counts.all }}
            components={[<strong className="text-slate-200" key="0" />]}
          />
        </span>

        {/* AnkiConnect Status Indicator */}
        <div className="flex items-center space-x-1.5 text-xs text-slate-400">
          <span
            className={`w-2 h-2 rounded-full ${
              isAnkiConnectOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
            }`}
          />
          <span className="text-[11px]">
            {isAnkiConnectOnline ? t('flashcards.ankiconnect_active') : t('flashcards.ankiconnect_optional')}
          </span>
        </div>
      </div>

      {/* Right: Export Action Buttons */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* Copy TSV */}
        <button
          type="button"
          onClick={onCopyTsv}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-surface hover:bg-surface-hover border border-border text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
          title={t('flashcards.copy_tsv_tooltip')}
        >
          {copiedTsv ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copiedTsv ? t('flashcards.copied_tsv') : t('flashcards.copy_tsv')}</span>
        </button>

        {/* Save .apkg File */}
        <button
          type="button"
          onClick={onSaveApkgFile}
          disabled={isExportingApkg || counts.enabled === 0}
          className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-surface hover:bg-surface-hover border border-border text-slate-200 rounded-xl text-xs font-semibold transition cursor-pointer disabled:opacity-50"
          title={t('flashcards.save_apkg_tooltip')}
        >
          {isExportingApkg ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5 text-amber-400" />
          )}
          <span>{t('flashcards.save_apkg')}</span>
        </button>

        {/* Open in Anki (Native 1-Click) */}
        <button
          type="button"
          onClick={onOpenInAnki}
          disabled={isOpeningInAnki || counts.enabled === 0}
          className="flex items-center space-x-1.5 px-4 py-1.5 bg-accent hover:bg-accent/90 text-white rounded-xl text-xs font-semibold transition shadow-lg shadow-accent/25 cursor-pointer disabled:opacity-50"
          title={t('flashcards.open_in_anki_tooltip')}
        >
          {isOpeningInAnki ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <ExternalLink className="w-3.5 h-3.5" />
          )}
          <span>{t('flashcards.open_in_anki')}</span>
        </button>

        {/* AnkiConnect Direct Sync Button if running */}
        {isAnkiConnectOnline && (
          <button
            type="button"
            onClick={onAnkiConnectSync}
            disabled={isSyncingAnkiConnect || counts.enabled === 0}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition shadow-lg shadow-emerald-600/20 cursor-pointer disabled:opacity-50"
          >
            {isSyncingAnkiConnect ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Zap className="w-3.5 h-3.5 text-emerald-200" />
            )}
            <span>{t('flashcards.sync_ankiconnect')}</span>
          </button>
        )}
      </div>
    </div>
  );
};
