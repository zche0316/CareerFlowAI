import { createCanvas, loadImage, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { imageSize } from 'image-size';
import { pageRoute } from '../../agents/src/router.js';
export type SourcePage = {
  page: number;
  text: string;
  route: 'text' | 'vision';
  method: 'pdf-text' | 'plain-text' | 'image' | 'qwen-vision';
  warning?: string;
};
async function pdfDocument(bytes: Uint8Array) {
  // PDF.js's Node renderer needs these constructors on Node versions without canvas globals.
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: Uint8Array.from(bytes),
    useSystemFonts: true,
    stopAtErrors: true,
  });
  return { doc: await task.promise, task };
}
export async function extractFile(bytes: Uint8Array, mime: string): Promise<SourcePage[]> {
  if (bytes.length > 4 * 1024 * 1024 || !bytes.length)
    throw Error('Use a non-empty file up to 4 MB.');
  if (mime === 'text/plain') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0') || text.length > 60000)
      throw Error('Use a UTF-8 text file up to 60,000 characters.');
    return [{ page: 1, text, route: 'text', method: 'plain-text' }];
  }
  if (mime === 'image/png' || mime === 'image/jpeg') {
    const size = imageSize(bytes);
    if (
      !size.width ||
      !size.height ||
      size.width * size.height > 16000000 ||
      (mime === 'image/png' ? size.type !== 'png' : size.type !== 'jpg')
    )
      throw Error('Use a valid PNG or JPEG up to 16 megapixels.');
    return [
      {
        page: 1,
        text: '',
        route: 'vision',
        method: 'image',
        warning: 'Image requires visual transcription and review.',
      },
    ];
  }
  if (mime !== 'application/pdf' || !Buffer.from(bytes.slice(0, 5)).equals(Buffer.from('%PDF-')))
    throw Error('Use PDF, UTF-8 TXT, PNG or JPEG.');
  const { doc, task } = await pdfDocument(bytes);
  try {
    if (doc.numPages > 10) throw Error('Use a resume of at most 10 pages.');
    const pages: SourcePage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const content = await p.getTextContent();
      const text = content.items
        .map((x: any) => (typeof x.str === 'string' ? x.str + (x.hasEOL ? '\n' : ' ') : ''))
        .join('')
        .trim();
      if (text.length > 12000) throw Error('A page exceeds the 12,000 character import limit.');
      pages.push({
        page: i,
        text,
        route: pageRoute(text),
        method: 'pdf-text',
        warning: 'Check reading order, especially for columns and tables.',
      });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
export async function pageImage(bytes: Uint8Array, mime: string, page: number) {
  if (mime.startsWith('image/')) {
    const image = await loadImage(Buffer.from(bytes));
    const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
    const canvas = createCanvas(Math.ceil(image.width * scale), Math.ceil(image.height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return 'data:image/png;base64,' + canvas.toBuffer('image/png').toString('base64');
  }
  const { doc, task } = await pdfDocument(bytes);
  try {
    const p = await doc.getPage(page);
    const initial = p.getViewport({ scale: 1 });
    const viewport = p.getViewport({
      scale: Math.min(2, 1800 / Math.max(initial.width, initial.height)),
    });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await p.render({
      canvas: canvas as any,
      canvasContext: canvas.getContext('2d') as any,
      viewport,
    }).promise;
    return 'data:image/png;base64,' + canvas.toBuffer('image/png').toString('base64');
  } finally {
    await task.destroy();
  }
}
