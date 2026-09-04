/**
 * Anki Flashcard Generator
 * Parses structured Lecture Markdown into high-quality Anki-compatible TSV decks.
 */

import { parseMarkdownSlides } from './slideParser';

export interface AnkiCard {
  front: string;
  back: string;
  tags: string;
}

export function generateAnkiCardsFromMarkdown(markdown: string, lectureTitle: string = 'Vorlesung'): AnkiCard[] {
  const cards: AnkiCard[] = [];
  const slides = parseMarkdownSlides(markdown);

  for (const slide of slides) {
    const slideLines = slide.content.split('\n');
    const fullSlideText = slide.content.trim();

    // 1. Extract Key Definition Cards (**Term**: Explanation)
    for (const line of slideLines) {
      const defMatch = line.match(/^[-*]?\s*\*\*([^*]+)\*\*[:\s–—-]+(.+)$/);
      if (defMatch) {
        const term = defMatch[1].trim();
        const definition = defMatch[2].trim();
        if (term.length > 2 && definition.length > 5) {
          cards.push({
            front: `<div style="font-weight:600;font-size:16px;">${escapeHtml(term)}</div><div style="font-size:12px;color:#888;margin-top:4px;">${escapeHtml(slide.title)}</div>`,
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
          front: `<div style="font-size:14px;color:#888;">Formel / Definition:</div><div style="font-weight:600;font-size:15px;margin-top:4px;">${escapeHtml(slide.title)}</div>`,
          back: `<div style="padding:8px 0;">\\[${formula}\\]</div>`,
          tags: `Lecture2Markdown::Formeln::${sanitizeTag(lectureTitle)}`,
        });
      }
    }

    // 3. General Slide Concept Flashcard
    if (fullSlideText.length > 40 && slideLines.length > 2) {
      const summaryItems = slideLines
        .filter((l) => l.trim().startsWith('-') || l.trim().startsWith('*'))
        .map((l) => `<li>${formatAnkiMath(l.replace(/^[-*]\s*/, ''))}</li>`)
        .join('');

      if (summaryItems) {
        cards.push({
          front: `<div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#888;">Kernaussagen</div><div style="font-weight:700;font-size:17px;margin-top:4px;">${escapeHtml(slide.title)}</div>`,
          back: `<ul style="text-align:left;line-height:1.6;margin:0;padding-left:20px;">${summaryItems}</ul>`,
          tags: `Lecture2Markdown::${sanitizeTag(lectureTitle)}`,
        });
      }
    }
  }

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

export function exportCardsToAnkiTsv(cards: AnkiCard[]): string {
  const header = '#separator:tab\n#html:true\n#tags column:3\n';
  const rows = cards.map((c) => {
    const cleanFront = c.front.replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
    const cleanBack = c.back.replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
    return `${cleanFront}\t${cleanBack}\t${c.tags}`;
  });

  return header + rows.join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatAnkiMath(text: string): string {
  let formatted = escapeHtml(text);
  // Convert $$math$$ to \[math\] for Anki KaTeX/MathJax support
  formatted = formatted.replace(/\$\$([^\$]+)\$\$/g, '\\[$1\\]');
  // Convert $math$ to \(math\) for Anki KaTeX/MathJax support
  formatted = formatted.replace(/\$([^\$]+)\$/g, '\\($1\\)');
  return formatted;
}

function sanitizeTag(tag?: string): string {
  if (!tag || typeof tag !== 'string') return 'Vorlesung';
  return tag.replace(/[\s\(\)\[\]\{\}\/\\:\.\,\;\=\+\*\?]/g, '_').replace(/_+/g, '_');
}
