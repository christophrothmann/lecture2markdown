/**
 * Anki Flashcard Engine
 * Generates atomic, high-signal flashcards (Definitions, Formulas, Cloze deletions, Q&A)
 * from structured lecture markdown and provides 1-Click AnkiConnect Sync + Anki TSV export.
 */

import { parseMarkdownSlides } from './slideParser';

export type AnkiCardType = 'definition' | 'formula' | 'cloze' | 'qa';

export interface AnkiCard {
  id: string;
  type: AnkiCardType;
  front: string;
  back: string;
  slideNumber: number;
  slideTitle: string;
  tags: string[];
  enabled: boolean;
}

/**
 * Parses markdown into atomic, high-quality Anki flashcards.
 */
export function generateAnkiCardsFromMarkdown(
  markdown: string,
  lectureTitle: string = 'Vorlesung'
): AnkiCard[] {
  const cards: AnkiCard[] = [];
  const slides = parseMarkdownSlides(markdown);
  const cleanDeckTag = sanitizeTag(lectureTitle);

  let cardIdCounter = 1;
  const generateId = () => `card-${Date.now()}-${cardIdCounter++}`;

  for (const slide of slides) {
    const slideLines = slide.content.split('\n');
    const slideTitle = slide.title.trim() || `Folie ${slide.slideNumber}`;

    // 1. Extract Key Definitions (**Term**: Definition or **Term** - Definition)
    for (const rawLine of slideLines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Pattern: - **Term**: Definition or - **Term** – Definition
      const defMatch = line.match(/^[-*]?\s*\*\*([^*]+)\*\*[:\s–—-]+(.+)$/);
      if (defMatch) {
        const term = defMatch[1].trim();
        const definition = defMatch[2].trim();

        if (term.length >= 2 && definition.length >= 5) {
          // If the definition sentence is rich, create BOTH an atomic definition AND a Cloze card!
          cards.push({
            id: generateId(),
            type: 'definition',
            front: term,
            back: formatAnkiMath(definition),
            slideNumber: slide.slideNumber,
            slideTitle,
            tags: [`Lecture2Markdown::${cleanDeckTag}`, 'Definitionen'],
            enabled: true,
          });

          // Cloze deletion card from definition sentence:
          if (definition.length > 25 && !term.includes('\n')) {
            const clozeFront = `{{c1::${escapeHtml(term)}}}: ${formatAnkiMath(definition)}`;
            cards.push({
              id: generateId(),
              type: 'cloze',
              front: clozeFront,
              back: `<small style="color:#888;">Kontext: ${escapeHtml(slideTitle)}</small>`,
              slideNumber: slide.slideNumber,
              slideTitle,
              tags: [`Lecture2Markdown::${cleanDeckTag}`, 'Lueckentext'],
              enabled: true,
            });
          }
        }
      }

      // 2. Extract Formula Cards ($$ ... $$)
      const displayMathMatch = line.match(/\$\$([^\$]+)\$\$/);
      if (displayMathMatch) {
        const formula = displayMathMatch[1].trim();
        const contextHint = line.replace(/\$\$([^\$]+)\$\$/, '').replace(/^[-*]\s*/, '').trim();
        const frontText = contextHint.length > 3
          ? `Wie lautet die Formel für: <strong>${escapeHtml(contextHint)}</strong>?`
          : `Wie lautet die mathematische Formel auf Folie <em>${escapeHtml(slideTitle)}</em>?`;

        cards.push({
          id: generateId(),
          type: 'formula',
          front: frontText,
          back: `\\[${formula}\\]`,
          slideNumber: slide.slideNumber,
          slideTitle,
          tags: [`Lecture2Markdown::${cleanDeckTag}`, 'Formeln'],
          enabled: true,
        });
      }
    }

    // 3. Extract Atomic Concept Questions (Avoid dumping 8 bullets onto 1 card)
    const bulletItems = slideLines
      .map((l) => l.trim())
      .filter((l) => l.startsWith('- ') || l.startsWith('* '))
      .map((l) => l.replace(/^[-*]\s*/, '').trim());

    // If there are distinct bullet points, extract the most informative ones as atomic QA cards
    for (const item of bulletItems) {
      // Check if bullet contains a sub-definition, e.g. "Vorteil: Hohe Geschwindigkeit"
      const subMatch = item.match(/^\*\*([^*]+)\*\*[:\s–—-]+(.+)$/);
      if (subMatch) {
        const subTerm = subMatch[1].trim();
        const subDesc = subMatch[2].trim();
        if (subTerm.length > 2 && subDesc.length > 4) {
          // Already captured in definitions loop
          continue;
        }
      }

      // Single standalone high-value concept sentence (e.g. contains bold keyword)
      const boldInItem = item.match(/\*\*([^*]+)\*\*/);
      if (boldInItem && item.length > 30 && item.length < 200) {
        const keyWord = boldInItem[1].trim();
        // Turn into an active Cloze card
        const clozeItem = item.replace(`**${keyWord}**`, `{{c1::${keyWord}}}`);
        cards.push({
          id: generateId(),
          type: 'cloze',
          front: formatAnkiMath(clozeItem),
          back: `<small style="color:#888;">Thema: ${escapeHtml(slideTitle)}</small>`,
          slideNumber: slide.slideNumber,
          slideTitle,
          tags: [`Lecture2Markdown::${cleanDeckTag}`, 'Lueckentext'],
          enabled: true,
        });
      }
    }

    // 4. If a slide has 2-4 concise bullet points (and hasn't generated 3+ cards yet), create a focused Summary Card
    if (bulletItems.length >= 2 && bulletItems.length <= 4) {
      const formattedList = bulletItems
        .map((b) => `<li>${formatAnkiMath(b.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'))}</li>`)
        .join('');

      cards.push({
        id: generateId(),
        type: 'qa',
        front: `Was sind die Kernaussagen zu: <strong>${escapeHtml(slideTitle)}</strong>?`,
        back: `<ul style="text-align:left;line-height:1.6;margin:0;padding-left:20px;">${formattedList}</ul>`,
        slideNumber: slide.slideNumber,
        slideTitle,
        tags: [`Lecture2Markdown::${cleanDeckTag}`, 'Konzepte'],
        enabled: true,
      });
    }
  }

  // Fallback if no specific patterns were found
  if (cards.length === 0) {
    cards.push({
      id: generateId(),
      type: 'qa',
      front: `Was sind die Hauptthemen der Vorlesung <strong>${escapeHtml(lectureTitle)}</strong>?`,
      back: `<div style="white-space:pre-wrap;font-size:13px;line-height:1.5;">${escapeHtml(markdown.slice(0, 800))}...</div>`,
      slideNumber: 1,
      slideTitle: lectureTitle,
      tags: [`Lecture2Markdown::${cleanDeckTag}`],
      enabled: true,
    });
  }

  return cards;
}

/**
 * Generates an Anki-compatible TSV string with automatic header directives (#deck, #separator, etc.).
 */
export function exportCardsToAnkiTsv(
  cards: AnkiCard[],
  deckName: string = 'Lecture2Markdown'
): string {
  const activeCards = cards.filter((c) => c.enabled);
  const cleanDeck = deckName.replace(/[\r\n\t]/g, ' ').trim() || 'Lecture2Markdown';

  // Anki native import header for 100% automated configuration
  const header = `#separator:tab\n#html:true\n#tags column:3\n#deck:${cleanDeck}\n`;

  const rows = activeCards.map((c) => {
    const cleanFront = c.front.replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
    const cleanBack = c.back.replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
    const tagsStr = c.tags.join(' ');
    return `${cleanFront}\t${cleanBack}\t${tagsStr}`;
  });

  return header + rows.join('\n');
}

/**
 * Checks if local AnkiConnect HTTP server is running on default port 8765.
 */
export async function checkAnkiConnectAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);

    const res = await fetch('http://127.0.0.1:8765', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'version', version: 6 }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    if (!res.ok) return false;
    const data = await res.json();
    return data && typeof data.result === 'number';
  } catch {
    return false;
  }
}

/**
 * 1-Click Direct Sync into running Anki Desktop app via AnkiConnect.
 */
export async function syncCardsToAnkiConnect(
  cards: AnkiCard[],
  deckName: string
): Promise<{ success: boolean; count: number; error?: string }> {
  const activeCards = cards.filter((c) => c.enabled);
  if (activeCards.length === 0) {
    return { success: false, count: 0, error: 'Keine Karten ausgewählt.' };
  }

  const cleanDeck = deckName.trim() || 'Lecture2Markdown';

  try {
    // 1. Create Deck in Anki
    await fetch('http://127.0.0.1:8765', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'createDeck',
        version: 6,
        params: { deck: cleanDeck },
      }),
    });

    // 2. Prepare notes based on card type
    const notes = activeCards.map((card) => {
      const isCloze = card.type === 'cloze';
      const modelName = isCloze ? 'Cloze' : 'Basic';
      const fields = isCloze
        ? {
            Text: card.front,
            'Back Extra': card.back,
          }
        : {
            Front: card.front,
            Back: card.back,
          };

      return {
        deckName: cleanDeck,
        modelName,
        fields,
        tags: card.tags,
        options: {
          allowDuplicate: false,
          duplicateScope: 'deck',
        },
      };
    });

    // 3. Batch add notes to Anki
    const res = await fetch('http://127.0.0.1:8765', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'addNotes',
        version: 6,
        params: { notes },
      }),
    });

    const data = await res.json();
    if (data.error) {
      return { success: false, count: 0, error: data.error };
    }

    const createdCount = Array.isArray(data.result)
      ? data.result.filter((id: number | null) => id !== null).length
      : activeCards.length;

    return { success: true, count: createdCount };
  } catch (err) {
    return {
      success: false,
      count: 0,
      error: err instanceof Error ? err.message : 'Verbindung zu AnkiConnect fehlgeschlagen.',
    };
  }
}

/**
 * Escapes HTML entities.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Formats LaTeX KaTeX math blocks for Anki's native MathJax engine.
 */
export function formatAnkiMath(text: string): string {
  let formatted = escapeHtml(text);
  // Convert $$math$$ to \[math\] for Anki MathJax support
  formatted = formatted.replace(/\$\$([^\$]+)\$\$/g, '\\[$1\\]');
  // Convert $math$ to \(math\) for Anki MathJax support
  formatted = formatted.replace(/\$([^\$]+)\$/g, '\\($1\\)');
  return formatted;
}

/**
 * Cleans a string to be a valid, hierarchical Anki tag.
 */
export function sanitizeTag(tag?: string): string {
  if (!tag || typeof tag !== 'string') return 'Vorlesung';
  return tag
    .replace(/[\s\(\)\[\]\{\}\/\\:\.\,\;\=\+\*\?\&]/g, '_')
    .replace(/-+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}
