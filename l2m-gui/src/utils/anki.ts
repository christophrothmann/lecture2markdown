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
 * Strips raw markdown formatting and code fence remnants from a string.
 */
function cleanContentString(text: string): string {
  if (!text) return '';
  return text
    .replace(/```[a-z]*/gi, '')
    .replace(/[`]/g, '')
    .trim();
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
    
    // Extract a genuine, clean topic name without any "Folie X:" prefix or markdown fence artifacts
    const cleanTopic = cleanContentString(
      slide.title
        .replace(/^Folie\s*\d+\s*[:–—-]?\s*/i, '')
        .replace(/^[#:\s–—-]+/, '')
    );

    const hasRealTopic = cleanTopic.length >= 3 && !/^folie\s*\d+$/i.test(cleanTopic);
    const displaySlideTitle = hasRealTopic ? `Folie ${slide.slideNumber}: ${cleanTopic}` : `Folie ${slide.slideNumber}`;

    // 1. Extract Key Definitions (**Term**: Definition or **Term** - Definition)
    for (const rawLine of slideLines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('```')) continue;

      // Pattern: - **Term**: Definition or - **Term** – Definition
      const defMatch = line.match(/^[-*]?\s*\*\*([^*]+)\*\*[:\s–—-]+(.+)$/);
      if (defMatch) {
        const term = cleanContentString(defMatch[1].trim());
        const definition = cleanContentString(defMatch[2].trim());

        if (term.length >= 2 && definition.length >= 5) {
          // Front: Clean, active question asking for the definition
          const frontHtml = hasRealTopic
            ? `Was versteht man unter <strong>${escapeHtml(term)}</strong>?<div style="font-size:11px;color:#888;margin-top:4px;">Thema: ${escapeHtml(cleanTopic)}</div>`
            : `Was versteht man unter <strong>${escapeHtml(term)}</strong>?`;

          cards.push({
            id: generateId(),
            type: 'definition',
            front: frontHtml,
            back: formatAnkiMath(definition),
            slideNumber: slide.slideNumber,
            slideTitle: displaySlideTitle,
            tags: [`Lecture2Markdown::${cleanDeckTag}`, 'Definitionen'],
            enabled: true,
          });

          // Cloze deletion card from rich definition sentences:
          if (definition.length > 25 && !term.includes('\n') && !term.includes('`')) {
            const clozeFront = `{{c1::${escapeHtml(term)}}}: ${formatAnkiMath(definition)}`;
            const clozeBack = hasRealTopic ? `<small style="color:#888;">Kontext: ${escapeHtml(cleanTopic)}</small>` : '';
            cards.push({
              id: generateId(),
              type: 'cloze',
              front: clozeFront,
              back: clozeBack,
              slideNumber: slide.slideNumber,
              slideTitle: displaySlideTitle,
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
        const rawHint = line.replace(/\$\$([^\$]+)\$\$/, '').replace(/^[-*]\s*/, '').trim();
        const contextHint = cleanContentString(rawHint);

        let frontText = '';
        if (contextHint.length > 3) {
          frontText = `Wie lautet die Formel für: <strong>${escapeHtml(contextHint)}</strong>?`;
        } else if (hasRealTopic) {
          frontText = `Wie lautet die Formel zu: <strong>${escapeHtml(cleanTopic)}</strong>?`;
        } else {
          frontText = `Wie lautet die mathematische Formel für diesen Zusammenhang?`;
        }

        cards.push({
          id: generateId(),
          type: 'formula',
          front: frontText,
          back: `\\[${formula}\\]`,
          slideNumber: slide.slideNumber,
          slideTitle: displaySlideTitle,
          tags: [`Lecture2Markdown::${cleanDeckTag}`, 'Formeln'],
          enabled: true,
        });
      }
    }

    // 3. Extract High-Signal Cloze Sentences from Bullet Points
    const bulletItems = slideLines
      .map((l) => l.trim())
      .filter((l) => (l.startsWith('- ') || l.startsWith('* ')) && !l.startsWith('```'))
      .map((l) => l.replace(/^[-*]\s*/, '').trim());

    for (const item of bulletItems) {
      // Don't duplicate full definitions
      if (/^\*\*([^*]+)\*\*[:\s–—-]+(.+)$/.test(item)) continue;

      const boldInItem = item.match(/\*\*([^*]+)\*\*/);
      if (boldInItem && item.length > 30 && item.length < 220) {
        const keyWord = boldInItem[1].trim();
        if (keyWord.length >= 3 && !keyWord.toLowerCase().includes('markdown')) {
          const cleanItem = cleanContentString(item);
          const clozeItem = cleanItem.replace(`**${keyWord}**`, `{{c1::${keyWord}}}`);
          
          cards.push({
            id: generateId(),
            type: 'cloze',
            front: formatAnkiMath(clozeItem),
            back: hasRealTopic ? `<small style="color:#888;">Thema: ${escapeHtml(cleanTopic)}</small>` : '',
            slideNumber: slide.slideNumber,
            slideTitle: displaySlideTitle,
            tags: [`Lecture2Markdown::${cleanDeckTag}`, 'Lueckentext'],
            enabled: true,
          });
        }
      }
    }

    // 4. Extract Concept Q&A - ONLY if there is a real, meaningful topic! (No generic "Folie X" cards)
    if (hasRealTopic && bulletItems.length >= 2 && bulletItems.length <= 4) {
      const formattedList = bulletItems
        .map((b) => {
          const cleanB = cleanContentString(b);
          return `<li>${formatAnkiMath(cleanB.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'))}</li>`;
        })
        .join('');

      let questionText = `Was sind die Kernpunkte zu: <strong>${escapeHtml(cleanTopic)}</strong>?`;

      if (/^vorteile\b/i.test(cleanTopic)) {
        questionText = `Welche Vorteile bieten <strong>${escapeHtml(cleanTopic.replace(/^vorteile\s+(von|zu)\s+/i, ''))}</strong>?`;
      } else if (/^nachteile\b/i.test(cleanTopic)) {
        questionText = `Welche Nachteile gibt es bei <strong>${escapeHtml(cleanTopic.replace(/^nachteile\s+(von|zu)\s+/i, ''))}</strong>?`;
      } else if (/^(eigenschaften|merkmale)\b/i.test(cleanTopic)) {
        questionText = `Was sind die zentralen Merkmale von <strong>${escapeHtml(cleanTopic.replace(/^(eigenschaften|merkmale)\s+(von|zu)\s+/i, ''))}</strong>?`;
      }

      cards.push({
        id: generateId(),
        type: 'qa',
        front: questionText,
        back: `<ul style="text-align:left;line-height:1.6;margin:0;padding-left:20px;">${formattedList}</ul>`,
        slideNumber: slide.slideNumber,
        slideTitle: displaySlideTitle,
        tags: [`Lecture2Markdown::${cleanDeckTag}`, 'Konzepte'],
        enabled: true,
      });
    }
  }

  // Fallback if no specific cards could be generated
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
