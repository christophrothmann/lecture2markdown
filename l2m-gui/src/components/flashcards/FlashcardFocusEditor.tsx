import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Trash2,
  Layers,
  Target,
  Eye,
  Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AnkiCard, AnkiCardType } from '../../utils/anki';

interface FlashcardFocusEditorProps {
  filteredCards: AnkiCard[];
  visibleMasterCards: AnkiCard[];
  currentSelectedCard: AnkiCard | null;
  currentCardIndex: number;
  selectedCardId: string | null;
  onSelectCardId: (id: string) => void;
  onToggleCard: (id: string) => void;
  onDeleteCard: (id: string) => void;
  onChangeCardType: (id: string, type: AnkiCardType) => void;
  onUpdateField: (id: string, field: 'front' | 'back', value: string) => void;
  onInsertCloze: (id: string) => void;
  nextClozeIndex: number;
  onPrevCard: () => void;
  onNextCard: () => void;
  isPreviewInFocus: boolean;
  onTogglePreview: () => void;
  getBadgeStyle: (type: AnkiCardType) => string;
  getTypeLabel: (type: AnkiCardType) => string;
  masterScrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onMasterScroll: () => void;
  masterSentinelRef: React.RefObject<HTMLDivElement | null>;
  masterVisibleLimit: number;
  frontRef: (el: HTMLTextAreaElement | null) => void;
  backRef: (el: HTMLTextAreaElement | null) => void;
  onFocusTextarea: (field: 'front' | 'back') => void;
  autoGrowTextarea: (el: HTMLTextAreaElement | null) => void;
}

export const FlashcardFocusEditor: React.FC<FlashcardFocusEditorProps> = ({
  filteredCards,
  visibleMasterCards,
  currentSelectedCard,
  currentCardIndex,
  selectedCardId,
  onSelectCardId,
  onToggleCard,
  onDeleteCard,
  onChangeCardType,
  onUpdateField,
  onInsertCloze,
  nextClozeIndex,
  onPrevCard,
  onNextCard,
  isPreviewInFocus,
  onTogglePreview,
  getBadgeStyle,
  getTypeLabel,
  masterScrollContainerRef,
  onMasterScroll,
  masterSentinelRef,
  masterVisibleLimit,
  frontRef,
  backRef,
  onFocusTextarea,
  autoGrowTextarea,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 min-h-0">
      {/* Left Column: Master Cards List (compact) */}
      <div className="md:col-span-5 flex flex-col min-h-0 bg-background/50 rounded-xl border border-border/60 p-2 overflow-hidden">
        {filteredCards.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 space-y-2">
            <Layers className="w-6 h-6 text-slate-600" />
            <p className="text-xs text-slate-500">{t('flashcards.empty_title')}</p>
          </div>
        ) : (
          <div
            ref={masterScrollContainerRef}
            onScroll={onMasterScroll}
            className="flex-1 overflow-y-auto space-y-1.5 min-h-0 custom-scrollbar pr-1"
          >
            {visibleMasterCards.map((card) => {
              const isSelected = card.id === selectedCardId;
              return (
                <div
                  key={card.id}
                  onClick={() => onSelectCardId(card.id)}
                  className={`p-2.5 rounded-lg border transition cursor-pointer flex items-center justify-between text-xs group ${
                    isSelected
                      ? 'bg-accent/15 border-accent text-white shadow-xs'
                      : 'bg-surface/60 hover:bg-surface border-border/50 text-slate-300'
                  }`}
                >
                  <div className="flex items-center space-x-2 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={card.enabled}
                      onChange={(e) => {
                        e.stopPropagation();
                        onToggleCard(card.id);
                      }}
                      className="h-3.5 w-3.5 rounded border-border text-accent focus:ring-accent cursor-pointer shrink-0"
                      title={card.enabled ? t('flashcards.card_active') : t('flashcards.card_disabled')}
                    />
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-bold border shrink-0 ${getBadgeStyle(
                        card.type
                      )}`}
                    >
                      {getTypeLabel(card.type)}
                    </span>
                    <span className="truncate text-xs font-medium text-slate-200 group-hover:text-white">
                      {card.front || card.slideTitle}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 shrink-0 ml-1.5 font-mono">
                    #{card.slideNumber}
                  </span>
                </div>
              );
            })}
            {masterVisibleLimit < filteredCards.length && (
              <div
                ref={masterSentinelRef}
                className="py-2.5 flex flex-col items-center justify-center text-[11px] text-slate-400 gap-1"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                <span>
                  {t('flashcards.loaded_count', {
                    current: visibleMasterCards.length,
                    total: filteredCards.length,
                  })}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right Column: Detail Focus Editor */}
      <div className="md:col-span-7 flex flex-col min-h-0 bg-surface/90 rounded-xl border border-border/80 p-4 space-y-3 overflow-y-auto custom-scrollbar shadow-md">
        {currentSelectedCard ? (
          <>
            {/* Focus Editor Top Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3 shrink-0">
              <div className="flex items-center space-x-2">
                {/* Prev / Next Card */}
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    onClick={onPrevCard}
                    disabled={currentCardIndex <= 0}
                    className="p-1 bg-background hover:bg-surface-hover border border-border text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition cursor-pointer"
                    title={t('flashcards.prev_card')}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs text-slate-400 font-mono px-1">
                    {currentCardIndex + 1} / {filteredCards.length}
                  </span>
                  <button
                    type="button"
                    onClick={onNextCard}
                    disabled={currentCardIndex >= filteredCards.length - 1}
                    className="p-1 bg-background hover:bg-surface-hover border border-border text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition cursor-pointer"
                    title={t('flashcards.next_card')}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Card Type Selector */}
                <select
                  value={currentSelectedCard.type}
                  onChange={(e) => onChangeCardType(currentSelectedCard.id, e.target.value as AnkiCardType)}
                  className={`text-xs px-2 py-1 rounded-lg font-semibold border bg-background focus:outline-none focus:border-accent cursor-pointer ${getBadgeStyle(
                    currentSelectedCard.type
                  )}`}
                >
                  <option value="definition">{t('flashcards.type_definition')}</option>
                  <option value="formula">{t('flashcards.type_formula')}</option>
                  <option value="cloze">{t('flashcards.type_cloze')}</option>
                  <option value="qa">{t('flashcards.type_qa')}</option>
                  <option value="image_occlusion">{t('flashcards.type_occlusion')}</option>
                </select>

                {/* Slide Indicator */}
                <span className="text-xs text-slate-400 bg-background/80 px-2 py-0.5 rounded-md border border-border/60">
                  {t('flashcards.slide_prefix', { number: currentSelectedCard.slideNumber })}
                </span>
              </div>

              <div className="flex items-center space-x-2">
                {/* Cloze Helper Button */}
                <button
                  type="button"
                  onClick={() => onInsertCloze(currentSelectedCard.id)}
                  className="px-2.5 py-1 text-xs bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 rounded-lg transition cursor-pointer font-medium flex items-center gap-1.5 shadow-xs"
                  title={t('flashcards.insert_cloze_tooltip', { index: nextClozeIndex })}
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>{t('flashcards.insert_cloze', { index: nextClozeIndex })}</span>
                </button>

                {/* Live Preview Toggle Button */}
                <button
                  type="button"
                  onClick={onTogglePreview}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition cursor-pointer border ${
                    isPreviewInFocus
                      ? 'bg-accent/20 text-accent border-accent/40'
                      : 'bg-background hover:bg-surface-hover border-border text-slate-300'
                  }`}
                  title={t('flashcards.preview_toggle')}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{isPreviewInFocus ? t('flashcards.edit_toggle') : t('flashcards.preview_toggle')}</span>
                </button>

                {/* Delete Card */}
                <button
                  type="button"
                  onClick={() => onDeleteCard(currentSelectedCard.id)}
                  className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition cursor-pointer"
                  title={t('flashcards.delete_card')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Main Focus Content: Edit Mode or Rendered Preview */}
            {!isPreviewInFocus ? (
              <div className="space-y-4 flex-1 flex flex-col min-h-0">
                {/* Front / Question Editor */}
                <div className="space-y-1.5 flex flex-col flex-1 min-h-0">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-accent" />
                      {currentSelectedCard.type === 'image_occlusion'
                        ? t('flashcards.front_occlusion_label')
                        : t('flashcards.question_label')}
                    </label>
                    <span className="text-[10px] text-slate-500 font-mono">Markdown / MathJax</span>
                  </div>
                  <textarea
                    ref={(el) => {
                      frontRef(el);
                      if (el) autoGrowTextarea(el);
                    }}
                    value={currentSelectedCard.front}
                    onChange={(e) => {
                      onUpdateField(currentSelectedCard.id, 'front', e.target.value);
                      autoGrowTextarea(e.currentTarget);
                    }}
                    onFocus={(e) => {
                      onFocusTextarea('front');
                      autoGrowTextarea(e.currentTarget);
                    }}
                    className="w-full p-3 text-xs bg-background border border-border/80 rounded-xl text-slate-100 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent leading-relaxed resize-y font-sans transition flex-1 min-h-[90px]"
                    placeholder={t('flashcards.front_placeholder')}
                  />
                </div>

                {/* Back / Answer Editor */}
                <div className="space-y-1.5 flex flex-col flex-1 min-h-0">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      {currentSelectedCard.type === 'image_occlusion'
                        ? t('flashcards.back_occlusion_label')
                        : t('flashcards.answer_label')}
                    </label>
                    <span className="text-[10px] text-slate-500 font-mono">Markdown / MathJax</span>
                  </div>
                  <textarea
                    ref={(el) => {
                      backRef(el);
                      if (el) autoGrowTextarea(el);
                    }}
                    value={currentSelectedCard.back}
                    onChange={(e) => {
                      onUpdateField(currentSelectedCard.id, 'back', e.target.value);
                      autoGrowTextarea(e.currentTarget);
                    }}
                    onFocus={(e) => {
                      onFocusTextarea('back');
                      autoGrowTextarea(e.currentTarget);
                    }}
                    className="w-full p-3 text-xs bg-background border border-border/80 rounded-xl text-slate-100 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent leading-relaxed resize-y font-sans transition flex-1 min-h-[110px]"
                    placeholder={t('flashcards.back_placeholder')}
                  />
                </div>
              </div>
            ) : (
              /* Live Rendered Card Preview */
              <div className="space-y-4 flex-1 flex flex-col min-h-0">
                <div className="p-4 rounded-xl bg-background/80 border border-border/80 space-y-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    {t('flashcards.question_label')}
                  </span>
                  <div className="text-sm font-semibold text-slate-100 whitespace-pre-wrap leading-relaxed">
                    {currentSelectedCard.front}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-background/90 border border-border/80 space-y-2 flex-1 shadow-inner">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    {t('flashcards.answer_label')}
                  </span>
                  <div className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
                    {currentSelectedCard.back}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500 space-y-2">
            <Target className="w-8 h-8 opacity-40 text-accent" />
            <p className="text-xs">{t('flashcards.select_card_prompt')}</p>
          </div>
        )}
      </div>
    </div>
  );
};
