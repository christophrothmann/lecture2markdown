import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Download,
  Copy,
  Plus,
  Trash2,
  Check,
  Search,
  ExternalLink,
  Zap,
  Info,
  Loader2,
  Layers,
  FileText,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Edit3,
  Columns,
  Maximize2,
} from 'lucide-react';
import { useTranslation, Trans } from 'react-i18next';
import { save as saveFileDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import type { AnkiCard, AnkiCardType, ImageOcclusionMask } from '../utils/anki';
import {
  generateAnkiCardsFromMarkdown,
  exportCardsToAnkiTsv,
  checkAnkiConnectAvailable,
  syncCardsToAnkiConnect,
  exportCardsToNativeApkg,
  formatAnkiMath,
} from '../utils/anki';
import { loadPdfDocument, renderSlideToCanvas } from '../utils/pdfRenderer';
import { ImageOcclusionCanvas } from './ImageOcclusionCanvas';

interface FlashcardInspectorTabProps {
  markdownContent: string;
  defaultTitle: string;
  activePdfPath: string | null;
  onLinkPdfRequested: () => void;
  onSuccessToast?: (msg: string, path?: string) => void;
  onCardCountChange?: (count: number) => void;
}

export const FlashcardInspectorTab: React.FC<FlashcardInspectorTabProps> = ({
  markdownContent,
  defaultTitle,
  activePdfPath,
  onLinkPdfRequested,
  onSuccessToast,
  onCardCountChange,
}) => {
  const { t } = useTranslation();

  // Slide browsing state
  const [currentSlideNumber, setCurrentSlideNumber] = useState<number>(1);
  const [totalSlideCount, setTotalSlideCount] = useState<number>(1);
  const [currentSlideTitle, setCurrentSlideTitle] = useState<string>(() => t('flashcards.lecture_default'));

  // PDF.js Canvas state
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPdfLoading, setIsPdfLoading] = useState<boolean>(false);
  const [pdfRenderedOk, setPdfRenderedOk] = useState<boolean>(false);
  const [currentSlideFallbackImage, setCurrentSlideFallbackImage] = useState<string | null>(null);
  const [renderedSlideImages, setRenderedSlideImages] = useState<Record<string, string>>({});

  // Cards state
  const [cards, setCards] = useState<AnkiCard[]>([]);
  const [deckName, setDeckName] = useState<string>('');

  // Image Occlusion masks per slide: slideNumber -> ImageOcclusionMask[]
  const [slideMasks, setSlideMasks] = useState<Record<number, ImageOcclusionMask[]>>({});
  const [slideOcclusionMode, setSlideOcclusionMode] = useState<Record<number, 'hide_one' | 'hide_all'>>({});
  const [isOcclusionCanvasActive, setIsOcclusionCanvasActive] = useState<boolean>(false);
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);

  // Layout mode: 'split' (side-by-side) or 'cards_only' (full width cards)
  const [layoutMode, setLayoutMode] = useState<'split' | 'cards_only'>('split');
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [activeTextareaField, setActiveTextareaField] = useState<{ cardId: string; field: 'front' | 'back' } | null>(null);
  const frontTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const backTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // Filtering & Search
  const [scopeFilter, setScopeFilter] = useState<'current_slide' | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | AnkiCardType>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Export & sync loading states
  const [isExportingApkg, setIsExportingApkg] = useState<boolean>(false);
  const [isOpeningInAnki, setIsOpeningInAnki] = useState<boolean>(false);
  const [isSyncingAnkiConnect, setIsSyncingAnkiConnect] = useState<boolean>(false);
  const [isAnkiConnectOnline, setIsAnkiConnectOnline] = useState<boolean>(false);
  const [copiedTsv, setCopiedTsv] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Initialize generated cards from markdown once
  useEffect(() => {
    const cleanTitle = defaultTitle.replace(/\.md|\.pdf$/i, '').trim() || t('flashcards.lecture_default');
    setDeckName(cleanTitle);

    const generated = generateAnkiCardsFromMarkdown(markdownContent, cleanTitle);
    setCards(generated);

    // Calculate maximum slide number from parsed cards or markdown headers
    const slideMatches = markdownContent.match(/##\s*\[?Folie\s*(\d+)\]?/gi);
    if (slideMatches && slideMatches.length > 0) {
      setTotalSlideCount(Math.max(1, slideMatches.length));
    } else {
      const maxSlideFromCards = generated.reduce((max, c) => Math.max(max, c.slideNumber), 1);
      setTotalSlideCount(maxSlideFromCards);
    }

    checkAnkiConnectAvailable().then(setIsAnkiConnectOnline);
  }, [markdownContent, defaultTitle, t]);

  // Notify parent of active card count
  useEffect(() => {
    if (onCardCountChange) {
      onCardCountChange(cards.filter((c) => c.enabled).length);
    }
  }, [cards, onCardCountChange]);

  // Update slide title when slide changes
  useEffect(() => {
    const cardForSlide = cards.find((c) => c.slideNumber === currentSlideNumber);
    if (cardForSlide) {
      setCurrentSlideTitle(cardForSlide.slideTitle);
    } else {
      setCurrentSlideTitle(t('flashcards.slide_prefix', { number: currentSlideNumber }));
    }
  }, [currentSlideNumber, cards, t]);

  // Synchronize image occlusion cards whenever slideMasks or slideOcclusionMode change
  const syncOcclusionCards = (
    newMasksMap: Record<number, ImageOcclusionMask[]>,
    newModesMap: Record<number, 'hide_one' | 'hide_all'>
  ) => {
    setCards((prevCards) => {
      // Map existing occlusion cards to preserve inline edits and enabled states
      const existingMap = new Map<string, AnkiCard>();
      prevCards.forEach((c) => {
        if (c.type === 'image_occlusion') {
          existingMap.set(c.id, c);
        }
      });

      const nonOcclusionCards = prevCards.filter((c) => c.type !== 'image_occlusion');
      const newOcclusionCards: AnkiCard[] = [];

      Object.entries(newMasksMap).forEach(([slideNumStr, masks]) => {
        const slideNum = parseInt(slideNumStr, 10);
        if (!masks || masks.length === 0) return;

        const mode = newModesMap[slideNum] || 'hide_one';

        masks.forEach((mask, maskIdx) => {
          const cardId = `io-${slideNum}-${mask.id}`;
          const existing = existingMap.get(cardId);

          const frontPrompt = mask.label
            ? t('flashcards.occlusion_prompt_label', { index: maskIdx + 1 })
            : t('flashcards.occlusion_prompt_generic', { number: slideNum });

          const backAnswer = mask.label || t('flashcards.occlusion_structure', { index: maskIdx + 1 });

          newOcclusionCards.push({
            id: cardId,
            type: 'image_occlusion',
            front: existing?.front || frontPrompt,
            back: mask.label || existing?.back || backAnswer,
            slideNumber: slideNum,
            slideTitle: `${t('flashcards.slide_prefix', { number: slideNum })}: Image Occlusion`,
            tags: [`Lecture2Markdown::${deckName.replace(/\s+/g, '_')}`, 'Image_Occlusion'],
            enabled: existing !== undefined ? existing.enabled : true,
            occlusionMasks: masks,
            activeMaskId: mask.id,
            occlusionMode: mode,
          });
        });
      });

      return [...nonOcclusionCards, ...newOcclusionCards];
    });
  };

  // Render PDF slide on canvas
  useEffect(() => {
    if (!activePdfPath) {
      setPdfRenderedOk(false);
      setCurrentSlideFallbackImage(null);
      return;
    }

    let isCancelled = false;
    setIsPdfLoading(true);

    async function renderCurrentSlide() {
      try {
        const doc = await loadPdfDocument(activePdfPath!);
        if (isCancelled) return;

        if (doc.numPages && doc.numPages > 0) {
          setTotalSlideCount((prev) => Math.max(prev, doc.numPages));
        }

        if (canvasRef.current) {
          await renderSlideToCanvas(doc, currentSlideNumber, canvasRef.current, 1.8);
          setPdfRenderedOk(true);
          setCurrentSlideFallbackImage(null);
          try {
            const dataUrl = canvasRef.current.toDataURL('image/webp', 0.85);
            setRenderedSlideImages((prev) => ({
              ...prev,
              [`slide_${currentSlideNumber}.webp`]: dataUrl,
            }));
          } catch {
            // Ignore canvas toDataURL error
          }
        }
      } catch {
        // Fallback to native backend renderer
        if (!isCancelled) {
          try {
            const b64 = await invoke<string>('get_slide_image_native', {
              pdfPath: activePdfPath,
              pageIndex: currentSlideNumber - 1,
            });
            if (!isCancelled && b64) {
              const fullDataUrl = `data:image/webp;base64,${b64}`;
              setCurrentSlideFallbackImage(fullDataUrl);
              setPdfRenderedOk(false);
              setRenderedSlideImages((prev) => ({
                ...prev,
                [`slide_${currentSlideNumber}.webp`]: fullDataUrl,
              }));
            }
          } catch {
            if (!isCancelled) {
              setPdfRenderedOk(false);
              setCurrentSlideFallbackImage(null);
            }
          }
        }
      } finally {
        if (!isCancelled) {
          setIsPdfLoading(false);
        }
      }
    }

    renderCurrentSlide();

    return () => {
      isCancelled = true;
    };
  }, [activePdfPath, currentSlideNumber]);

  // Mask management handlers
  const currentSlideMasks = slideMasks[currentSlideNumber] || [];
  const currentMode = slideOcclusionMode[currentSlideNumber] || 'hide_one';

  const handleAddMask = (newMask: ImageOcclusionMask) => {
    const updated = [...currentSlideMasks, newMask];
    const newMap = { ...slideMasks, [currentSlideNumber]: updated };
    setSlideMasks(newMap);
    syncOcclusionCards(newMap, slideOcclusionMode);
  };

  const handleUpdateMask = (updatedMask: ImageOcclusionMask) => {
    const updated = currentSlideMasks.map((m) => (m.id === updatedMask.id ? updatedMask : m));
    const newMap = { ...slideMasks, [currentSlideNumber]: updated };
    setSlideMasks(newMap);
    syncOcclusionCards(newMap, slideOcclusionMode);
  };

  const handleDeleteMask = (maskId: string) => {
    const updated = currentSlideMasks.filter((m) => m.id !== maskId);
    const newMap = { ...slideMasks, [currentSlideNumber]: updated };
    setSlideMasks(newMap);
    syncOcclusionCards(newMap, slideOcclusionMode);
    if (selectedMaskId === maskId) {
      setSelectedMaskId(null);
    }
  };

  const handleClearSlideMasks = () => {
    const newMap = { ...slideMasks, [currentSlideNumber]: [] };
    setSlideMasks(newMap);
    syncOcclusionCards(newMap, slideOcclusionMode);
    setSelectedMaskId(null);
  };

  const handleChangeMode = (mode: 'hide_one' | 'hide_all') => {
    const newModes = { ...slideOcclusionMode, [currentSlideNumber]: mode };
    setSlideOcclusionMode(newModes);
    syncOcclusionCards(slideMasks, newModes);
  };

  // Card modifications
  const handleToggleCard = (cardId: string) => {
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, enabled: !c.enabled } : c))
    );
  };

  const handleDeleteCard = (cardId: string) => {
    setCards((prev) => prev.filter((c) => c.id !== cardId));
    if (editingCardId === cardId) {
      setEditingCardId(null);
    }
  };

  const handleUpdateCardField = (cardId: string, field: 'front' | 'back', value: string) => {
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, [field]: value } : c))
    );
  };

  const autoGrowTextarea = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(68, el.scrollHeight)}px`;
  };

  const getNextClozeIndex = (card: AnkiCard) => {
    const combined = `${card.front} ${card.back}`;
    const matches = combined.match(/\{\{c(\d+)::/g);
    if (!matches || matches.length === 0) return 1;
    const indices = matches.map((m) => parseInt(m.replace(/\D/g, ''), 10));
    return Math.max(...indices) + 1;
  };

  const handleInsertCloze = (cardId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;

    const targetField = activeTextareaField?.cardId === cardId ? activeTextareaField.field : 'front';
    const textarea = targetField === 'front'
      ? frontTextareaRefs.current[cardId]
      : backTextareaRefs.current[cardId];

    const currentText = targetField === 'front' ? card.front : card.back;
    const nextIdx = getNextClozeIndex(card);

    let start = 0;
    let end = 0;
    let selected = '';

    if (textarea) {
      start = textarea.selectionStart;
      end = textarea.selectionEnd;
      selected = currentText.substring(start, end);
    }

    const clozeText = selected.trim() ? selected : 'Begriff';
    const replacement = `{{c${nextIdx}::${clozeText}}}`;

    let newText: string;
    let newCursorPos: number;

    if (textarea && end > start) {
      newText = currentText.substring(0, start) + replacement + currentText.substring(end);
      newCursorPos = start + replacement.length;
    } else if (textarea) {
      newText = currentText.substring(0, start) + replacement + currentText.substring(start);
      newCursorPos = start + replacement.length;
    } else {
      newText = currentText ? `${currentText} ${replacement}` : replacement;
      newCursorPos = newText.length;
    }

    handleUpdateCardField(cardId, targetField, newText);

    if (card.type !== 'cloze' && card.type !== 'image_occlusion') {
      setCards((prev) =>
        prev.map((c) => (c.id === cardId ? { ...c, type: 'cloze', [targetField]: newText } : c))
      );
    }

    setTimeout(() => {
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
        autoGrowTextarea(textarea);
      }
    }, 0);
  };

  const handleAddNewCard = () => {
    const newId = `manual-${Date.now()}`;
    const newCard: AnkiCard = {
      id: newId,
      type: 'definition',
      front: t('flashcards.new_card_front', { number: currentSlideNumber }),
      back: t('flashcards.new_card_back'),
      slideNumber: currentSlideNumber,
      slideTitle: currentSlideTitle,
      tags: [`Lecture2Markdown::${deckName.replace(/\s+/g, '_')}`],
      enabled: true,
    };
    setCards((prev) => [newCard, ...prev]);
    setEditingCardId(newId);
  };

  // Filtered Cards List
  const filteredCards = useMemo(() => {
    return cards.filter((card) => {
      if (scopeFilter === 'current_slide' && card.slideNumber !== currentSlideNumber) {
        return false;
      }
      if (typeFilter !== 'all' && card.type !== typeFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesFront = card.front.toLowerCase().includes(q);
        const matchesBack = card.back.toLowerCase().includes(q);
        const matchesTitle = card.slideTitle.toLowerCase().includes(q);
        return matchesFront || matchesBack || matchesTitle;
      }
      return true;
    });
  }, [cards, scopeFilter, currentSlideNumber, typeFilter, searchQuery]);

  const counts = useMemo(() => {
    return {
      all: cards.length,
      currentSlide: cards.filter((c) => c.slideNumber === currentSlideNumber).length,
      enabled: cards.filter((c) => c.enabled).length,
      definition: cards.filter((c) => c.type === 'definition').length,
      formula: cards.filter((c) => c.type === 'formula').length,
      cloze: cards.filter((c) => c.type === 'cloze').length,
      qa: cards.filter((c) => c.type === 'qa').length,
      image_occlusion: cards.filter((c) => c.type === 'image_occlusion').length,
    };
  }, [cards, currentSlideNumber]);

  // 1. Export as Native .apkg File
  const handleSaveApkgFile = async () => {
    const activeCards = cards.filter((c) => c.enabled);
    if (activeCards.length === 0) {
      setFeedback({ type: 'error', message: t('flashcards.no_cards_selected') });
      return;
    }

    try {
      setIsExportingApkg(true);
      setFeedback(null);
      const safeDeck = deckName.trim() || t('flashcards.lecture_default');
      const defaultFileName = `${safeDeck.replace(/[\/\\?%*:|"<>]/g, '_')}.apkg`;

      const targetPath = await saveFileDialog({
        defaultPath: defaultFileName,
        filters: [{ name: 'Anki Deck Package (*.apkg)', extensions: ['apkg'] }],
      });

      if (targetPath) {
        const savedPath = await exportCardsToNativeApkg(cards, safeDeck, {
          slideImages: renderedSlideImages,
          pdfPath: activePdfPath,
          outputPath: targetPath,
        });

        const successMsg = t('flashcards.export_success', { count: activeCards.length });
        setFeedback({ type: 'success', message: successMsg });
        if (onSuccessToast) onSuccessToast(successMsg, savedPath);
      }
    } catch (err) {
      console.error('APKG Export Error:', err);
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : t('flashcards.export_error'),
      });
    } finally {
      setIsExportingApkg(false);
    }
  };

  // 2. Open directly in Anki Desktop (1-Click Native OS Launch)
  const handleOpenInAnki = async () => {
    const activeCards = cards.filter((c) => c.enabled);
    if (activeCards.length === 0) {
      setFeedback({ type: 'error', message: t('flashcards.no_cards_selected') });
      return;
    }

    try {
      setIsOpeningInAnki(true);
      setFeedback(null);
      const safeDeck = deckName.trim() || t('flashcards.lecture_default');

      const apkgPath = await exportCardsToNativeApkg(cards, safeDeck, {
        slideImages: renderedSlideImages,
        pdfPath: activePdfPath,
        outputPath: '', // Empty path triggers temp file creation + OS launcher (open -a Anki / cmd start)
      });

      const msg = t('flashcards.open_success', { count: activeCards.length });
      setFeedback({ type: 'success', message: msg });
      if (onSuccessToast) onSuccessToast(msg, apkgPath);
    } catch (err) {
      console.error('Open in Anki Error:', err);
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : t('flashcards.open_error'),
      });
    } finally {
      setIsOpeningInAnki(false);
    }
  };

  // 3. Copy TSV
  const handleCopyTsv = async () => {
    const activeCards = cards.filter((c) => c.enabled);
    if (activeCards.length === 0) {
      setFeedback({ type: 'error', message: t('flashcards.no_cards_copy') });
      return;
    }

    const tsv = exportCardsToAnkiTsv(cards, deckName);
    await navigator.clipboard.writeText(tsv);
    setCopiedTsv(true);
    setTimeout(() => setCopiedTsv(false), 2500);
  };

  // 4. AnkiConnect Sync
  const handleAnkiConnectSync = async () => {
    const activeCards = cards.filter((c) => c.enabled);
    if (activeCards.length === 0) {
      setFeedback({ type: 'error', message: t('flashcards.no_cards_copy') });
      return;
    }

    try {
      setIsSyncingAnkiConnect(true);
      setFeedback(null);
      const res = await syncCardsToAnkiConnect(cards, deckName);
      if (res.success) {
        const msg = t('flashcards.sync_success', { count: res.count });
        setFeedback({ type: 'success', message: msg });
        if (onSuccessToast) onSuccessToast(msg);
      } else {
        setFeedback({ type: 'error', message: res.error || t('flashcards.sync_error') });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : t('flashcards.sync_error'),
      });
    } finally {
      setIsSyncingAnkiConnect(false);
    }
  };

  const getBadgeStyle = (type: AnkiCardType) => {
    switch (type) {
      case 'definition':
        return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
      case 'formula':
        return 'bg-purple-500/15 text-purple-400 border-purple-500/30';
      case 'cloze':
        return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
      case 'qa':
        return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
      case 'image_occlusion':
        return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
    }
  };

  const getTypeLabel = (type: AnkiCardType) => {
    switch (type) {
      case 'definition':
        return t('flashcards.type_definition');
      case 'formula':
        return t('flashcards.type_formula');
      case 'cloze':
        return t('flashcards.type_cloze');
      case 'qa':
        return t('flashcards.type_qa');
      case 'image_occlusion':
        return t('flashcards.type_occlusion');
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 space-y-3">
      {/* Alert banner if message */}
      {feedback && (
        <div
          className={`flex items-center justify-between px-4 py-2.5 rounded-xl border text-xs font-medium animate-fade-in shrink-0 ${
            feedback.type === 'success'
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center space-x-2 truncate">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-200 ml-2 cursor-pointer font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Container: Split Grid or Full-Width Cards */}
      <div className={`flex-1 min-h-0 gap-4 ${layoutMode === 'split' ? 'grid grid-cols-1 md:grid-cols-2' : 'flex flex-col'}`}>
        {/* Left Column: Visual PDF Slide + Interactive Image Occlusion Overlay */}
        {layoutMode === 'split' && (
          <div className="flex flex-col bg-background/80 p-4 rounded-xl border border-border/50 min-h-0 space-y-3">
            {/* Slide Navigator Toolbar */}
            <div className="flex items-center justify-between border-b border-border/60 pb-2 shrink-0">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-slate-200">
                  {t('flashcards.slide_counter', { current: currentSlideNumber, total: totalSlideCount })}
                </span>
                <span className="text-[10px] text-slate-400 truncate max-w-[150px]">
                  {currentSlideTitle}
                </span>
              </div>

              <div className="flex items-center space-x-2">
                {/* Image Occlusion Toggle */}
                <button
                  type="button"
                  onClick={() => {
                    if (!isOcclusionCanvasActive && layoutMode === 'cards_only') {
                      setLayoutMode('split');
                    }
                    setIsOcclusionCanvasActive(!isOcclusionCanvasActive);
                  }}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition cursor-pointer border ${
                    isOcclusionCanvasActive
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                      : 'bg-surface hover:bg-surface-hover border-border text-slate-300'
                  }`}
                  title={t('flashcards.masks_button_title')}
                >
                  <EyeOff className="w-3.5 h-3.5 text-rose-400" />
                  <span>{t('flashcards.masks_button')} {currentSlideMasks.length > 0 ? `(${currentSlideMasks.length})` : ''}</span>
                </button>

                {/* Prev / Next Slide */}
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    onClick={() => setCurrentSlideNumber((prev) => Math.max(1, prev - 1))}
                    disabled={currentSlideNumber <= 1}
                    className="p-1.5 bg-surface hover:bg-surface-hover border border-border text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition cursor-pointer"
                    title={t('flashcards.prev_slide')}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentSlideNumber((prev) => Math.min(totalSlideCount, prev + 1))}
                    disabled={currentSlideNumber >= totalSlideCount}
                    className="p-1.5 bg-surface hover:bg-surface-hover border border-border text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition cursor-pointer"
                    title={t('flashcards.next_slide')}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Slide Visual Container */}
            <div className="flex-1 flex items-center justify-center bg-black/40 rounded-lg border border-border/30 overflow-hidden min-h-0 relative p-2">
              {isPdfLoading && (
                <div className="absolute inset-0 bg-background/70 backdrop-blur-xs flex flex-col items-center justify-center space-y-2 text-slate-300 z-30">
                  <Loader2 className="w-6 h-6 animate-spin text-accent" />
                  <span className="text-xs">{t('flashcards.loading_slide', { current: currentSlideNumber })}</span>
                </div>
              )}

              {/* Relative wrapper holding both the slide canvas and the ImageOcclusionCanvas overlay */}
              <div className="relative inline-flex items-center justify-center max-w-full max-h-full">
                <canvas
                  ref={canvasRef}
                  className={`max-w-full max-h-full object-contain rounded shadow-md ${
                    activePdfPath && pdfRenderedOk ? 'block' : 'hidden'
                  }`}
                />

                {!pdfRenderedOk && currentSlideFallbackImage && (
                  <img
                    src={currentSlideFallbackImage}
                    alt={t('flashcards.slide_prefix', { number: currentSlideNumber })}
                    className="max-w-full max-h-full object-contain rounded shadow-md"
                  />
                )}

                {/* Image Occlusion Overlay */}
                {isOcclusionCanvasActive && (
                  <ImageOcclusionCanvas
                    masks={currentSlideMasks}
                    activeMaskId={selectedMaskId}
                    mode={currentMode}
                    isDrawingMode={isOcclusionCanvasActive}
                    onAddMask={handleAddMask}
                    onUpdateMask={handleUpdateMask}
                    onDeleteMask={handleDeleteMask}
                    onSelectMask={setSelectedMaskId}
                    onChangeMode={handleChangeMode}
                    onToggleDrawingMode={() => setIsOcclusionCanvasActive(!isOcclusionCanvasActive)}
                    onClearSlideMasks={handleClearSlideMasks}
                  />
                )}
              </div>

              {!activePdfPath && (
                <div className="text-center p-6 text-slate-500 space-y-3">
                  <FileText className="w-10 h-10 mx-auto opacity-40 text-accent" />
                  <div>
                    <p className="text-xs font-semibold text-slate-300">
                      {t('flashcards.slide_prefix', { number: currentSlideNumber })}: {currentSlideTitle}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">{t('flashcards.no_pdf_linked')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={onLinkPdfRequested}
                    className="px-3 py-1.5 bg-surface hover:bg-surface-hover border border-border text-slate-200 rounded-xl text-xs font-semibold transition inline-flex items-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    <FileText className="w-3.5 h-3.5 text-accent" /> {t('flashcards.link_pdf')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Right Column: Flashcard Inspector & Inline Editor */}
        <div className="flex-1 flex flex-col bg-background/80 p-4 rounded-xl border border-border/50 min-h-0 space-y-3">
          {/* Header & Filter Controls */}
          <div className="space-y-2 border-b border-border/60 pb-3 shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* Scope Switch: Nur diese Folie vs Alle */}
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
                  onClick={handleAddNewCard}
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

          {/* Cards Scrollable List with Inline Editing */}
          <div className="flex-1 overflow-y-auto space-y-3 min-h-0 custom-scrollbar pr-1">
            {filteredCards.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-slate-400 space-y-2">
                <Layers className="w-8 h-8 text-slate-600" />
                <p className="text-sm font-medium">{t('flashcards.empty_title')}</p>
                <p className="text-xs text-slate-500">
                  {scopeFilter === 'current_slide'
                    ? t('flashcards.empty_desc_slide')
                    : t('flashcards.empty_desc_all')}
                </p>
              </div>
            ) : (
              filteredCards.map((card) => {
                const isEditing = editingCardId === card.id;

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
                            onClick={() => handleInsertCloze(card.id)}
                            className="px-2.5 py-1 text-xs bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 rounded-lg transition cursor-pointer font-medium flex items-center gap-1.5 shadow-xs"
                            title={t('flashcards.insert_cloze_tooltip', { index: getNextClozeIndex(card) })}
                          >
                            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                            <span>{t('flashcards.insert_cloze', { index: getNextClozeIndex(card) })}</span>
                          </button>

                          {/* Done Button */}
                          <button
                            type="button"
                            onClick={() => setEditingCardId(null)}
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
                              frontTextareaRefs.current[card.id] = el;
                              if (el) autoGrowTextarea(el);
                            }}
                            value={card.front}
                            onChange={(e) => {
                              handleUpdateCardField(card.id, 'front', e.target.value);
                              autoGrowTextarea(e.currentTarget);
                            }}
                            onFocus={(e) => {
                              setActiveTextareaField({ cardId: card.id, field: 'front' });
                              autoGrowTextarea(e.currentTarget);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setEditingCardId(null);
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
                              backTextareaRefs.current[card.id] = el;
                              if (el) autoGrowTextarea(el);
                            }}
                            value={card.back}
                            onChange={(e) => {
                              handleUpdateCardField(card.id, 'back', e.target.value);
                              autoGrowTextarea(e.currentTarget);
                            }}
                            onFocus={(e) => {
                              setActiveTextareaField({ cardId: card.id, field: 'back' });
                              autoGrowTextarea(e.currentTarget);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setEditingCardId(null);
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
                    onClick={() => setEditingCardId(card.id)}
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
                            handleToggleCard(card.id);
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
                          onClick={() => setEditingCardId(card.id)}
                          className="px-2 py-1 text-xs text-slate-400 hover:text-slate-100 hover:bg-surface-hover rounded-lg transition cursor-pointer flex items-center gap-1 border border-transparent hover:border-border"
                          title={t('flashcards.edit_card')}
                        >
                          <Edit3 className="w-3.5 h-3.5 text-accent" />
                          <span className="hidden sm:inline text-[11px]">{t('flashcards.edit_card')}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteCard(card.id)}
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
              })
            )}
          </div>
        </div>
      </div>

      {/* Bottom Export & Sync Bar */}
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
            onClick={handleCopyTsv}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-surface hover:bg-surface-hover border border-border text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
            title={t('flashcards.copy_tsv_tooltip')}
          >
            {copiedTsv ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedTsv ? t('flashcards.copied_tsv') : t('flashcards.copy_tsv')}</span>
          </button>

          {/* Save .apkg File */}
          <button
            type="button"
            onClick={handleSaveApkgFile}
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
            onClick={handleOpenInAnki}
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
              onClick={handleAnkiConnectSync}
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
    </div>
  );
};

export default FlashcardInspectorTab;
