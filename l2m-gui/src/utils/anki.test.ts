import { describe, it, expect } from 'bun:test';
import {
  generateAnkiCardsFromMarkdown,
  exportCardsToAnkiTsv,
  formatAnkiMath,
  sanitizeTag,
} from './anki';

describe('Anki Flashcard Generator', () => {
  const sampleMarkdown = `
## [Folie 1: Einführung in Software-Architektur]
- **Software-Architektur**: Die fundamentale Struktur eines Softwaresystems und die Beziehungen zwischen seinen Komponenten.
- Eine gute Architektur sorgt für **Wartbarkeit** und Skalierbarkeit über den gesamten Lebenszyklus.

## [Folie 2: Amdahlsches Gesetz]
Hier ist die Berechnung des Speedups:
$$S(s) = \\frac{1}{(1 - p) + \\frac{p}{s}}$$
wobei $p$ der parallele Anteil ist.

## [Folie 3: Microservices vs Monolith]
- Geringere Kopplung
- Unabhängige Skalierbarkeit
- Technologievielfalt pro Service

## [Folie 22] \`\`\`markdown
### REST API Design
- **Idempotenz**: Eigenschaft von HTTP-Methoden, bei mehrfacher Ausführung denselben Serverzustand zu erzeugen.
- **GET**: Sichere und idempotente Abfragemethode.
- **PUT**: Idempotentes Überschreiben einer Ressource.
\`\`\`
`;

  it('extracts definitions as atomic cards without markdown fence contamination', () => {
    const cards = generateAnkiCardsFromMarkdown(sampleMarkdown, 'Software-Architektur');
    const defCards = cards.filter((c) => c.type === 'definition');

    expect(defCards.length).toBeGreaterThan(0);
    const firstDef = defCards[0];
    expect(firstDef.front).toContain('Software-Architektur');
    expect(firstDef.back).toContain('fundamentale Struktur');

    // Verify slide 22 definitions have clean title and no ```markdown
    const slide22Defs = defCards.filter((c) => c.slideNumber === 22);
    expect(slide22Defs.length).toBeGreaterThan(0);
    for (const card of slide22Defs) {
      expect(card.front).not.toContain('```');
      expect(card.back).not.toContain('```');
      expect(card.slideTitle).not.toContain('```');
      expect(card.slideTitle).toBe('Folie 22: REST API Design');
    }
  });

  it('never creates generic "Kernaussagen zu Folie X" cards with markdown fences', () => {
    const cards = generateAnkiCardsFromMarkdown(sampleMarkdown, 'Software-Architektur');
    for (const card of cards) {
      expect(card.front).not.toContain('```');
      expect(card.front).not.toMatch(/Kernaussagen zu:\s*Folie\s*\d+\s*:\s*```/i);
      expect(card.front).not.toMatch(/Kernaussagen zu:\s*Folie\s*\d+\?$/i);
    }
  });

  it('generates cloze deletion cards for key concept sentences', () => {
    const cards = generateAnkiCardsFromMarkdown(sampleMarkdown, 'Software-Architektur');
    const clozeCards = cards.filter((c) => c.type === 'cloze');

    expect(clozeCards.length).toBeGreaterThan(0);
    const hasClozeSyntax = clozeCards.some((c) => c.front.includes('{{c1::'));
    expect(hasClozeSyntax).toBe(true);
  });

  it('extracts formulas with MathJax format without slide number leaks', () => {
    const cards = generateAnkiCardsFromMarkdown(sampleMarkdown, 'Software-Architektur');
    const formulaCards = cards.filter((c) => c.type === 'formula');

    expect(formulaCards.length).toBeGreaterThan(0);
    expect(formulaCards[0].back).toContain('\\[S(s) = \\frac{1}{(1 - p) + \\frac{p}{s}}\\]');
    expect(formulaCards[0].front).not.toContain('Folie 2');
  });

  it('converts LaTeX delimiters to Anki MathJax correctly', () => {
    const rawMath = 'Formel: $$E = mc^2$$ und inline $a^2 + b^2 = c^2$';
    const converted = formatAnkiMath(rawMath);

    expect(converted).toContain('\\[E = mc^2\\]');
    expect(converted).toContain('\\(a^2 + b^2 = c^2\\)');
  });

  it('exports valid TSV format with native Anki directives', () => {
    const cards = generateAnkiCardsFromMarkdown(sampleMarkdown, 'Architektur');
    const tsv = exportCardsToAnkiTsv(cards, 'Vorlesung 01');

    expect(tsv).toContain('#separator:tab');
    expect(tsv).toContain('#html:true');
    expect(tsv).toContain('#deck:Vorlesung 01');
    expect(tsv.split('\n').length).toBeGreaterThan(3);
  });

  it('safely sanitizes tags', () => {
    expect(sanitizeTag('Software-Architektur & Design (2026)')).toBe('Software_Architektur_Design_2026');
    expect(sanitizeTag(undefined)).toBe('Vorlesung');
    expect(sanitizeTag('')).toBe('Vorlesung');
  });
});
