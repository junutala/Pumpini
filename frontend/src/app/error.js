'use client';

// frontend/src/app/error.js
// App Router route-segment error boundary.
// Catches render/runtime errors in any page and shows a recoverable card
// instead of a blank white screen. `reset()` re-renders the segment WITHOUT
// a full page reload, preserving SPA state. Styles are inline on purpose:
// an error boundary must render even if the stylesheet failed to load.

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

export default function Error({ error, reset }) {
  // A stale browser tab loading a page after a new deploy throws a
  // "ChunkLoadError" / "Loading chunk failed". That is the ONE case where a
  // hard reload is the correct remedy (it fetches the new bundle).
  const isChunkError =
    /ChunkLoadError|Loading chunk [\d]+ failed|Importing a module script failed/i.test(
      error?.message || ''
    );

  useEffect(() => {
    // Surface to the console / any error reporting you add later.
    console.error('[ErrorBoundary]', error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        background: '#f8f7f5',
        fontFamily: "'DM Sans', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 420,
          width: '100%',
          background: '#fff',
          border: '1px solid #e5e3de',
          borderRadius: 14,
          padding: '1.75rem',
          textAlign: 'center',
          boxShadow: '0 4px 24px rgba(0,0,0,.06)',
        }}
      >
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 12,
            background: '#fff8ed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1rem',
          }}
        >
          <AlertTriangle size={22} color="#e07b0c" />
        </div>

        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1a1916', margin: '0 0 .4rem' }}>
          {isChunkError ? 'A new version is available' : 'Something went wrong'}
        </h2>

        <p style={{ fontSize: 13.5, color: '#7a7773', lineHeight: 1.5, margin: '0 0 1.25rem' }}>
          {isChunkError
            ? 'The app was updated while this tab was open. Reload to get the latest version.'
            : 'This page hit an unexpected error. Your data is safe — you can retry without losing your session.'}
        </p>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          {isChunkError ? (
            <button onClick={() => window.location.reload()} style={primaryBtn}>
              <RefreshCw size={15} /> Reload
            </button>
          ) : (
            <>
              <button onClick={() => reset()} style={primaryBtn}>
                <RotateCcw size={15} /> Try again
              </button>
              <button onClick={() => (window.location.href = '/dashboard')} style={secondaryBtn}>
                Go to dashboard
              </button>
            </>
          )}
        </div>

        {process.env.NODE_ENV !== 'production' && error?.message && (
          <pre
            style={{
              marginTop: '1.25rem',
              textAlign: 'left',
              fontSize: 11,
              color: '#dc2626',
              background: '#f3f2ef',
              border: '1px solid #e5e3de',
              borderRadius: 8,
              padding: '.6rem .7rem',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {error.message}
          </pre>
        )}
      </div>
    </div>
  );
}

const primaryBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  background: '#e07b0c',
  color: '#fff',
  border: 'none',
  borderRadius: 9,
  padding: '9px 16px',
  fontSize: 13.5,
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  background: '#f3f2ef',
  color: '#4a4845',
  border: '1px solid #e5e3de',
  borderRadius: 9,
  padding: '9px 16px',
  fontSize: 13.5,
  fontWeight: 600,
  cursor: 'pointer',
};
