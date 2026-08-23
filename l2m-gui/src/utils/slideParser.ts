/**
 * Shared Markdown Slide Parser
 * Parses structured Lecture Markdown into distinct Slide sections with 1:1 page mapping.
 */

export interface SlideSection {
  slideNumber: number;
  title: string;
  content: string;
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
    const slideBody = match[3]?.trim() || '';

    let title = rawHeaderRest;
    if (!title || title.startsWith('#')) {
      const subheader = slideBody.match(/^###?\s+(.+)$/m);
      title = subheader ? subheader[1].trim() : `Folie ${slideNum}`;
    }

    parsed.push({
      slideNumber: slideNum,
      title: title.startsWith('Folie') ? title : `Folie ${slideNum}: ${title}`,
      content: `## [Folie ${slideNum}] ${rawHeaderRest}\n\n${slideBody}`.trim(),
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
      let title = `Folie ${counter}`;

      if (headerMatch) {
        if (headerMatch[1]) num = parseInt(headerMatch[1], 10);
        if (headerMatch[2]?.trim()) title = headerMatch[2].trim();
      }

      parsed.push({
        slideNumber: num,
        title: title.startsWith('Folie') ? title : `Folie ${num}: ${title}`,
        content: trimmed.replace(/^---\s*\n/, ''),
      });
      counter += 1;
    }
  }

  if (parsed.length === 0) {
    parsed.push({
      slideNumber: 1,
      title: 'Folie 1',
      content: markdown.trim(),
    });
  }

  return parsed;
}
