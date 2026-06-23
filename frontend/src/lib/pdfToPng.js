'use client';

// Render page 1 of a PDF to a PNG, in the browser.
//
// Why: the supplier (IOCL) invoices are image-based PDFs with no text layer.
// Claude's vision model reads them reliably as a PNG but flakily as a raw PDF
// document block ("Could not read the invoice"). So before OCR we rasterise the
// first page to a PNG and send that instead — proven to read perfectly.
//
// The worker is self-hosted at /public/pdf.worker.min.js (copied from the
// pinned pdfjs-dist build) so there's no CDN / CSP dependency for the bunks.

let _pdfjs;
async function getPdfjs() {
  if (_pdfjs) return _pdfjs;
  const pdfjs = await import('pdfjs-dist/build/pdf');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
  _pdfjs = pdfjs;
  return pdfjs;
}

function base64ToUint8(base64) {
  const bin = atob(base64);
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// base64: the PDF's raw base64 (no data: prefix). Returns { base64, media_type }
// for a PNG of page 1. Long edge is capped (~2200px) — crisp for OCR, small
// enough for the vision API to accept without server-side downscaling waste.
export async function pdfToPng(base64, { targetLongEdge = 2200 } = {}) {
  const pdfjs = await getPdfjs();
  const pdf = await pdfjs.getDocument({ data: base64ToUint8(base64) }).promise;
  try {
    const page = await pdf.getPage(1);
    const unit = page.getViewport({ scale: 1 });
    const scale = Math.min(3, targetLongEdge / Math.max(unit.width, unit.height));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    // White matte so a transparent PDF background doesn't render black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL('image/png');
    return { base64: dataUrl.split(',')[1], media_type: 'image/png' };
  } finally {
    try { pdf.cleanup(); pdf.destroy(); } catch { /* noop */ }
  }
}
