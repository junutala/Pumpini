'use client';
// Reusable barcode scanner. Renders a trigger button; opens a full-screen
// camera overlay and calls onScan(code) on the first detected barcode.
// Uses the native BarcodeDetector API (Android Chrome). Falls back to a clear
// message where unsupported (e.g. iOS Safari) so the user types the code.
import { useRef, useState } from 'react';
import { Camera, CameraOff } from 'lucide-react';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];

export default function BarcodeScanner({ onScan, label = 'Scan', style }) {
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState('');

  const stop = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  };

  const start = async () => {
    setErr('');
    if (typeof window === 'undefined' || !('BarcodeDetector' in window)) {
      setErr('Camera scanning isn’t supported on this browser — type the barcode instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanning(true);
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, 0);

      const detector = new window.BarcodeDetector({ formats: FORMATS });
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length && codes[0].rawValue) {
            const code = codes[0].rawValue;
            stop();
            onScan(code);
            return;
          }
        } catch { /* frame not ready */ }
        if (streamRef.current) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      setErr('Camera access denied or unavailable — type the barcode instead.');
      stop();
    }
  };

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
            <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', maxHeight: '62vh', objectFit: 'cover' }}/>
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
