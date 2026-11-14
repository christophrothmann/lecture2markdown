export interface SlideContentMetrics {
  text: string;
  imageCount: number;
  vectorComplexity: number;
  shadingCount: number;
}

const MATH_SYMBOLS = /[∑∫∂√≈≠≤≥∈∀∃λμσθωΔ∇]/gu;

export function classifySlideContent({
  text,
  imageCount,
  vectorComplexity,
  shadingCount,
}: SlideContentMetrics): boolean {
  const normalizedText = text.trim();
  const mathCount = normalizedText.match(MATH_SYMBOLS)?.length ?? 0;

  // Prefer the vision route when a slide has any meaningful visual or formula signal.
  return (
    mathCount >= 2 ||
    imageCount > 0 ||
    vectorComplexity >= 30 ||
    shadingCount > 0
  );
}
