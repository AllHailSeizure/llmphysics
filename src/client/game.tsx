import { context, showToast } from '@devvit/web/client';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

type Square = { label: string; valueKey: string; marked: boolean; free?: boolean };

function BingoGame() {
  const [squares, setSquares] = useState<Square[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [winningIndices, setWinningIndices] = useState<number[]>([]);
  const hasWonRef = useRef(false);

  const postId = context.postId || 'unknown';
  const userId = context.userId || 'anonymous';

  useEffect(() => {
    const load = () => {
      fetch(`/api/bingo/state?postId=${postId}&userId=${userId}`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((data) => {
          setSquares(data.squares);
          setWinningIndices(data.winningIndices || []);
          if (data.hasWin && !hasWonRef.current) {
            hasWonRef.current = true;
            showToast({ text: '🎉 BINGO! 🎉', appearance: 'success' });
          }
          setLoading(false);
        })
        .catch((err) => {
          console.error('Failed to load bingo card:', err);
          setError(err.message);
          setLoading(false);
        });
    };

    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [postId, userId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#1a1a1b', color: 'white' }}>
        <p>Loading bingo card...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#1a1a1b', color: 'white' }}>
        <p>Error: {error}</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px', background: '#1a1a1b', minHeight: '100vh' }}>
      <h1 style={{ color: 'white', marginBottom: '24px' }}>Sub Bingo</h1>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: '4px',
          maxWidth: '400px',
        }}
      >
        {squares.map((sq, i) => {
          const isWinning = winningIndices.includes(i);
          return (
            <div
              key={i}
              style={{
                background: isWinning ? '#ffd700' : sq.marked ? '#ff4500' : '#333',
                color: isWinning ? '#000' : 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                aspectRatio: '1',
                fontSize: '11px',
                textAlign: 'center',
                borderRadius: '4px',
                padding: '4px',
                border: isWinning ? '2px solid #ff6b00' : '1px solid #555',
                cursor: 'default',
                opacity: sq.free ? 0.7 : 1,
                transition: 'background 200ms, border 200ms',
                fontWeight: isWinning ? 'bold' : 'normal',
              }}
            >
              {sq.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<BingoGame />);
