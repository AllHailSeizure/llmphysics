import { context, showToast } from '@devvit/web/client';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import bgUrl from './assets/mobile-background.svg';
import logoUrl from './assets/logo.svg';
import tileInactiveUrl from './assets/tile-inactive.svg';
import tileActiveUrl from './assets/tile-active.svg';
import tileWinningUrl from './assets/tile-winning.svg';

type Square = { label: string; valueKey: string; marked: boolean; free?: boolean; selfTriggered?: boolean };

function tileImage(sq: Square, isWinning: boolean): string {
  if (isWinning) return tileWinningUrl;
  if (sq.marked && !sq.selfTriggered) return tileActiveUrl;
  return tileInactiveUrl;
}

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
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundImage: `url(${bgUrl})`, backgroundSize: 'cover', color: 'white' }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundImage: `url(${bgUrl})`, backgroundSize: 'cover', color: 'white' }}>
        <p>Error: {error}</p>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundImage: `url(${bgUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '24px 12px 16px',
      boxSizing: 'border-box',
    }}>
      <img src={logoUrl} alt="bingo.llm" style={{ maxWidth: '280px', width: '100%', marginBottom: '16px' }} />

      <div style={{
        background: 'rgba(10, 20, 25, 0.75)',
        borderRadius: '8px',
        padding: '10px',
        width: '100%',
        maxWidth: '360px',
        flex: 1,
        display: 'flex',
        alignItems: 'center',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: '6px',
          width: '100%',
        }}>
          {squares.map((sq, i) => {
            const isWinning = winningIndices.includes(i);
            const url = tileImage(sq, isWinning);
            return (
              <div key={i} style={{ position: 'relative', aspectRatio: '1' }}>
                <img
                  src={url}
                  style={{ width: '100%', height: '100%', display: 'block' }}
                  alt=""
                />
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '7px',
                  color: 'white',
                  textAlign: 'center',
                  padding: '3px',
                  fontWeight: isWinning ? 700 : 600,
                  lineHeight: 1.2,
                  textShadow: '0 1px 2px rgba(0,0,0,0.9)',
                }}>
                  {sq.free ? 'FREE' : sq.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '9px', marginTop: '8px', textAlign: 'right', width: '100%', maxWidth: '360px' }}>
        by AllHailSeizure
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<BingoGame />);
