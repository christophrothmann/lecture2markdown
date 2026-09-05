import React, { useState, useEffect, useMemo, useRef, useDeferredValue } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileText,
  Layers,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { save as saveFileDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import type { AnkiCard, AnkiCardType, ImageOcclusionMask } from '../utils/anki';
import {
  generateAnkiCardsFromMarkdown,
  exportCardsToAnkiTsv,
  checkAnkiConnectAvailable,
  syncCardsToAnkiConnect,
  exportCardsToNativeApkg,
} from '../utils/anki';
import { loadPdfDocument, renderSlideToCanvas } from '../utils/pdfRenderer';
import { ImageOcclusionCanvas } from './ImageOcclusionCanvas';
import {
  FlashcardToolbar,
  FlashcardListRow,
  FlashcardFocusEditor,
  FlashcardExportBar,
} from './flashcards';

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

  // Cards state
  const [cards, setCards] = useState<AnkiCard[]>([]);
  const [deckName, setDeckName] = useState<string>('');

  // Image Occlusion masks per slide: slideNumber -> ImageOcclusionMask[]
  const [slideMasks, setSlideMasks] = useState<Record<number, ImageOcclusionMask[]>>({});
  const [slideOcclusionMode, setSlideOcclusionMode] = useState<Record<number, 'hide_one' | 'hide_all'>>({});
  const [isOcclusionCanvasActive, setIsOcclusionCanvasActive] = useState<boolean>(false);
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);

  // Storage Keys for persistent preferences
  const FLASHCARD_LAYOUT_MODE_KEY = 'l2m_flashcard_layout_mode';
  const FLASHCARD_VIEW_MODE_KEY = 'l2m_flashcard_view_mode';

  const INITIAL_CARDS_BATCH_SIZE = 14;
  const CARDS_BATCH_INCREMENT = 12;
  const INITIAL_MASTER_BATCH_SIZE = 30;
  const MASTER_BATCH_INCREMENT = 25;

  // Layout mode: 'split' (side-by-side) or 'cards_only' (full width cards) - with persistence
  const [layoutMode, setLayoutMode] = useState<'split' | 'cards_only'>(() => {
    try {
      const saved = localStorage.getItem(FLASHCARD_LAYOUT_MODE_KEY);
      if (saved === 'cards_only' || saved === 'split') return saved;
    } catch {
      // fallback
    }
    return 'split';
  });

  // Card View Mode: 'list' (Option 1) or 'focus' (Option 2) - with persistence
  const [cardViewMode, setCardViewMode] = useState<'list' | 'focus'>(() => {
    try {
      const saved = localStorage.getItem(FLASHCARD_VIEW_MODE_KEY);
      if (saved === 'list' || saved === 'focus') return saved;
    } catch {
      // fallback
    }
    return 'focus';
  });

  // Persist layoutMode and cardViewMode
  useEffect(() => {
    try {
      localStorage.setItem(FLASHCARD_LAYOUT_MODE_KEY, layoutMode);
    } catch {
      // ignore
    }
  }, [layoutMode]);

  useEffect(() => {
    try {
      localStorage.setItem(FLASHCARD_VIEW_MODE_KEY, cardViewMode);
    } catch {
      // ignore
    }
  }, [cardViewMode]);

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [isPreviewInFocus, setIsPreviewInFocus] = useState<boolean>(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [activeTextareaField, setActiveTextareaField] = useState<{ cardId: string; field: 'front' | 'back' } | null>(null);
  const frontTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const backTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // Lazy-Loading / Virtual Batching Window State
  const [visibleLimit, setVisibleLimit] = useState<number>(INITIAL_CARDS_BATCH_SIZE);
  const [masterVisibleLimit, setMasterVisibleLimit] = useState<number>(INITIAL_MASTER_BATCH_SIZE);
  const cardsScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const cardsSentinelRef = useRef<HTMLDivElement | null>(null);
  const masterScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const masterSentinelRef = useRef<HTMLDivElement | null>(null);

  // Filtering & Search (with deferred value for lag-free typing)
  const [scopeFilter, setScopeFilter] = useState<'current_slide' | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | AnkiCardType>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const deferredSearchQuery = useDeferredValue(searchQuery);

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
        }
      } catch {
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
    setSelectedCardId(newId);
    setEditingCardId(newId);
  };

  // Filtered Cards Memo
  const filteredCards = useMemo(() => {
    return cards.filter((card) => {
      if (scopeFilter === 'current_slide' && card.slideNumber !== currentSlideNumber) {
        return false;
      }
      if (typeFilter !== 'all' && card.type !== typeFilter) {
        return false;
      }
      if (deferredSearchQuery.trim() !== '') {
        const q = deferredSearchQuery.toLowerCase();
        const matchFront = card.front.toLowerCase().includes(q);
        const matchBack = card.back.toLowerCase().includes(q);
        const matchTitle = card.slideTitle.toLowerCase().includes(q);
        return matchFront || matchBack || matchTitle;
      }
      return true;
    });
  }, [cards, scopeFilter, currentSlideNumber, typeFilter, deferredSearchQuery]);

  // Reset lazy-loading limits when filters change
  useEffect(() => {
    setVisibleLimit(INITIAL_CARDS_BATCH_SIZE);
    setMasterVisibleLimit(INITIAL_MASTER_BATCH_SIZE);
    if (cardsScrollContainerRef.current) cardsScrollContainerRef.current.scrollTop = 0;
    if (masterScrollContainerRef.current) masterScrollContainerRef.current.scrollTop = 0;
  }, [scopeFilter, typeFilter, deferredSearchQuery]);

  // Ensure selectedCardId defaults to the first available card
  useEffect(() => {
    if (filteredCards.length > 0) {
      if (!selectedCardId || !filteredCards.some((c) => c.id === selectedCardId)) {
        setSelectedCardId(filteredCards[0].id);
      }
    } else {
      setSelectedCardId(null);
    }
  }, [filteredCards, selectedCardId]);

  // Expand visible limits if selected or editing card is beyond current batch
  useEffect(() => {
    if (selectedCardId) {
      const idx = filteredCards.findIndex((c) => c.id === selectedCardId);
      if (idx >= 0) {
        if (idx >= masterVisibleLimit) {
          setMasterVisibleLimit(idx + MASTER_BATCH_INCREMENT);
        }
        if (idx >= visibleLimit) {
          setVisibleLimit(idx + CARDS_BATCH_INCREMENT);
        }
      }
    }
  }, [selectedCardId, filteredCards, masterVisibleLimit, visibleLimit]);

  useEffect(() => {
    if (editingCardId) {
      const idx = filteredCards.findIndex((c) => c.id === editingCardId);
      if (idx >= 0 && idx >= visibleLimit) {
        setVisibleLimit(idx + CARDS_BATCH_INCREMENT);
      }
    }
  }, [editingCardId, filteredCards, visibleLimit]);

  // IntersectionObserver for Option 1
  useEffect(() => {
    const sentinel = cardsSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleLimit((prev) => Math.min(prev + CARDS_BATCH_INCREMENT, filteredCards.length));
        }
      },
      { root: cardsScrollContainerRef.current, rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filteredCards.length]);

  // IntersectionObserver for Option 2
  useEffect(() => {
    const sentinel = masterSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setMasterVisibleLimit((prev) => Math.min(prev + MASTER_BATCH_INCREMENT, filteredCards.length));
        }
      },
      { root: masterScrollContainerRef.current, rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filteredCards.length]);

  const handleCardsScroll = () => {
    const el = cardsScrollContainerRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 250) {
      setVisibleLimit((prev) => Math.min(prev + CARDS_BATCH_INCREMENT, filteredCards.length));
    }
  };

  const handleMasterScroll = () => {
    const el = masterScrollContainerRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 250) {
      setMasterVisibleLimit((prev) => Math.min(prev + MASTER_BATCH_INCREMENT, filteredCards.length));
    }
  };

  const visibleCards = useMemo(() => {
    return filteredCards.slice(0, visibleLimit);
  }, [filteredCards, visibleLimit]);

  const visibleMasterCards = useMemo(() => {
    return filteredCards.slice(0, masterVisibleLimit);
  }, [filteredCards, masterVisibleLimit]);

  const currentCardIndex = filteredCards.findIndex((c) => c.id === selectedCardId);
  const currentSelectedCard = currentCardIndex !== -1 ? filteredCards[currentCardIndex] : null;

  const handlePrevCard = () => {
    if (currentCardIndex > 0) {
      setSelectedCardId(filteredCards[currentCardIndex - 1].id);
    }
  };

  const handleNextCard = () => {
    if (currentCardIndex < filteredCards.length - 1) {
      setSelectedCardId(filteredCards[currentCardIndex + 1].id);
    }
  };

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

  // Export handlers
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
        pdfPath: activePdfPath,
        outputPath: '',
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
          <FlashcardToolbar
            scopeFilter={scopeFilter}
            setScopeFilter={setScopeFilter}
            currentSlideNumber={currentSlideNumber}
            counts={counts}
            cardViewMode={cardViewMode}
            setCardViewMode={setCardViewMode}
            layoutMode={layoutMode}
            setLayoutMode={setLayoutMode}
            onAddNewCard={handleAddNewCard}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            typeFilter={typeFilter}
            setTypeFilter={setTypeFilter}
          />

          {cardViewMode === 'list' ? (
            <div
              ref={cardsScrollContainerRef}
              onScroll={handleCardsScroll}
              className="flex-1 overflow-y-auto space-y-3 min-h-0 custom-scrollbar pr-1"
            >
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
                <>
                  {visibleCards.map((card) => (
                    <FlashcardListRow
                      key={card.id}
                      card={card}
                      isEditing={editingCardId === card.id}
                      onStartEditing={(id) => setEditingCardId(id)}
                      onDoneEditing={() => setEditingCardId(null)}
                      onToggleCard={handleToggleCard}
                      onDeleteCard={handleDeleteCard}
                      onUpdateField={handleUpdateCardField}
                      onInsertCloze={handleInsertCloze}
                      nextClozeIndex={getNextClozeIndex(card)}
                      getBadgeStyle={getBadgeStyle}
                      getTypeLabel={getTypeLabel}
                      frontRef={(el) => {
                        frontTextareaRefs.current[card.id] = el;
                      }}
                      backRef={(el) => {
                        backTextareaRefs.current[card.id] = el;
                      }}
                      onFocusTextarea={(field) => {
                        setActiveTextareaField({ cardId: card.id, field });
                      }}
                      autoGrowTextarea={autoGrowTextarea}
                    />
                  ))}
                  {visibleLimit < filteredCards.length && (
                    <div
                      ref={cardsSentinelRef}
                      className="py-4 flex flex-col items-center justify-center text-xs text-slate-400 gap-1.5"
                    >
                      <Loader2 className="w-4 h-4 animate-spin text-accent" />
                      <span>
                        {t('flashcards.loaded_count', {
                          current: visibleCards.length,
                          total: filteredCards.length,
                        })}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <FlashcardFocusEditor
              filteredCards={filteredCards}
              visibleMasterCards={visibleMasterCards}
              currentSelectedCard={currentSelectedCard}
              currentCardIndex={currentCardIndex}
              selectedCardId={selectedCardId}
              onSelectCardId={setSelectedCardId}
              onToggleCard={handleToggleCard}
              onDeleteCard={handleDeleteCard}
              onChangeCardType={(id, newType) => {
                setCards((prev) =>
                  prev.map((c) => (c.id === id ? { ...c, type: newType } : c))
                );
              }}
              onUpdateField={handleUpdateCardField}
              onInsertCloze={handleInsertCloze}
              nextClozeIndex={currentSelectedCard ? getNextClozeIndex(currentSelectedCard) : 1}
              onPrevCard={handlePrevCard}
              onNextCard={handleNextCard}
              isPreviewInFocus={isPreviewInFocus}
              onTogglePreview={() => setIsPreviewInFocus(!isPreviewInFocus)}
              getBadgeStyle={getBadgeStyle}
              getTypeLabel={getTypeLabel}
              masterScrollContainerRef={masterScrollContainerRef}
              onMasterScroll={handleMasterScroll}
              masterSentinelRef={masterSentinelRef}
              masterVisibleLimit={masterVisibleLimit}
              frontRef={(el) => {
                if (currentSelectedCard) frontTextareaRefs.current[currentSelectedCard.id] = el;
              }}
              backRef={(el) => {
                if (currentSelectedCard) backTextareaRefs.current[currentSelectedCard.id] = el;
              }}
              onFocusTextarea={(field) => {
                if (currentSelectedCard) {
                  setActiveTextareaField({ cardId: currentSelectedCard.id, field });
                }
              }}
              autoGrowTextarea={autoGrowTextarea}
            />
          )}
        </div>
      </div>

      {/* Bottom Export & Sync Bar */}
      <FlashcardExportBar
        deckName={deckName}
        setDeckName={setDeckName}
        counts={counts}
        isAnkiConnectOnline={isAnkiConnectOnline}
        copiedTsv={copiedTsv}
        isExportingApkg={isExportingApkg}
        isOpeningInAnki={isOpeningInAnki}
        isSyncingAnkiConnect={isSyncingAnkiConnect}
        onCopyTsv={handleCopyTsv}
        onSaveApkgFile={handleSaveApkgFile}
        onOpenInAnki={handleOpenInAnki}
        onAnkiConnectSync={handleAnkiConnectSync}
      />
    </div>
  );
};

export default FlashcardInspectorTab;
