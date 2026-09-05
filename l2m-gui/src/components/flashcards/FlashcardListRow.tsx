import React from 'react';
import {
  Sparkles,
  Trash2,
  Check,
  Edit3,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AnkiCard, AnkiCardType } from '../../utils/anki';

interface FlashcardListRowProps {
  card: AnkiCard;
  isEditing: boolean;
  onStartEditing: (id: string) => void;
  onDoneEditing: () => void;
  onToggleCard: (id: string) => void;
  onDeleteCard: (id: string) => void;
  onUpdateField: (id: string, field: 'front' | 'back', value: string) => void;
  onInsertCloze: (id: string) => void;
  nextClozeIndex: number;
  getBadgeStyle: (type: AnkiCardType) => string;
  getTypeLabel: (type: AnkiCardType) => string;
  frontRef: (el: HTMLTextAreaElement | null) => void;
  backRef: (el: HTMLTextAreaElement | null) => void;
  onFocusTextarea: (field: 'front' | 'back') => void;
  autoGrowTextarea: (el: HTMLTextAreaElement | null) => void;
}

export const FlashcardListRow: React.FC<FlashcardListRowProps> = ({
  card,
  isEditing,
  onStartEditing,
  onDoneEditing,
  onToggleCard,
  onDeleteCard,
  onUpdateField,
  onInsertCloze,
  nextClozeIndex,
  getBadgeStyle,
  getTypeLabel,
  frontRef,
  backRef,
  onFocusTextarea,
  autoGrowTextarea,
}) => {
  const { t } = useTranslation();

  if (isEditing) {
    return (
      <div
        key={card.id}
        className="p-4 rounded-xl border-2 border-accent/70 bg-surface/95 shadow-lg space-y-3 transition"
      >
        {/* Active Edit Mode Header */}
        <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2.5">
          <div className="flex items-center space-x-2">
            <span
              className={`text-[10px] px-2 py-0.5 rounded-md font-semibold border ${getBadgeStyle(
                card.type
              )}`}
            >
              {getTypeLabel(card.type)}
            </span>
            <span className="text-[11px] text-slate-300 font-medium truncate">
              {t('flashcards.slide_prefix', { number: card.slideNumber })}: {card.slideTitle}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            {/* Cloze Helper Button */}
            <button
              type="button"
              onClick={() => onInsertCloze(card.id)}
              className="px-2.5 py-1 text-xs bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 rounded-lg transition cursor-pointer font-medium flex items-center gap-1.5 shadow-xs"
              title={t('flashcards.insert_cloze_tooltip', { index: nextClozeIndex })}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>{t('flashcards.insert_cloze', { index: nextClozeIndex })}</span>
            </button>

            {/* Done Button */}
            <button
              type="button"
              onClick={onDoneEditing}
              className="px-3 py-1 text-xs bg-accent hover:bg-accent-hover text-white rounded-lg transition cursor-pointer font-bold flex items-center gap-1 shadow-sm"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{t('flashcards.done_editing')}</span>
            </button>
          </div>
        </div>

        {/* Editable Inputs with Auto-Grow */}
        <div className="space-y-3 text-xs">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                {card.type === 'image_occlusion'
                  ? t('flashcards.front_occlusion_label')
                  : t('flashcards.question_label')}
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Markdown / MathJax</span>
            </div>
            <textarea
              ref={(el) => {
                frontRef(el);
                if (el) autoGrowTextarea(el);
              }}
              value={card.front}
              onChange={(e) => {
                onUpdateField(card.id, 'front', e.target.value);
                autoGrowTextarea(e.currentTarget);
              }}
              onFocus={(e) => {
                onFocusTextarea('front');
                autoGrowTextarea(e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onDoneEditing();
              }}
              className="w-full p-3 text-xs bg-background border border-border/80 rounded-xl text-slate-100 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent leading-relaxed resize-y font-sans transition"
              placeholder={t('flashcards.front_placeholder')}
              style={{ minHeight: '70px' }}
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                {card.type === 'image_occlusion'
                  ? t('flashcards.back_occlusion_label')
                  : t('flashcards.answer_label')}
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Markdown / MathJax</span>
            </div>
            <textarea
              ref={(el) => {
                backRef(el);
                if (el) autoGrowTextarea(el);
              }}
              value={card.back}
              onChange={(e) => {
                onUpdateField(card.id, 'back', e.target.value);
                autoGrowTextarea(e.currentTarget);
              }}
              onFocus={(e) => {
                onFocusTextarea('back');
                autoGrowTextarea(e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onDoneEditing();
              }}
              className="w-full p-3 text-xs bg-background border border-border/80 rounded-xl text-slate-100 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent leading-relaxed resize-y font-sans transition"
              placeholder={t('flashcards.back_placeholder')}
              style={{ minHeight: '70px' }}
            />
          </div>
        </div>
      </div>
    );
  }

  // Default: Preview-First Read Mode
  return (
    <div
      key={card.id}
      onClick={() => onStartEditing(card.id)}
      className={`p-4 rounded-xl border transition group cursor-pointer ${
        card.enabled
          ? 'bg-surface/80 hover:bg-surface border-border/70 hover:border-accent/40 shadow-xs'
          : 'bg-surface/30 border-border/40 opacity-50'
      }`}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2.5">
        <div className="flex items-center space-x-2.5 min-w-0">
          <input
            type="checkbox"
            checked={card.enabled}
            onChange={(e) => {
              e.stopPropagation();
              onToggleCard(card.id);
            }}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent cursor-pointer shrink-0"
            title={card.enabled ? t('flashcards.card_active') : t('flashcards.card_disabled')}
          />
          <span
            className={`text-[10px] px-2 py-0.5 rounded-md font-semibold border shrink-0 ${getBadgeStyle(
              card.type
            )}`}
          >
            {getTypeLabel(card.type)}
          </span>
          <span className="text-[11px] text-slate-400 truncate">
            {t('flashcards.slide_prefix', { number: card.slideNumber })}: {card.slideTitle}
          </span>
        </div>

        <div className="flex items-center space-x-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => onStartEditing(card.id)}
            className="px-2 py-1 text-xs text-slate-400 hover:text-slate-100 hover:bg-surface-hover rounded-lg transition cursor-pointer flex items-center gap-1 border border-transparent hover:border-border"
            title={t('flashcards.edit_card')}
          >
            <Edit3 className="w-3.5 h-3.5 text-accent" />
            <span className="hidden sm:inline text-[11px]">{t('flashcards.edit_card')}</span>
          </button>

          <button
            type="button"
            onClick={() => onDeleteCard(card.id)}
            className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition cursor-pointer"
            title={t('flashcards.delete_card')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content Presentation */}
      <div className="space-y-2.5 pt-2.5 text-xs">
        {/* Front */}
        <div className="space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            {card.type === 'image_occlusion'
              ? t('flashcards.front_occlusion_label')
              : t('flashcards.question_label')}
          </span>
          <div className="text-xs font-semibold text-slate-100 whitespace-pre-wrap leading-relaxed">
            {card.front || <span className="italic text-slate-500">{t('flashcards.front_placeholder')}</span>}
          </div>
        </div>

        {/* Back */}
        <div className="space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            {card.type === 'image_occlusion'
              ? t('flashcards.back_occlusion_label')
              : t('flashcards.answer_label')}
          </span>
          <div className="text-xs text-slate-200 bg-background/60 p-3 rounded-xl border border-border/50 whitespace-pre-wrap leading-relaxed shadow-inner">
            {card.back || <span className="italic text-slate-500">{t('flashcards.back_placeholder')}</span>}
          </div>
        </div>
      </div>
    </div>
  );
};
