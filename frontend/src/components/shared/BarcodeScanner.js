'use client';
// Reusable barcode scanner. Renders a trigger button; opens a full-screen
// camera overlay and calls onScan(code) on the first detected barcode.
// Uses the native BarcodeDetector API (Android Chrome). Falls back to a clear
// message where unsupported (e.g. iOS Safari) so the user types the code.
import { useRef, useState, useEffect } from 'react';
import { Camera, CameraOff } from 'lucide-react';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];

export default function BarcodeScanner({ onScan, label = 'Scan', style }) {
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const onScanRef = useRef(onScan);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { onScanRef.current = onScan; });

  const stop = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  };

  const reason = (e) => {
    if (typeof window !== 'undefined' && !window.isSecureContext) return 'Camera needs a secure (https) connection.';
    switch (e && e.name) {
      case 'NotAllowedError':
      case 'SecurityError':        return 'Camera permission is blocked. Tap the lock/ⓘ icon by the address bar → Site settings → allow Camera, then try again.';
      case 'NotFoundError':
      case 'DevicesNotFoundError':  return 'No camera found on this device — type the barcode instead.';
      case 'NotReadableError':
      case 'TrackStartError':       return 'The camera is busy (in use by another app). Close it and try again.';
      default:                      return `Couldn’t start the camera (${e?.name || 'error'}) — type the barcode instead.`;
    }
  };

  const start = async () => {
    setErr('');
    if (typeof window === 'undefined' || !('BarcodeDetector' in window)) {
      setErr('Camera scanning isn’t supported on this browser — type the barcode instead.');
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setErr('Camera needs a secure (https) connection.');
      return;
    }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      setScanning(true);  // the effect below attaches the stream + starts detection
    } catch (e) {
      if (e && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
        try { streamRef.current = await navigator.mediaDevices.getUserMedia({ video: true }); setScanning(true); return; }
        catch (e2) { setErr(reason(e2)); }
        return;
      }
      setErr(reason(e));
    }
  };

  // Attach the stream to the <video> (now mounted) and run detection.
  useEffect(() => {
    if (!scanning || !streamRef.current || !videoRef.current) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    const detector = new window.BarcodeDetector({ formats: FORMATS });
    let raf, cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        if (video.readyState >= 2) {            // HAVE_CURRENT_DATA — frames available
          const codes = await detector.detect(video);
          if (codes.length && codes[0].rawValue) {
            const code = codes[0].rawValue;
            cancelled = true;
            stop();
            onScanRef.current && onScanRef.current(code);
            return;
          }
        }
      } catch { /* frame not ready */ }
      raf = requestAnimationFrame(tick);
    };
    video.play?.().catch(() => {});
    raf = requestAnimationFrame(tick);
    return () => { cancelled = true; if (raf) cancelAnimationFrame(raf); };
  }, [scanning]);

  return (
    <>
      <button type="button" onClick={scanning ? stop : start}
        style={{ padding: '9px 14px', background: scanning ? '#dc2626' : '#1A5F7A', color: '#fff',
          border: 'none', borderRadius: 8, cursor: 'pointer', display: 'inline-flex',
          alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13, ...style }}>
        {scanning ? <><CameraOff size={15}/>Stop</> : <><Camera size={15}/>{label}</>}
      </button>

      {err && <div style={{ marginTop: 6, fontSize: 12, color: '#dc2626' }}>{err}</div>}

      {scanning && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.88)', zIndex: 2000,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ position: 'relative', width: '100%', maxWidth: 480, borderRadius: 12, overflow: 'hidden', background: '#000' }}>
            <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', maxHeight: '62vh', objectFit: 'cover', display: 'block' }}/>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              border: '3px solid #FF6B00', width: '72%', height: 96, borderRadius: 6, pointerEvents: 'none' }}/>
          </div>
          <div style={{ color: '#fff', marginTop: 14, fontSize: 14 }}>Point the camera at the barcode</div>
          <button onClick={stop} style={{ marginTop: 16, padding: '10px 24px', background: '#dc2626', color: '#fff',
            border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <CameraOff size={16}/>Cancel
          </button>
        </div>
      )}
    </>
  );
}
