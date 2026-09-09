import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { invoke } from '@tauri-apps/api/core';

// Configure offline worker bundled by Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export interface LoadedPdf {
  doc: pdfjsLib.PDFDocumentProxy;
  numPages: number;
}

// In-memory cache for loaded PDF documents with LRU eviction (cap at 2 to limit worker RAM)
const MAX_CACHED_PDFS = 2;
const pdfDocCache = new Map<string, LoadedPdf>();

export function clearPdfDocCache(exceptPath?: string): void {
  for (const [path, loaded] of Array.from(pdfDocCache.entries())) {
    if (!exceptPath || path !== exceptPath) {
      try {
        loaded.doc.destroy();
      } catch {
        // ignore
      }
      pdfDocCache.delete(path);
    }
  }
}

export async function loadPdfDocument(filePath: string): Promise<LoadedPdf> {
  if (pdfDocCache.has(filePath)) {
    const existing = pdfDocCache.get(filePath)!;
    // Mark as most recently used in Map iteration order
    pdfDocCache.delete(filePath);
    pdfDocCache.set(filePath, existing);
    return existing;
  }

  // Load raw binary bytes from filesystem via Rust (zero-copy binary IPC)
  const rawBytes = await invoke<ArrayBuffer | Uint8Array | number[]>('read_file_binary_native', { filePath });
  const uint8Array = rawBytes instanceof Uint8Array
    ? rawBytes
    : rawBytes instanceof ArrayBuffer
      ? new Uint8Array(rawBytes)
      : new Uint8Array(rawBytes);

  const loadingTask = pdfjsLib.getDocument({
    data: uint8Array,
    useSystemFonts: true,
  });

  const doc = await loadingTask.promise;
  const result: LoadedPdf = {
    doc,
    numPages: doc.numPages,
  };

  // Evict least recently used PDF if cache limit reached
  while (pdfDocCache.size >= MAX_CACHED_PDFS) {
    const oldestKey = pdfDocCache.keys().next().value;
    if (oldestKey) {
      const oldest = pdfDocCache.get(oldestKey);
      if (oldest) {
        try {
          oldest.doc.destroy();
        } catch {
          // ignore
        }
      }
      pdfDocCache.delete(oldestKey);
    } else {
      break;
    }
  }

  pdfDocCache.set(filePath, result);
  return result;
}

/**
 * Renders a specific slide directly onto an HTML5 Canvas element.
 */
export async function renderSlideToCanvas(
  doc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement
): Promise<void> {
  const page = await doc.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1.0 });

  // Compute optimal scale to fit container while maintaining crisp high-DPI quality
  const targetWidth = Math.min(2048, Math.max(800, baseViewport.width * 2));
  const scale = targetWidth / baseViewport.width;
  const viewport = page.getViewport({ scale });

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const renderContext = {
    canvasContext: ctx,
    viewport,
  };

  await page.render(renderContext).promise;
}

/**
 * Renders a specific slide to a base64 WebP / JPEG / PNG data URL.
 * Defaults to WebP quality 0.82 with 1600px max width for optimal speed and payload compression.
 */
export async function renderSlideToDataUrl(
  doc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  format: 'image/jpeg' | 'image/webp' | 'image/png' = 'image/webp',
  quality: number = 0.82
): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1.0 });

  const targetWidth = Math.min(1600, Math.max(800, baseViewport.width * 1.5));
  const scale = targetWidth / baseViewport.width;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context could not be created');

  // Fill crisp white background so transparent PDF backgrounds don't render black
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  const dataUrl = canvas.toDataURL(format, quality);
  // Explicitly free GPU backing store immediately
  canvas.width = 0;
  canvas.height = 0;
  return dataUrl;
}

/**
 * Extracts and renders all slides from a PDF as base64 WebP images (100% Zero-Config client-side).
 */
export async function extractPdfSlidesWebp(
  filePath: string,
  startPage?: number,
  endPage?: number,
  onProgress?: (current: number, total: number) => void
): Promise<{ page_number: number; webp_base64: string; is_visual?: boolean }[]> {
  const { doc, numPages } = await loadPdfDocument(filePath);
  const sPage = Math.max(1, Math.min(startPage || 1, numPages));
  const ePage = Math.max(sPage, Math.min(endPage || numPages, numPages));

  const slides: { page_number: number; webp_base64: string; is_visual?: boolean }[] = [];
  const total = ePage - sPage + 1;
  let done = 0;

  for (let pageNum = sPage; pageNum <= ePage; pageNum++) {
    const dataUrl = await renderSlideToDataUrl(doc, pageNum, 'image/webp', 0.82);
    const commaIdx = dataUrl.indexOf(',');
    const base64Data = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;

    slides.push({
      page_number: pageNum,
      webp_base64: base64Data,
    });
    done++;
    if (onProgress) onProgress(done, total);
  }

  return slides;
}

export interface SingleSlideResult {
  page_number: number;
  markdown: string;
  model_used: string;
  is_cache_hit: boolean;
}

/**
 * High-Performance Streaming PDF Transcription:
 * Renders slides in a small concurrent window (e.g. 2-3 at a time), sends each slide
 * immediately to Rust/API, and frees the canvas & base64 buffer from RAM immediately.
 * Keeps memory usage flat (< 15 MB) even on 150-slide lectures.
 */
export async function streamTranscribePdfSlides(
  filePath: string,
  provider: string,
  apiKey: string,
  fileName: string,
  options?: {
    startPage?: number;
    endPage?: number;
    concurrency?: number;
    onSlideCompleted?: (completed: number, total: number, pageNumber: number, modelUsed: string) => void;
  }
): Promise<string> {
  const { doc, numPages } = await loadPdfDocument(filePath);
  const sPage = Math.max(1, Math.min(options?.startPage || 1, numPages));
  const ePage = Math.max(sPage, Math.min(options?.endPage || numPages, numPages));
  const pageNumbers: number[] = [];
  for (let p = sPage; p <= ePage; p++) {
    pageNumbers.push(p);
  }

  const total = pageNumbers.length;
  const results = new Map<number, SingleSlideResult>();
  let completedCount = 0;
  const concurrency = Math.min(options?.concurrency || 3, total);

  let nextIdx = 0;

  async function worker() {
    while (nextIdx < pageNumbers.length) {
      const pageNum = pageNumbers[nextIdx++];
      try {
        // 1. Render single slide on demand (WebP 0.82)
        const dataUrl = await renderSlideToDataUrl(doc, pageNum, 'image/webp', 0.82);
        const commaIdx = dataUrl.indexOf(',');
        const base64Data = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;

        // 2. Transcribe slide immediately via native Rust handler
        const result = await invoke<SingleSlideResult>('transcribe_single_slide_native', {
          slide: { page_number: pageNum, webp_base64: base64Data },
          provider,
          apiKey,
        });

        results.set(pageNum, result);
        completedCount++;

        if (options?.onSlideCompleted) {
          options.onSlideCompleted(completedCount, total, pageNum, result.model_used);
        }
      } catch (err) {
        throw err;
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  // Assemble full markdown in strictly sorted page order
  const sections: string[] = [];
  for (const p of pageNumbers) {
    const res = results.get(p);
    if (res) {
      sections.push(res.markdown.trim());
    }
  }

  const fileStem = fileName.replace(/\.(pdf|md)$/i, '');
  const header = `# Lecture: ${fileStem}\n**Source:** ${fileName} (${total} Folien)\n\n`;
  return `${header}${sections.join('\n\n---\n\n')}\n`;
}

