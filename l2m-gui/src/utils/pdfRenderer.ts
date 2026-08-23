import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { invoke } from '@tauri-apps/api/core';

// Configure offline worker bundled by Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export interface LoadedPdf {
  doc: pdfjsLib.PDFDocumentProxy;
  numPages: number;
}

// In-memory cache for loaded PDF documents
const pdfDocCache = new Map<string, LoadedPdf>();

export async function loadPdfDocument(filePath: string): Promise<LoadedPdf> {
  if (pdfDocCache.has(filePath)) {
    return pdfDocCache.get(filePath)!;
  }

  // Load raw binary bytes from filesystem via Rust
  const bytes = await invoke<number[]>('read_file_binary_native', { filePath });
  const uint8Array = new Uint8Array(bytes);

  const loadingTask = pdfjsLib.getDocument({
    data: uint8Array,
    useSystemFonts: true,
  });

  const doc = await loadingTask.promise;
  const result: LoadedPdf = {
    doc,
    numPages: doc.numPages,
  };

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
 * Renders a specific slide to a base64 WebP / PNG data URL.
 */
export async function renderSlideToDataUrl(
  doc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  format: 'image/webp' | 'image/png' = 'image/webp',
  quality: number = 0.85
): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1.0 });

  const targetWidth = Math.min(2048, Math.max(800, baseViewport.width * 1.5));
  const scale = targetWidth / baseViewport.width;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context could not be created');

  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL(format, quality);
}
