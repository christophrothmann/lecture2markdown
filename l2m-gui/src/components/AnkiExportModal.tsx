import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Sparkles,
  Download,
  Copy,
  Trash2,
  Check,
  Search,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Layers,
  Zap,
  ExternalLink,
  Info,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { save as saveFileDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import type { AnkiCard, AnkiCardType } from '../utils/anki';
import {
  generateAnkiCardsFromMarkdown,
  exportCardsToAnkiTsv,
  checkAnkiConnectAvailable,
  syncCardsToAnkiConnect,
} from '../utils/anki';

interface AnkiExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  markdownContent: string;
  defaultTitle: string;
  onSuccessToast?: (msg: string, path?: string) => void;
}

export const AnkiExportModal: React.FC<AnkiExportModalProps> = ({
  isOpen,
  onClose,
  markdownContent,
  defaultTitle,
  onSuccessToast,
}) => {
  const { t } = useTranslation();

  const [deckName, setDeckName] = useState('');
  const [cards, setCards] = useState<AnkiCard[]>([]);
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<'all' | AnkiCardType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isAnkiConnectOnline, setIsAnkiConnectOnline] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOpeningInAnki, setIsOpeningInAnki] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Initialize deck name and parse cards when modal opens
  useEffect(() => {
    if (isOpen) {
      const cleanTitle = defaultTitle.replace(/\.md|\.pdf$/i, '').trim() || 'Vorlesung';
      setDeckName(cleanTitle);

      const generated = generateAnkiCardsFromMarkdown(markdownContent, cleanTitle);
      setCards(generated);
      setSelectedTypeFilter('all');
      setSearchQuery('');
      setFeedbackMsg(null);

      // Check if AnkiConnect is running
      checkAnkiConnectAvailable().then((online) => setIsAnkiConnectOnline(online));
    }
  }, [isOpen, markdownContent, defaultTitle]);

  // Card counts by type
  const counts = useMemo(() => {
    return {
      all: cards.length,
      definition: cards.filter((c) => c.type === 'definition').length,
      formula: cards.filter((c) => c.type === 'formula').length,
      cloze: cards.filter((c) => c.type === 'cloze').length,
      qa: cards.filter((c) => c.type === 'qa').length,
      enabled: cards.filter((c) => c.enabled).length,
    };
  }, [cards]);

  // Filtered card list
  const filteredCards = useMemo(() => {
    return cards.filter((card) => {
      if (selectedTypeFilter !== 'all' && card.type !== selectedTypeFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesFront = card.front.toLowerCase().includes(query);
        const matchesBack = card.back.toLowerCase().includes(query);
        const matchesTitle = card.slideTitle.toLowerCase().includes(query);
        return matchesFront || matchesBack || matchesTitle;
      }
      return true;
    });
  }, [cards, selectedTypeFilter, searchQuery]);

  if (!isOpen) return null;

  const handleToggleCard = (id: string) => {
    setCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c))
    );
  };

  const handleDeleteCard = (id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  };

  const handleToggleSelectAll = () => {
    const allEnabled = filteredCards.every((c) => c.enabled);
    const filteredIds = new Set(filteredCards.map((c) => c.id));
    setCards((prev) =>
      prev.map((c) => (filteredIds.has(c.id) ? { ...c, enabled: !allEnabled } : c))
    );
  };

  // 1. Export as TSV File (.txt for Anki)
  const handleExportTsvFile = async () => {
    const activeCards = cards.filter((c) => c.enabled);
    if (activeCards.length === 0) {
      setFeedbackMsg({ type: 'error', text: t('anki.no_cards_selected') || 'Keine Karten ausgewählt.' });
      return;
    }

    try {
      setIsSaving(true);
      const safeDeckName = deckName.trim() || 'Vorlesung';
      const defaultFileName = `${safeDeckName.replace(/[\/\\?%*:|"<>]/g, '_')}_anki.txt`;

      const filePath = await saveFileDialog({
        defaultPath: defaultFileName,
        filters: [{ name: 'Anki Flashcard Deck (*.txt, *.tsv)', extensions: ['txt', 'tsv'] }],
      });

      if (filePath) {
        const tsvContent = exportCardsToAnkiTsv(cards, safeDeckName);
        await invoke('save_text_file_native', {
          filePath,
          content: tsvContent,
        });

        if (onSuccessToast) {
          onSuccessToast(t('anki.export_success') || 'Anki-Deck erfolgreich gespeichert!', filePath);
        }
        onClose();
      }
    } catch (err) {
      console.error('Export fehlgeschlagen:', err);
      setFeedbackMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Fehler beim Speichern der Anki-Datei.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // 2. 1-Click Sync via AnkiConnect
  const handleDirectAnkiSync = async () => {
    const activeCards = cards.filter((c) => c.enabled);
    if (activeCards.length === 0) {
      setFeedbackMsg({ type: 'error', text: t('anki.no_cards_selected') || 'Keine Karten ausgewählt.' });
      return;
    }

    try {
      setIsSyncing(true);
      setFeedbackMsg(null);
      const res = await syncCardsToAnkiConnect(cards, deckName);

      if (res.success) {
        if (onSuccessToast) {
          onSuccessToast(
            t('anki.sync_success', { count: res.count }) ||
              `${res.count} Karten erfolgreich direkt nach Anki importiert!`
          );
        }
        onClose();
      } else {
        setFeedbackMsg({
          type: 'error',
          text: res.error || 'Sync fehlgeschlagen. Ist Anki mit dem AnkiConnect Add-on gestartet?',
        });
      }
    } catch (err) {
      setFeedbackMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'AnkiConnect Verbindungsfehler.',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  // 3. Open directly in Anki Desktop (Native)
  const handleOpenInAnki = async () => {
    const activeCards = cards.filter((c) => c.enabled);
    if (activeCards.length === 0) {
      setFeedbackMsg({ type: 'error', text: t('anki.no_cards_selected') || 'Keine Karten ausgewählt.' });
      return;
    }

    try {
      setIsOpeningInAnki(true);
      setFeedbackMsg(null);
      const safeDeckName = deckName.trim() || 'Vorlesung';
      const tsvContent = exportCardsToAnkiTsv(cards, safeDeckName);

      await invoke('open_anki_import_native', {
        deckName: safeDeckName,
        tsvContent,
      });

      if (onSuccessToast) {
        onSuccessToast(
          t('anki.open_in_anki_success') ||
            'In Anki geöffnet! Bitte bestätige kurz den Import im Anki-Fenster.'
        );
      } else {
        setFeedbackMsg({
          type: 'success',
          text:
            t('anki.open_in_anki_success') ||
            'In Anki geöffnet! Bitte bestätige kurz den Import im Anki-Fenster.',
        });
      }
    } catch (err) {
      console.error('Öffnen in Anki fehlgeschlagen:', err);
      setFeedbackMsg({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : t('anki.open_in_anki_error') || 'Anki konnte nicht automatisch geöffnet werden.',
      });
    } finally {
      setIsOpeningInAnki(false);
    }
  };

  // 4. Copy TSV to Clipboard
  const handleCopyClipboard = async () => {
    const activeCards = cards.filter((c) => c.enabled);
    if (activeCards.length === 0) {
      setFeedbackMsg({ type: 'error', text: t('anki.no_cards_selected') || 'Keine Karten ausgewählt.' });
      return;
    }

    const tsvContent = exportCardsToAnkiTsv(cards, deckName);
    await navigator.clipboard.writeText(tsvContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const getBadgeStyle = (type: AnkiCardType) => {
    switch (type) {
      case 'definition':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      case 'formula':
        return 'bg-purple-500/10 text-purple-400 border-purple-500/30';
      case 'cloze':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      case 'qa':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    }
  };

  const getTypeLabel = (type: AnkiCardType) => {
    switch (type) {
      case 'definition':
        return t('anki.type_definition') || 'Definition';
      case 'formula':
        return t('anki.type_formula') || 'Formel';
      case 'cloze':
        return t('anki.type_cloze') || 'Lückentext';
      case 'qa':
        return t('anki.type_qa') || 'Konzept / Q&A';
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
      <div className="glass-card bg-surface/95 border border-border rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border/70 bg-surface/50">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-accent/15 border border-accent/20 text-accent">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
                <span>{t('anki.modal_title') || 'Anki Flashcard Generator'}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-accent/20 text-accent border border-accent/30 font-medium">
                  {counts.enabled} / {counts.all} {t('anki.cards') || 'Karten'}
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('anki.modal_subtitle') || 'Atomare Karten vor dem Export prüfen, filtern und anpassen'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-surface-hover transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Deck Settings & Filter Controls */}
        <div className="p-5 border-b border-border/50 space-y-4 bg-surface/30">
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            {/* Deck Name */}
            <div className="flex-1 flex items-center space-x-2">
              <label className="text-xs font-semibold text-slate-300 whitespace-nowrap">
                {t('anki.deck_name_label') || 'Deck-Name:'}
              </label>
              <input
                type="text"
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
                placeholder="Name des Anki Decks..."
                className="flex-1 px-3 py-1.5 text-xs bg-surface border border-border rounded-lg text-slate-100 focus:outline-none focus:border-accent transition"
              />
            </div>

            {/* Live Search */}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('anki.search_placeholder') || 'Karten durchsuchen...'}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-surface border border-border rounded-lg text-slate-100 focus:outline-none focus:border-accent transition"
              />
            </div>
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setSelectedTypeFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer border ${
                  selectedTypeFilter === 'all'
                    ? 'bg-accent/20 border-accent/40 text-accent'
                    : 'bg-surface hover:bg-surface-hover border-border text-slate-400'
                }`}
              >
                {t('anki.filter_all') || 'Alle'} ({counts.all})
              </button>
              <button
                onClick={() => setSelectedTypeFilter('definition')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer border ${
                  selectedTypeFilter === 'definition'
                    ? 'bg-blue-500/20 border-blue-500/40 text-blue-400'
                    : 'bg-surface hover:bg-surface-hover border-border text-slate-400'
                }`}
              >
                {t('anki.filter_definitions') || 'Definitionen'} ({counts.definition})
              </button>
              <button
                onClick={() => setSelectedTypeFilter('formula')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer border ${
                  selectedTypeFilter === 'formula'
                    ? 'bg-purple-500/20 border-purple-500/40 text-purple-400'
                    : 'bg-surface hover:bg-surface-hover border-border text-slate-400'
                }`}
              >
                {t('anki.filter_formulas') || 'Formeln'} ({counts.formula})
              </button>
              <button
                onClick={() => setSelectedTypeFilter('cloze')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer border ${
                  selectedTypeFilter === 'cloze'
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                    : 'bg-surface hover:bg-surface-hover border-border text-slate-400'
                }`}
              >
                {t('anki.filter_cloze') || 'Lückentext'} ({counts.cloze})
              </button>
              <button
                onClick={() => setSelectedTypeFilter('qa')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer border ${
                  selectedTypeFilter === 'qa'
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                    : 'bg-surface hover:bg-surface-hover border-border text-slate-400'
                }`}
              >
                {t('anki.filter_qa') || 'Konzepte'} ({counts.qa})
              </button>
            </div>

            <button
              onClick={handleToggleSelectAll}
              className="text-xs text-accent hover:underline font-medium cursor-pointer"
            >
              {filteredCards.every((c) => c.enabled)
                ? t('anki.deselect_all') || 'Auswahl aufheben'
                : t('anki.select_all') || 'Alle auswählen'}
            </button>
          </div>
        </div>

        {/* Feedback Alert if present */}
        {feedbackMsg && (
          <div
            className={`px-5 py-2.5 text-xs flex items-center space-x-2 border-b ${
              feedbackMsg.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
            }`}
          >
            {feedbackMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
            )}
            <span>{feedbackMsg.text}</span>
          </div>
        )}

        {/* Card Preview List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3 custom-scrollbar min-h-[220px]">
          {filteredCards.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-400 space-y-2">
              <Layers className="w-8 h-8 text-slate-600" />
              <p className="text-sm font-medium">{t('anki.no_cards_found') || 'Keine Karten gefunden'}</p>
              <p className="text-xs text-slate-500">
                {t('anki.no_cards_hint') || 'Passe deine Suchbegriffe oder Filter an.'}
              </p>
            </div>
          ) : (
            filteredCards.map((card) => (
              <div
                key={card.id}
                className={`p-3.5 rounded-xl border transition flex items-start space-x-3 ${
                  card.enabled
                    ? 'bg-surface border-border/80 hover:border-accent/40'
                    : 'bg-surface/30 border-border/40 opacity-50'
                }`}
              >
                {/* Enable Checkbox */}
                <input
                  type="checkbox"
                  checked={card.enabled}
                  onChange={() => handleToggleCard(card.id)}
                  className="mt-1 h-4 w-4 rounded border-border text-accent focus:ring-accent cursor-pointer"
                />

                {/* Card Content Details */}
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center space-x-2">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-md font-semibold border ${getBadgeStyle(
                        card.type
                      )}`}
                    >
                      {getTypeLabel(card.type)}
                    </span>
                    <span className="text-[11px] text-slate-400 truncate">
                      Folie {card.slideNumber}: {card.slideTitle}
                    </span>
                  </div>

                  {/* Front & Back Display */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-black/20 border border-border/40">
                      <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-1">
                        {t('anki.front') || 'Vorderseite'}:
                      </span>
                      <div
                        className="text-slate-200 leading-relaxed font-medium select-text"
                        dangerouslySetInnerHTML={{ __html: card.front }}
                      />
                    </div>

                    <div className="p-2.5 rounded-lg bg-black/20 border border-border/40">
                      <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-1">
                        {t('anki.back') || 'Rückseite'}:
                      </span>
                      <div
                        className="text-slate-300 leading-relaxed select-text"
                        dangerouslySetInnerHTML={{ __html: card.back }}
                      />
                    </div>
                  </div>
                </div>

                {/* Delete Single Card Button */}
                <button
                  onClick={() => handleDeleteCard(card.id)}
                  className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition cursor-pointer"
                  title={t('anki.delete_card') || 'Karte löschen'}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-border/70 bg-surface/50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* AnkiConnect Status Indicator */}
          <div className="flex items-center space-x-2 text-xs">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isAnkiConnectOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
              }`}
            />
            <div className="flex items-center space-x-1.5 text-slate-400">
              <span>
                {isAnkiConnectOnline
                  ? t('anki.ankiconnect_active') || 'AnkiConnect aktiv'
                  : t('anki.ankiconnect_optional') || 'AnkiConnect (Add-on optional)'}
              </span>
              <div className="group relative inline-flex items-center">
                <Info className="w-3.5 h-3.5 text-slate-500 hover:text-slate-300 transition cursor-help" />
                <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block w-72 p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-[11px] text-slate-300 shadow-2xl z-50 pointer-events-none leading-relaxed">
                  {t('anki.ankiconnect_optional_tooltip')}
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* Copy TSV */}
            <button
              onClick={handleCopyClipboard}
              className="flex items-center space-x-1.5 px-3 py-2 bg-surface hover:bg-surface-hover border border-border text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
              title={t('anki.copy_title') || 'TSV für Quizlet / Notion kopieren'}
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? t('anki.copied') || 'Kopiert!' : t('anki.copy_tsv') || 'Kopieren'}</span>
            </button>

            {/* Save TSV Deck File */}
            <button
              onClick={handleExportTsvFile}
              disabled={isSaving || counts.enabled === 0}
              className="flex items-center space-x-1.5 px-3.5 py-2 bg-surface hover:bg-surface-hover border border-border text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer disabled:opacity-50"
              title={t('anki.export_deck') || 'Als Datei speichern'}
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>
                {isSaving
                  ? t('anki.saving') || 'Speichere...'
                  : t('anki.export_deck') || 'Als Datei speichern'}
              </span>
            </button>

            {/* Open directly in Anki Desktop (Native) */}
            <button
              onClick={handleOpenInAnki}
              disabled={isOpeningInAnki || counts.enabled === 0}
              className="flex items-center space-x-1.5 px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-xl text-xs font-semibold transition shadow-lg shadow-accent/25 cursor-pointer disabled:opacity-50"
              title={t('anki.open_in_anki') || 'In Anki öffnen'}
            >
              {isOpeningInAnki ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ExternalLink className="w-3.5 h-3.5" />
              )}
              <span>
                {isOpeningInAnki
                  ? t('anki.opening_in_anki') || 'Öffne in Anki...'
                  : t('anki.open_in_anki') || 'In Anki öffnen'}
              </span>
            </button>

            {/* Direct AnkiConnect Sync (if Anki is open with AnkiConnect add-on) */}
            {isAnkiConnectOnline && (
              <button
                onClick={handleDirectAnkiSync}
                disabled={isSyncing || counts.enabled === 0}
                className="flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition shadow-lg shadow-emerald-600/20 cursor-pointer disabled:opacity-50"
              >
                {isSyncing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5 text-emerald-200" />
                )}
                <span>
                  {isSyncing
                    ? t('anki.syncing') || 'Übertrage...'
                    : t('anki.direct_sync') || '1-Klick Sync (AnkiConnect)'}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
