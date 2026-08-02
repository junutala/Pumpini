'use client';
// Shows a STORED artifact (station_artifacts) by id — the coupon behind an invoice
// line, the gauge screen behind a dip, the operator's photo at shift start/close.
//
// Why this exists rather than an <img src="/api/artifacts/…">: the API authenticates
// on the Authorization header and the browser does not send it for an <img> request,
// so the bytes come through the shared axios instance and are wrapped in an object
// URL here. That URL is revoked on unmount — without it, a register screen scrolled
// through fifty coupons would hold fifty images in memory until the tab was closed.
//
// Renders a thumbnail that opens full-size on click. Failure is quiet: proof that
// cannot be fetched shows a placeholder rather than an error banner, because the
// record itself is still perfectly valid.
import { useState, useEffect } from 'react';
import { ImageOff, Image as ImageIcon } from 'lucide-react';
import { fetchArtifactImageUrl } from '../../lib/api';

export default function ArtifactImage({ artifactId, alt = 'Stored image', size = 46, label = '' }) {
  const [url, setUrl] = useState('');
  const [state, setState] = useState('idle');   // idle | loading | ready | error
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    if (!artifactId) { setState('idle'); return; }
    let dead = false;
    let made = '';
    setState('loading');
    fetchArtifactImageUrl(artifactId)
      .then(u => {
        if (dead) { URL.revokeObjectURL(u); return; }
        made = u; setUrl(u); setState('ready');
      })
      .catch(() => { if (!dead) setState('error'); });
    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
  }, [artifactId]);

  if (!artifactId) {
    return (
      <span title="No image stored" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: 8, background: '#f1f5f9', color: '#cbd5e1' }}>
        <ImageOff size={Math.round(size / 2.6)} />
      </span>
    );
  }

  if (state !== 'ready') {
    return (
      <span title={state === 'error' ? 'Image could not be loaded' : 'Loading…'}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: 8, background: '#f1f5f9', color: state === 'error' ? '#f87171' : '#cbd5e1' }}>
        {state === 'error' ? <ImageOff size={Math.round(size / 2.6)} /> : <ImageIcon size={Math.round(size / 2.6)} />}
      </span>
    );
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} title={label || alt} onClick={() => setZoom(true)}
        style={{ width: size, height: size, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e3de', cursor: 'zoom-in' }} />
      {zoom && (
        <div onClick={() => setZoom(false)} role="presentation"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, cursor: 'zoom-out' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={alt} style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8 }} />
          {label && <div style={{ position: 'absolute', bottom: 18, color: '#fff', fontSize: 13, fontWeight: 600 }}>{label}</div>}
        </div>
      )}
    </>
  );
}
