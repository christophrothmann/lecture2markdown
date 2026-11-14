import { describe, expect, it } from 'bun:test';
import { classifySlideContent } from './slideClassifier';

describe('classifySlideContent', () => {
  it('routes text-heavy slides without visual content to the text model', () => {
    expect(
      classifySlideContent({
        text: 'A detailed slide with paragraphs and bullet points.',
        imageCount: 0,
        vectorComplexity: 0,
        shadingCount: 0,
      })
    ).toBe(false);
  });

  it('routes slides containing even one image to the vision model', () => {
    expect(
      classifySlideContent({
        text: 'A text-heavy slide'.repeat(30),
        imageCount: 1,
        vectorComplexity: 0,
        shadingCount: 0,
      })
    ).toBe(true);
  });

  it('routes slides containing at least two mathematical symbols to the vision model', () => {
    expect(
      classifySlideContent({
        text: '∑ ∫',
        imageCount: 0,
        vectorComplexity: 0,
        shadingCount: 0,
      })
    ).toBe(true);
  });

  it('routes formula-dense slides to the vision model', () => {
    expect(
      classifySlideContent({
        text: '∑ ∫ ∂ √ ≈',
        imageCount: 0,
        vectorComplexity: 0,
        shadingCount: 0,
      })
    ).toBe(true);
  });

  it('routes complex vector diagrams to the vision model', () => {
    expect(
      classifySlideContent({
        text: 'Components and relationships',
        imageCount: 0,
        vectorComplexity: 80,
        shadingCount: 0,
      })
    ).toBe(true);
  });

  it('routes shading to the vision model', () => {
    expect(
      classifySlideContent({
        text: 'A text-heavy slide'.repeat(30),
        imageCount: 0,
        vectorComplexity: 0,
        shadingCount: 1,
      })
    ).toBe(true);
  });
});
