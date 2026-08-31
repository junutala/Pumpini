// PREPARE A PHOTOGRAPH FOR OCR.
//
// A manager photographs a gauge console on a monitor he is not allowed to touch —
// the ATG lives on a locked-down desktop, so a clean screenshot is never coming.
// What arrives is a phone picture of an LCD: glare bands, moire from the pixel
// grid, a skewed angle, and the data characters rendered small inside a 1280-wide
// frame.
//
// 🔴 THE ENGINE WAS NEVER THE PROBLEM. On 31-Aug the SAME console read three ways:
//
//   whole frame, re-photographed    732 - 1,140 chars   '216000', 'Ultage', 'SaHiL'
//   whole frame, original file            1,478 chars   every field correct
//
// Google Vision recovered every one of tank 1's ten fields from the clean file. It
// is not that Vision cannot read this screen; it is that we hand it a 1280px frame
// in which the digits are a few pixels tall. Enlarging before the read is the whole
// idea — the owner's own experiment reached the same conclusion from the other end,
// recovering all ten fields with Tesseract after a 3-4x crop and upscale.
//
// Everything here DEGRADES TO NULL and never throws. A photograph that reads slowly
// beats one that does not exist, and the caller falls back to the untouched image.
const sharp = require('sharp');

function warn(msg) {
  try { require('../utils/logger').warn(msg); } catch { /* noop */ }
}

// Vision charges per image, not per pixel, and its own limit is generous — but a
// 4x upscale of a 1280x800 frame is 5120x3200, which is large to ship and slow to
// encode. 3x is the knee: enough to lift small digits clear of the moire, small
// enough to stay a fast request.
const SCALE = 3;
const MAX_EDGE = 4000;

// GREYSCALE AND NORMALISE, THEN ENLARGE.
//
// Order matters. Normalising first stretches the histogram while the pixels are
// still original data; enlarging afterwards interpolates values that are already
// well separated. Doing it the other way round enlarges the glare along with the
// glyphs.
//
// No sharpening, no thresholding. Both look better to a human and cost accuracy on
// an LCD: sharpening amplifies the moire into speckle, and a global threshold eats
// the low-contrast digits inside a glare band, which is exactly where the reads go
// wrong. Vision does its own binarisation and does it locally.
async function upscaleForOcr(base64) {
  if (!base64) return null;
  try {
    const buf = Buffer.from(base64, 'base64');
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return null;

    const scale = Math.min(SCALE, MAX_EDGE / Math.max(meta.width, meta.height));
    if (!(scale > 1)) return null;                 // already large; nothing to gain

    const out = await sharp(buf)
      .greyscale()
      .normalise()
      .resize({
        width: Math.round(meta.width * scale),
        // Lanczos3 is sharp's default kernel and the right one here: it preserves
        // edge contrast on text where a bilinear resize would soften the strokes
        // back into the background.
        kernel: sharp.kernel.lanczos3,
      })
      .png({ compressionLevel: 6 })
      .toBuffer();
    return out.toString('base64');
  } catch (e) {
    warn('imagePrep upscale failed: ' + (e.message || e));
    return null;
  }
}

// CROP A REGION AND ENLARGE IT.
//
// `box` is in FRACTIONS of the image (0-1), never pixels — the console is a web
// page in a browser window, so its absolute geometry moves with window size, zoom
// and browser chrome. A caller that has found a region from Vision's own word boxes
// passes the fractions it measured; a caller that hard-codes pixels would break the
// first time somebody resized the window.
async function cropForOcr(base64, box, pad = 0.01) {
  if (!base64 || !box) return null;
  try {
    const buf = Buffer.from(base64, 'base64');
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return null;

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const x0 = clamp(box.x0 - pad, 0, 1), y0 = clamp(box.y0 - pad, 0, 1);
    const x1 = clamp(box.x1 + pad, 0, 1), y1 = clamp(box.y1 + pad, 0, 1);
    const left = Math.round(x0 * meta.width),  top    = Math.round(y0 * meta.height);
    const width = Math.round((x1 - x0) * meta.width);
    const height = Math.round((y1 - y0) * meta.height);
    if (width < 8 || height < 8) return null;

    const scale = Math.min(SCALE, MAX_EDGE / Math.max(width, height));
    return (await sharp(buf)
      .extract({ left, top, width, height })
      .greyscale()
      .normalise()
      .resize({ width: Math.round(width * Math.max(scale, 1)), kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 6 })
      .toBuffer()).toString('base64');
  } catch (e) {
    warn('imagePrep crop failed: ' + (e.message || e));
    return null;
  }
}

module.exports = { upscaleForOcr, cropForOcr };
