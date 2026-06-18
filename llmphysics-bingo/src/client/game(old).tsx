import { context, showToast } from '@devvit/web/client';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import bgUrl from './assets/SVGAssets_Mobile Background.svg';
import bgDesktopUrl from './assets/SVGAssets_Background.svg';
import logoUrl from './assets/SVGAssets_Logo.svg';
import tileUrl from './assets/SVGAssets_Tile.svg';
import tileActiveUrl from './assets/SVGAssets_Active Tile.svg';
import tileActiveGlowUrl from './assets/SVGAssets_Active Tile (Glow).svg';
import tileWinningUrl from './assets/SVGAssets_Winning TIle.svg';
import tileWinningGlowUrl from './assets/SVGAssets_Winning Tile (Glow).svg';

type Square = {
  label: string;
  displayName: string;
  gameDescription: string;
  valueKey: string;
  marked: boolean;
  free?: boolean;
  selfTriggered?: boolean;
};

function tileImage(sq: Square, isWinning: boolean): string {
  if (isWinning) return tileWinningUrl;
  if (sq.marked && !sq.selfTriggered) return tileActiveUrl;
  return tileUrl;
}

function tileGlow(sq: Square, isWinning: boolean): string | null {
  if (isWinning) return tileWinningGlowUrl;
  if (sq.marked && !sq.selfTriggered) return tileActiveGlowUrl;
  return null;
}

function TileModal({ tile, onClose }: { tile: Square; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'rgba(10, 20, 30, 0.97)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: '12px',
          padding: '20px',
          maxWidth: '320px',
          width: '100%',
          color: 'white',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '10px' }}>
          {tile.displayName || tile.label}
        </div>
        <div style={{ fontSize: '13px', lineHeight: 1.5, color: 'rgba(255,255,255,0.8)', marginBottom: '16px' }}>
          {tile.gameDescription || tile.label}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '6px',
            color: 'white',
            padding: '8px 16px',
            fontSize: '13px',
            cursor: 'pointer',
            width: '100%',
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

function BingoGame() {
  const [squares, setSquares] = useState<Square[]>([]);
  const [activeBgUrl, setActiveBgUrl] = useState(bgUrl);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [winningIndices, setWinningIndices] = useState<number[]>([]);
  const [selectedTile, setSelectedTile] = useState<Square | null>(null);
  const hasWonRef = useRef(false);

  const postId = context.postId || 'unknown';
  const userId = context.userId || 'anonymous';

  useEffect(() => {
    setActiveBgUrl(window.screen.width >= 768 ? bgDesktopUrl : bgUrl);
  }, []);

  useEffect(() => {
    const load = () => {
      fetch(`/api/bingo/state?postId=${postId}&userId=${userId}`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((data) => {
          if (data.operatorView) {
            setLoading(false);
            return;
          }
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
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundImage: `url(${activeBgUrl})`, backgroundSize: 'cover', color: 'white' }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundImage: `url(${activeBgUrl})`, backgroundSize: 'cover', color: 'white' }}>
        <p>Error: {error}</p>
      </div>
    );
  }

  if (squares.length === 0) {
    // TODO: swap placeholder text for custom Snoo image once asset is ready
    // import comingSoonUrl from './assets/SVGAssets_Coming Soon.svg'; (or PNG)
    // then: <img src={comingSoonUrl} style={{ maxWidth: '320px', width: '100%' }} alt="Coming soon" />
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundImage: `url(${activeBgUrl})`, backgroundSize: 'cover', color: 'rgba(255,255,255,0.5)', fontSize: '14px', gap: '12px' }}>
        <p style={{ margin: 0 }}>Coming soon.</p>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      fontFamily: "'Inter', sans-serif",
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale',
      backgroundImage: `url(${activeBgUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '24px 12px 16px',
      boxSizing: 'border-box',
    }}>
      {selectedTile && <TileModal tile={selectedTile} onClose={() => setSelectedTile(null)} />}
      <img src={logoUrl} alt="bingo.llm" style={{ maxWidth: '280px', width: '100%', marginBottom: '16px' }} />

      <div style={{
        width: '100%',
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
            const glow = tileGlow(sq, isWinning);
            return (
              <div key={i} style={{ position: 'relative', aspectRatio: '1', cursor: 'pointer' }} onClick={() => !sq.free && setSelectedTile(sq)}>
                {glow && (
                  <img
                    src={glow}
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: '140%',
                      height: '140%',
                      zIndex: 0,
                      pointerEvents: 'none',
                    }}
                    alt=""
                  />
                )}
                <img
                  src={url}
                  style={{ width: '100%', height: '100%', display: 'block', position: 'relative', zIndex: 1 }}
                  alt=""
                />
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  color: 'white',
                  textAlign: 'center',
                  whiteSpace: 'pre-line',
                  padding: '3px',
                  fontWeight: isWinning ? 700 : 500,
                  lineHeight: 1.25,
                  letterSpacing: '0.01em',
                  textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                  zIndex: 2,
                }}>
                  {sq.free ? 'FREE' : (sq.displayName || sq.label)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '9px', marginTop: '8px', textAlign: 'right', width: '100%' }}>
        by AllHailSeizure
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<BingoGame />);
