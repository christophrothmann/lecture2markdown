/**
 * Shared Markdown Slide Parser
 * Parses structured Lecture Markdown into distinct Slide sections with 1:1 page mapping.
 */

export interface SlideSection {
  slideNumber: number;
  title: string;
  content: string;
}

function cleanTitleString(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/```[a-z]*/gi, '')
    .replace(/^[:–—-\s#]+/, '')
    .replace(/[:–—-\s#]+$/, '')
    .trim();
}

function stripOuterCodeFences(text: string): string {
  let cleaned = text.trim();
  if ((cleaned.startsWith('```markdown') || cleaned.startsWith('```md')) && cleaned.endsWith('```')) {
    const firstNewline = cleaned.indexOf('\n');
    if (firstNewline !== -1 && cleaned.length > firstNewline + 4) {
      cleaned = cleaned.slice(firstNewline + 1, -3).trim();
    }
  } else if (cleaned.startsWith('```') && cleaned.endsWith('```')) {
    const count = (cleaned.match(/```/g) || []).length;
    if (count === 2) {
      const firstNewline = cleaned.indexOf('\n');
      if (firstNewline !== -1 && cleaned.length > firstNewline + 4) {
        cleaned = cleaned.slice(firstNewline + 1, -3).trim();
      }
    }
  }
  return cleaned;
}

export function parseMarkdownSlides(markdown: string): SlideSection[] {
  if (!markdown || !markdown.trim()) return [];

  const slideRegex =
    /(?:^|\n)(?:---\s*\n\s*)?##\s*\[?(?:Folie|Slide)?\s*(\d+)\]?(?::|-)?\s*([^\n]*)\n([\s\S]*?)(?=(?:\n---\s*\n\s*##|\n##\s*\[?(?:Folie|Slide)?\s*\d+|$))/gi;

  const parsed: SlideSection[] = [];
  let match: RegExpExecArray | null;

  while ((match = slideRegex.exec(markdown)) !== null) {
    const slideNum = parseInt(match[1], 10);
    const rawHeaderRest = match[2]?.trim() || '';
    const rawSlideBody = match[3]?.trim() || '';
    const slideBody = stripOuterCodeFences(rawSlideBody);

    let topic = cleanTitleString(rawHeaderRest);

    // If header rest is empty, just ```markdown, or starts with a generic label, search body
    if (!topic || topic.toLowerCase().includes('markdown') || /^folie\s*\d+$/i.test(topic)) {
      const subheader = slideBody.match(/^(?:#{1,4})\s+([^\n]+)/m);
      if (subheader) {
        topic = cleanTitleString(subheader[1]);
      } else {
        topic = '';
      }
    }

    const fullTitle = topic && !topic.toLowerCase().startsWith('folie')
      ? `Folie ${slideNum}: ${topic}`
      : `Folie ${slideNum}`;

    parsed.push({
      slideNumber: slideNum,
      title: fullTitle,
      content: `## [Folie ${slideNum}]${topic ? ` ${topic}` : ''}\n\n${slideBody}`.trim(),
    });
  }

  // Fallback if content did not match ## [Folie X] patterns
  if (parsed.length === 0) {
    const rawSections = markdown.split(/\n(?=##\s+|---\s*\n)/);
    let counter = 1;
    for (const sec of rawSections) {
      const trimmed = sec.trim();
      if (!trimmed || trimmed.startsWith('# Lecture:')) continue;

      const headerMatch = trimmed.match(/^##\s*\[?(?:Folie|Slide)?\s*(\d+)?\]?(?::|-)?\s*(.*)$/im);
      let num = counter;
      let topic = '';

      if (headerMatch) {
        if (headerMatch[1]) num = parseInt(headerMatch[1], 10);
        if (headerMatch[2]?.trim()) topic = cleanTitleString(headerMatch[2]);
      }

      const bodyClean = stripOuterCodeFences(trimmed.replace(/^---\s*\n/, ''));
      const fullTitle = topic && !topic.toLowerCase().startsWith('folie')
        ? `Folie ${num}: ${topic}`
        : `Folie ${num}`;

      parsed.push({
        slideNumber: num,
        title: fullTitle,
        content: bodyClean,
      });
      counter += 1;
    }
  }

  if (parsed.length === 0) {
    parsed.push({
      slideNumber: 1,
      title: 'Folie 1',
      content: stripOuterCodeFences(markdown.trim()),
    });
  }

  return parsed;
}
