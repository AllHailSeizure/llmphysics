import { requestExpandedMode } from '@devvit/web/client';
import React from 'react';
import { createRoot } from 'react-dom/client';

function Splash() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#1a1a1b',
        color: 'white',
        gap: '16px',
      }}
    >
      <h2>Sub Bingo</h2>
      <button
        onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
        style={{
          padding: '8px 16px',
          background: '#818384',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '14px',
        }}
      >
        Play
      </button>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Splash />);
