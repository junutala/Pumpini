'use client';

// frontend/src/app/global-error.js
// Last-resort boundary that catches errors thrown in the ROOT layout itself
// (which the per-segment app/error.js cannot catch). It must render its own
// <html> and <body> because the failing layout never mounted.

import { useEffect } from 'react';

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('[GlobalErrorBoundary]', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8f7f5',
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: 380,
            textAlign: 'center',
            padding: '2rem',
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1a1916', margin: '0 0 .5rem' }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: 13.5, color: '#7a7773', margin: '0 0 1.25rem' }}>
            The app failed to start. Please try again.
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: '#e07b0c',
              color: '#fff',
              border: 'none',
              borderRadius: 9,
              padding: '9px 18px',
              fontSize: 13.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
