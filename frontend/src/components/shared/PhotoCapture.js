'use client';
// ONE capture control for every photograph Pumpini keeps as proof — the operator
// at shift start and close, and any document scan that wants the same handling.
// One component, embedded by each flow, per the one-form-per-concept rule: the
// downscaling, the camera-only rule and the preview are decided here once.
//
// CAMERA ONLY, NEVER THE GALLERY. `capture="environment"` asks the device for the
// camera directly. It is a hint, not a lock — a determined user can still reach
// their gallery on some browsers — but it makes live capture the path of least
// resistance, which is the point: a photograph of a photograph proves nothing.
// The server's own received-at timestamp is the real anchor, not the file's.
//
// NO RED X ON THE THUMBNAIL. It used to carry a small red circled cross, which was
// wrong three ways: red is the colour this app uses for danger and money going
// missing, so an alarm badge sat permanently on a photo that was perfectly fine;
// it was 22px against the 44px minimum this app holds itself to; and it duplicated
// Retake, which is what someone actually wants nine times in ten. Removing a photo
// is now a plain labelled control beside Retake, in neutral grey — so red goes back
// to meaning something is wrong.
//
// The image is downscaled before it leaves the phone. A modern handset shoots
// 4000px originals at 4–8 MB; a face or a printed slip is entirely legible at
// 1400px and lands under ~250 KB, which is the difference between a capture that
// works on forecourt 4G and one that times out.
import { useState, useRef, useEffect } from 'react';
import { Camera, RefreshCw } from 'lucide-react';

const MAX_EDGE = 1400;
const QUALITY  = 0.85;

// Draw the picked file through a canvas at a bounded size and hand back base64.
// Rejecting here (rather than at upload) keeps a corrupt file from ever entering
// the flow.
function downscale(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const dataUrl = c.toDataURL('image/jpeg', QUALITY);
      resolve({ base64: dataUrl.split(',')[1] || '', media_type: 'image/jpeg', dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}

// onCapture({ base64, media_type }) — or null when the photo is cleared, so the
// parent can drop what it was holding.
export default function PhotoCapture({
  label = 'Take photo',
  retakeLabel = 'Retake',
  onCapture,
  disabled = false,
  size = 84,
  required = false,
  hint = '',
  removeLabel = 'Remove',
}) {
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);

  // The preview is a data URL held in state, so there is nothing to revoke — but
  // drop it on unmount anyway so a long-lived page doesn't hold megabytes of
  // base64 for a form that has already been submitted.
  useEffect(() => () => setPreview(''), []);

  const pick = async (file) => {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const out = await downscale(file);
      setPreview(out.dataUrl);
      onCapture?.({ base64: out.base64, media_type: out.media_type });
    } catch (e) {
      setErr(e.message || 'Could not read that image');
      onCapture?.(null);
    } finally { setBusy(false); }
  };

  const clear = () => { setPreview(''); setErr(''); onCapture?.(null); };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {preview ? (
          <div style={{ flexShrink: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="" style={{ width: size, height: size, objectFit: 'cover', borderRadius: 10, border: '2px solid #16a34a' }} />
          </div>
        ) : (
          <div style={{ width: size, height: size, borderRadius: 10, border: '2px dashed ' + (required ? '#fca5a5' : '#e5e3de'), background: required ? '#fef2f2' : '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Camera size={26} color={required ? '#dc2626' : '#94a3b8'} />
          </div>
        )}

        <div style={{ minWidth: 0 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            minHeight: 44, padding: '0 16px', borderRadius: 8,
            background: disabled || busy ? '#94a3b8' : preview ? '#475569' : '#0f172a', color: '#fff',
            fontSize: 13, fontWeight: 700, cursor: disabled || busy ? 'default' : 'pointer' }}>
            {busy ? <RefreshCw size={14} /> : <Camera size={14} />}
            {busy ? 'Reading…' : preview ? retakeLabel : label}
            <input ref={inputRef} type="file" accept="image/*" capture="environment" disabled={disabled || busy}
              style={{ display: 'none' }}
              onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {preview && (
            <button type="button" onClick={clear} disabled={disabled || busy}
              style={{ minHeight: 44, marginLeft: 8, padding: '0 12px', background: 'none', border: 'none',
                color: 'var(--text-3, #64748b)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                textDecoration: 'underline' }}>
              {removeLabel}
            </button>
          )}
          {hint && !err && <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 5 }}>{hint}</div>}
          {err && <div style={{ fontSize: 11.5, color: '#b91c1c', marginTop: 5 }}>{err}</div>}
        </div>
      </div>
    </div>
  );
}
