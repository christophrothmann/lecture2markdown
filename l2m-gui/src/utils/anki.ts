/**
 * Anki Flashcard Generator
 * Parses structured Lecture Markdown into high-quality Anki-compatible TSV decks.
 */

export interface AnkiCard {
  front: string;
  back: string;
  tags: string;
}

export function generateAnkiCardsFromMarkdown(markdown: string, lectureTitle: string): AnkiCard[] {
  const cards: AnkiCard[] = [];
  const lines = markdown.split('\n');

  let currentSlideTitle = lectureTitle || 'Vorlesung';
  let currentSlideNumber = 1;
  let slideBuffer: string[] = [];

  const flushSlide = () => {
    if (slideBuffer.length === 0) return;

    const fullSlideText = slideBuffer.join('\n').trim();
    if (!fullSlideText) return;

    // 1. Extract Key Definition Cards (**Term**: Explanation)
    for (const line of slideBuffer) {
      const defMatch = line.match(/^[-*]?\s*\*\*([^*]+)\*\*[:\s–—-]+(.+)$/);
      if (defMatch) {
        const term = defMatch[1].trim();
        const definition = defMatch[2].trim();
        if (term.length > 2 && definition.length > 5) {
          cards.push({
            front: `<div style="font-weight:600;font-size:16px;">${escapeHtml(term)}</div><div style="font-size:12px;color:#888;margin-top:4px;">${escapeHtml(currentSlideTitle)} (Folie ${currentSlideNumber})</div>`,
            back: `<div style="line-height:1.5;">${formatAnkiMath(definition)}</div>`,
            tags: `Lecture2Markdown::${sanitizeTag(lectureTitle)}`,
          });
        }
      }

      // 2. Extract Formula Cards
      const formulaMatch = line.match(/\$\$([^\$]+)\$\$/);
      if (formulaMatch) {
        const formula = formulaMatch[1].trim();
        cards.push({
          front: `<div style="font-size:14px;color:#888;">Formel / Definition:</div><div style="font-weight:600;font-size:15px;margin-top:4px;">${escapeHtml(currentSlideTitle)}</div>`,
          back: `<div style="padding:8px 0;">\\[${formula}\\]</div>`,
          tags: `Lecture2Markdown::Formeln::${sanitizeTag(lectureTitle)}`,
        });
      }
    }

    // 3. General Slide Concept Flashcard
    if (fullSlideText.length > 40 && slideBuffer.length > 2) {
      const summaryItems = slideBuffer
        .filter((l) => l.trim().startsWith('-') || l.trim().startsWith('*'))
        .map((l) => `<li>${formatAnkiMath(l.replace(/^[-*]\s*/, ''))}</li>`)
        .join('');

      if (summaryItems) {
        cards.push({
          front: `<div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#888;">Kernaussagen</div><div style="font-weight:700;font-size:17px;margin-top:4px;">${escapeHtml(currentSlideTitle)}</div>`,
          back: `<ul style="text-align:left;line-height:1.6;margin:0;padding-left:20px;">${summaryItems}</ul>`,
          tags: `Lecture2Markdown::${sanitizeTag(lectureTitle)}`,
        });
      }
    }

    slideBuffer = [];
  };

  for (const line of lines) {
    // Detect Slide Header (e.g. "## Slide 5: Title" or "---")
    const slideHeaderMatch = line.match(/^##\s+(?:Folie|Slide)?\s*(\d+)?(?::|-)?\s*(.*)$/i);
    if (slideHeaderMatch) {
      flushSlide();
      if (slideHeaderMatch[1]) {
        currentSlideNumber = parseInt(slideHeaderMatch[1], 10);
      }
      currentSlideTitle = slideHeaderMatch[2]?.trim() || `Folie ${currentSlideNumber}`;
    } else if (line.trim() === '---') {
      flushSlide();
      currentSlideNumber += 1;
      currentSlideTitle = `Folie ${currentSlideNumber}`;
    } else {
      slideBuffer.push(line);
    }
  }

  flushSlide();

  // If no specific cards were created, create general Q&A cards
  if (cards.length === 0) {
    cards.push({
      front: `<div style="font-weight:bold;font-size:16px;">${escapeHtml(lectureTitle)}</div><div>Was sind die Hauptthemen dieser Vorlesung?</div>`,
      back: `<pre style="white-space:pre-wrap;font-size:12px;">${escapeHtml(markdown.slice(0, 1000))}</pre>`,
      tags: `Lecture2Markdown::${sanitizeTag(lectureTitle)}`,
    });
  }

  return cards;
}

/**
 * Converts cards to Anki UTF-8 TSV format.
 */
export function exportCardsToAnkiTsv(cards: AnkiCard[]): string {
  const header = '#separator:tab\n#html:true\n#tags column:3\n';
  const rows = cards.map((c) => `${c.front.replace(/\t/g, ' ')}\t${c.back.replace(/\t/g, ' ')}\t${c.tags}`);
  return header + rows.join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatAnkiMath(text: string): string {
  // Convert $...$ to \($...\) for Anki MathJax / LaTeX
  let out = escapeHtml(text);
  out = out.replace(/\$([^\$]+)\$/g, '\\($1\\)');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return out;
}

function sanitizeTag(title: string): string {
  return (title || 'Lecture')
    .replace(/[^a-zA-Z0-9_\u00C0-\u017F]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
