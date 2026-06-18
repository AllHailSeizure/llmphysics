import { requestExpandedMode } from '@devvit/web/client';
import React from 'react';
import { createRoot } from 'react-dom/client';
import logoUrl from './assets/SVGAssets_Logo.svg';
import bgUrl from './assets/SVGAssets_Background.svg';

function Splash() {
  return (
    <div
      style={{
        position: 'relative',
        height: '100vh',
        width: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '14px',
        boxSizing: 'border-box',
        padding: '16px',
        background: '#06080d',
        fontFamily: "'Inter', sans-serif",
        WebkitFontSmoothing: 'antialiased',
        textAlign: 'center',
      }}
    >
      {/* Desktop/square background art, rendered as an image layer (reliable SVG render). */}
      <img
        src={bgUrl}
        alt=""
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
      />

      <img
        src={logoUrl}
        alt="LLMPhysics Bingo"
        style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '300px' }}
      />

      <button
        onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
        style={{
          position: 'relative',
          zIndex: 1,
          padding: '10px 28px',
          background: '#0071e3',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          fontSize: '15px',
          fontWeight: 700,
          letterSpacing: '0.02em',
          boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
        }}
      >
        Get your card now!
      </button>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Splash />);
