import React from 'react';
import {
  Search,
  Plus,
  Columns,
  Maximize2,
  LayoutList,
  Target,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AnkiCardType } from '../../utils/anki';

interface FlashcardToolbarProps {
  scopeFilter: 'current_slide' | 'all';
  setScopeFilter: (scope: 'current_slide' | 'all') => void;
  currentSlideNumber: number;
  counts: {
    all: number;
    currentSlide: number;
    enabled: number;
    definition: number;
    formula: number;
    cloze: number;
    qa: number;
    image_occlusion: number;
  };
  cardViewMode: 'list' | 'focus';
  setCardViewMode: (mode: 'list' | 'focus') => void;
  layoutMode: 'split' | 'cards_only';
  setLayoutMode: (mode: 'split' | 'cards_only') => void;
  onAddNewCard: () => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  typeFilter: 'all' | AnkiCardType;
  setTypeFilter: (filter: 'all' | AnkiCardType) => void;
}

export const FlashcardToolbar: React.FC<FlashcardToolbarProps> = ({
  scopeFilter,
  setScopeFilter,
  currentSlideNumber,
  counts,
  cardViewMode,
  setCardViewMode,
  layoutMode,
  setLayoutMode,
  onAddNewCard,
  searchQuery,
  setSearchQuery,
  typeFilter,
  setTypeFilter,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-2 border-b border-border/60 pb-3 shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Scope Switch: Current Slide vs All */}
        <div className="flex items-center bg-slate-900/80 p-1 rounded-xl border border-slate-700/80 text-xs">
          <button
            type="button"
            onClick={() => setScopeFilter('current_slide')}
            className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
              scopeFilter === 'current_slide'
                ? 'bg-accent text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t('flashcards.scope_current_slide', { current: currentSlideNumber })} ({counts.currentSlide})
          </button>
          <button
            type="button"
            onClick={() => setScopeFilter('all')}
            className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
              scopeFilter === 'all'
                ? 'bg-accent text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t('flashcards.scope_all')} ({counts.all})
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode: List (Option 1) vs Focus Editor (Option 2) */}
          <div className="flex items-center bg-slate-900/80 p-1 rounded-xl border border-slate-700/80 text-xs">
            <button
              type="button"
              onClick={() => setCardViewMode('list')}
              className={`px-2 py-1 rounded-lg font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                cardViewMode === 'list'
                  ? 'bg-accent text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title={t('flashcards.view_list')}
            >
              <LayoutList className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('flashcards.view_list')}</span>
            </button>
            <button
              type="button"
              onClick={() => setCardViewMode('focus')}
              className={`px-2 py-1 rounded-lg font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                cardViewMode === 'focus'
                  ? 'bg-accent text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title={t('flashcards.view_focus')}
            >
              <Target className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('flashcards.view_focus')}</span>
            </button>
          </div>

          {/* Layout Switcher: Split vs Cards Only */}
          <div className="flex items-center bg-slate-900/80 p-1 rounded-xl border border-slate-700/80 text-xs">
            <button
              type="button"
              onClick={() => setLayoutMode('split')}
              className={`px-2 py-1 rounded-lg font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                layoutMode === 'split'
                  ? 'bg-accent text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title={t('flashcards.layout_split')}
            >
              <Columns className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('flashcards.layout_split')}</span>
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode('cards_only')}
              className={`px-2 py-1 rounded-lg font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                layoutMode === 'cards_only'
                  ? 'bg-accent text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title={t('flashcards.layout_cards_only')}
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('flashcards.layout_cards_only')}</span>
            </button>
          </div>

          {/* Add Card to current slide Button */}
          <button
            type="button"
            onClick={onAddNewCard}
            className="px-3 py-1 bg-surface hover:bg-surface-hover border border-border hover:border-accent text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-accent" /> {t('flashcards.add_card')}
          </button>
        </div>
      </div>

      {/* Live Search & Type Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('flashcards.search_placeholder')}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-surface border border-border rounded-lg text-slate-100 focus:outline-none focus:border-accent transition"
          />
        </div>

        {/* Type Filter Pills */}
        <div className="flex flex-wrap items-center gap-1 text-[11px]">
          <button
            type="button"
            onClick={() => setTypeFilter('all')}
            className={`px-2 py-0.5 rounded-md font-medium border transition cursor-pointer ${
              typeFilter === 'all'
                ? 'bg-accent/20 border-accent/40 text-accent font-semibold'
                : 'bg-surface border-border text-slate-400 hover:text-slate-200'
            }`}
          >
            {t('flashcards.filter_all')} ({counts.all})
          </button>
          {counts.definition > 0 && (
            <button
              type="button"
              onClick={() => setTypeFilter('definition')}
              className={`px-2 py-0.5 rounded-md font-medium border transition cursor-pointer ${
                typeFilter === 'definition'
                  ? 'bg-blue-500/20 border-blue-500/40 text-blue-400 font-semibold'
                  : 'bg-surface border-border text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('flashcards.filter_definition')} ({counts.definition})
            </button>
          )}
          {counts.formula > 0 && (
            <button
              type="button"
              onClick={() => setTypeFilter('formula')}
              className={`px-2 py-0.5 rounded-md font-medium border transition cursor-pointer ${
                typeFilter === 'formula'
                  ? 'bg-purple-500/20 border-purple-500/40 text-purple-400 font-semibold'
                  : 'bg-surface border-border text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('flashcards.filter_formula')} ({counts.formula})
            </button>
          )}
          {counts.cloze > 0 && (
            <button
              type="button"
              onClick={() => setTypeFilter('cloze')}
              className={`px-2 py-0.5 rounded-md font-medium border transition cursor-pointer ${
                typeFilter === 'cloze'
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-400 font-semibold'
                  : 'bg-surface border-border text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('flashcards.filter_cloze')} ({counts.cloze})
            </button>
          )}
          {counts.image_occlusion > 0 && (
            <button
              type="button"
              onClick={() => setTypeFilter('image_occlusion')}
              className={`px-2 py-0.5 rounded-md font-medium border transition cursor-pointer ${
                typeFilter === 'image_occlusion'
                  ? 'bg-rose-500/20 border-rose-500/40 text-rose-400 font-semibold'
                  : 'bg-surface border-border text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('flashcards.filter_occlusion')} ({counts.image_occlusion})
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
