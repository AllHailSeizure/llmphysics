import { context, showToast } from '@devvit/web/client';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { runSimMonteCarlo } from './sim-mc';
import bgUrl from './assets/SVGAssets_Mobile Background.svg';
import desktopBgUrl from './assets/SVGAssets_Background.png';
import settingsBtnUrl from './assets/SVGAssets_SettingsButton.svg';
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

// ─── Simulation tab — local type aliases (mirrors SimDay / SimulationData from server) ─

type SimDay = {
  dayIndex: number; dayStartTs: number; dayEndTs: number;
  triggeredKeys: string[]; dayKeys?: string[]; postsScanned: number; commentsScanned: number;
};
type SimData = {
  generatedAt: number; subredditName: string; pool: string[]; days: SimDay[];
};

// ─── SVG bar chart ────────────────────────────────────────────────────────────

type SimBarChartProps = {
  dayCounts: number[];
  neverCount: number;
  totalSims: number;
  dayLabels: string[];
};

function SimBarChart({ dayCounts, neverCount, totalSims, dayLabels }: SimBarChartProps) {
  const W = 320, H = 130, PL = 30, PB = 32, PT = 8, PR = 8;
  const cW = W - PL - PR, cH = H - PB - PT;
  const all = [...dayCounts, neverCount];
  const maxCount = Math.max(...all, 1);
  const barW = Math.floor(cW / 8) - 2;
  const labels = [...dayLabels, 'Never'];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', maxWidth: W, margin: '0 auto' }}>
      {[0.25, 0.5, 0.75, 1.0].map((f) => {
        const y = PT + cH - f * cH;
        return (
          <g key={f}>
            <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
            <text x={PL - 3} y={y + 3} textAnchor="end" fontSize={7} fill="rgba(255,255,255,0.3)">
              {Math.round((f * maxCount / totalSims) * 100)}%
            </text>
          </g>
        );
      })}
      {all.map((count, i) => {
        const bH = (count / maxCount) * cH;
        const x = PL + i * (cW / 8) + 1;
        const y = PT + cH - bH;
        const isNever = i === 7;
        const pct = ((count / totalSims) * 100).toFixed(1);
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={bH}
              fill={isNever ? 'rgba(220,80,80,0.7)' : 'rgba(100,160,255,0.7)'} rx={1} />
            {bH > 14 && (
              <text x={x + barW / 2} y={y + 10} textAnchor="middle" fontSize={7} fill="white">{pct}%</text>
            )}
            <text
              x={x + barW / 2} y={PT + cH + 11}
              textAnchor="middle" fontSize={6.5} fill="rgba(255,255,255,0.45)"
              transform={`rotate(-35,${x + barW / 2},${PT + cH + 11})`}>
              {labels[i]}
            </text>
          </g>
        );
      })}
      <line x1={PL} y1={PT + cH} x2={W - PR} y2={PT + cH} stroke="rgba(255,255,255,0.25)" strokeWidth={0.5} />
    </svg>
  );
}

// ─── Simulation tab ───────────────────────────────────────────────────────────

function SimulationTab({ panelStyle }: { panelStyle: React.CSSProperties }) {
  const [fetchStatus, setFetchStatus] = useState<'idle' | 'loading' | 'fetching' | 'done' | 'error'>('idle');
  const [simData, setSimData] = useState<SimData | null>(null);
  const [currentDay, setCurrentDay] = useState(0);
  const [errMsg, setErrMsg] = useState('');
  const [mcResult, setMcResult] = useState<{ dayCounts: number[]; neverCount: number } | null>(null);
  const [simSubTab, setSimSubTab] = useState<'graph' | 'tiles'>('graph');

  useEffect(() => {
    setFetchStatus('loading');
    fetch('/api/bingo/simulation')
      .then((r) => r.json() as Promise<any>)
      .then((res) => {
        if (res.status === 'ready') {
          setSimData(res.data);
          setMcResult(computeMC(res.data));
          setFetchStatus('done');
        } else if (res.status === 'partial') {
          setSimData(res.data);
          setFetchStatus('idle');
        } else {
          setFetchStatus('idle');
        }
      })
      .catch(() => setFetchStatus('idle'));
  }, []);

  function computeMC(data: SimData) {
    const dayTriggered: Record<string, number> = {};
    for (const day of [...data.days].sort((a, b) => a.dayIndex - b.dayIndex)) {
      for (const key of day.triggeredKeys) {
        if (!(key in dayTriggered)) dayTriggered[key] = day.dayIndex;
      }
    }
    return runSimMonteCarlo(data.pool, dayTriggered, 5000);
  }

  async function startFetch(reset: boolean) {
    const startDay = reset ? 0 : (simData?.days.length ?? 0);
    setFetchStatus('fetching');
    setErrMsg('');
    if (reset) { setSimData(null); setMcResult(null); }
    let latest: SimData | null = reset ? null : simData;

    for (let day = startDay; day <= 6; day++) {
      setCurrentDay(day);
      try {
        const res = await fetch('/api/bingo/simulation/fetch-day', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dayIndex: day, reset: reset && day === 0 }),
        }).then((r) => r.json() as Promise<any>);
        if (!res.ok) { setErrMsg(res.reason ?? 'Fetch failed.'); setFetchStatus('error'); return; }
        latest = res.data as SimData;
        setSimData({ ...latest });
      } catch (err) {
        setErrMsg((err as Error).message);
        setFetchStatus('error');
        return;
      }
    }
    if (latest) setMcResult(computeMC(latest));
    setFetchStatus('done');
  }

  const fmt = (ts: number) =>
    new Date(ts).toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' });

  const daysComputed = simData?.days.length ?? 0;
  const totalPosts = simData?.days.reduce((s, d) => s + d.postsScanned, 0) ?? 0;
  const totalComments = simData?.days.reduce((s, d) => s + d.commentsScanned, 0) ?? 0;
  const sortedDays = simData ? [...simData.days].sort((a, b) => a.dayIndex - b.dayIndex) : [];
  const dayLabels = sortedDays.map((d) => fmt(d.dayStartTs));

  let medianDay: number | null = null;
  let p90Day: number | null = null;
  if (mcResult) {
    const sorted: number[] = [];
    mcResult.dayCounts.forEach((count, day) => { for (let i = 0; i < count; i++) sorted.push(day); });
    sorted.sort((a, b) => a - b);
    if (sorted.length) {
      medianDay = sorted[Math.floor(sorted.length * 0.5)]!;
      p90Day = sorted[Math.floor(sorted.length * 0.9)]!;
    }
  }

  const btn = (label: string, onClick: () => void, bg = 'rgba(255,255,255,0.08)') => (
    <button onClick={onClick} style={{ ...panelStyle, cursor: 'pointer', background: bg, padding: '5px 10px', fontSize: 12, width: 'auto' }}>
      {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', margin: 0, lineHeight: 1.4 }}>
        Fetches 7 days of real sub activity and runs 5,000-card simulations to estimate game duration.
        Each day takes ~6–18s (Reddit API + Gemini).
      </p>

      {fetchStatus === 'loading' && <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', margin: 0 }}>Checking cache…</p>}

      {fetchStatus === 'idle' && daysComputed === 0 && btn('Start 7-day fetch', () => startFetch(true), '#0071e3')}

      {fetchStatus === 'idle' && daysComputed > 0 && daysComputed < 7 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={{ fontSize: 11, color: '#f0c040', margin: 0 }}>{daysComputed}/7 days cached.</p>
          {btn(`Resume (days ${daysComputed + 1}–7)`, () => startFetch(false), '#0071e3')}
          {btn('Reset and restart', () => startFetch(true))}
        </div>
      )}

      {fetchStatus === 'done' && btn('Re-fetch (clear cache)', () => startFetch(true))}

      {fetchStatus === 'fetching' && (
        <div>
          <p style={{ fontSize: 12, color: '#7fd6a8', margin: '0 0 4px' }}>
            Fetching day {currentDay + 1}/7… ({daysComputed} complete)
          </p>
          <div style={{ height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(daysComputed / 7) * 100}%`, background: '#0071e3', transition: 'width 0.3s' }} />
          </div>
        </div>
      )}

      {daysComputed > 0 && (
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', margin: 0 }}>
          {daysComputed}/7 days · {totalPosts} posts · {totalComments} comments scanned
        </p>
      )}

      {simData && daysComputed > 0 && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button onClick={() => setSimSubTab('graph')}
              style={{ ...panelStyle, cursor: 'pointer', padding: '3px 10px', fontSize: 11, width: 'auto',
                background: simSubTab === 'graph' ? '#0071e3' : 'rgba(255,255,255,0.08)' }}>
              Graph
            </button>
            <button onClick={() => setSimSubTab('tiles')}
              style={{ ...panelStyle, cursor: 'pointer', padding: '3px 10px', fontSize: 11, width: 'auto',
                background: simSubTab === 'tiles' ? '#0071e3' : 'rgba(255,255,255,0.08)' }}>
              Tiles
            </button>
          </div>

          {simSubTab === 'graph' && mcResult && fetchStatus === 'done' && (
            <>
              <p style={{ fontSize: 12, fontWeight: 700, margin: '0 0 2px' }}>
                5,000-card Monte Carlo
                {medianDay !== null ? ` · median: day ${medianDay + 1}` : ''}
                {p90Day !== null ? ` · p90: day ${p90Day + 1}` : ''}
              </p>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', margin: '0 0 6px' }}>
                {((mcResult.neverCount / 5000) * 100).toFixed(1)}% of cards never bingo in this 7-day window
              </p>
              <SimBarChart dayCounts={mcResult.dayCounts} neverCount={mcResult.neverCount}
                totalSims={5000} dayLabels={dayLabels} />
              {sortedDays.length >= 2 && (
                <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', margin: '4px 0 0', textAlign: 'center' }}>
                  {fmt(sortedDays[0]!.dayStartTs)} – {fmt(sortedDays[sortedDays.length - 1]!.dayEndTs - 1)}
                </p>
              )}
            </>
          )}

          {simSubTab === 'graph' && !mcResult && (
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', margin: 0 }}>
              Complete the 7-day fetch to see the chart.
            </p>
          )}

          {simSubTab === 'tiles' && (() => {
            const dayCounts: Record<string, number> = {};
            for (const day of sortedDays) {
              for (const key of (day.dayKeys ?? [])) {
                dayCounts[key] = (dayCounts[key] ?? 0) + 1;
              }
            }
            const untriggered = simData.pool.filter((k) => !(k in dayCounts));
            const triggered = simData.pool
              .filter((k) => k in dayCounts)
              .sort((a, b) => dayCounts[b]! - dayCounts[a]!);
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#7fd6a8', margin: '0 0 4px' }}>
                    Fired at least once — {daysComputed}/7 days ({triggered.length} tiles)
                  </p>
                  {triggered.length === 0
                    ? <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', margin: 0 }}>None yet.</p>
                    : triggered.map((k) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0', color: 'rgba(255,255,255,0.8)' }}>
                          <span>{k}</span>
                          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>
                            {dayCounts[k]}/{daysComputed} days
                          </span>
                        </div>
                      ))
                  }
                </div>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#f0c040', margin: '0 0 4px' }}>
                    Never triggered ({untriggered.length}) — candidates for rewriting
                  </p>
                  {untriggered.length === 0
                    ? <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', margin: 0 }}>All tiles fired at least once.</p>
                    : untriggered.map((k) => (
                        <div key={k} style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', padding: '2px 0' }}>{k}</div>
                      ))
                  }
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {fetchStatus === 'error' && (
        <p style={{ fontSize: 11, color: '#e07f7f', margin: 0 }}>{errMsg}</p>
      )}
    </div>
  );
}

function ModPanel({ postId, onClose }: { postId: string; onClose: () => void }) {
  const [tab, setTab] = useState<'settings' | 'stats' | 'testing' | 'simulation'>('settings');
  const [stats, setStats] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [toast, setToast] = useState('');
  const [testType, setTestType] = useState<'post' | 'comment'>('post');
  const [testId, setTestId] = useState('');
  const [batch, setBatch] = useState<any[]>([]);
  const [results, setResults] = useState<any[] | null>(null);
  const [testMsg, setTestMsg] = useState('');

  useEffect(() => {
    fetch(`/api/bingo/stats?postId=${postId}`).then((r) => r.json()).then(setStats).catch(() => setStats({ error: true }));
    fetch(`/api/bingo/settings`).then((r) => r.json()).then(setSettings).catch(() => setSettings({ error: true }));
  }, [postId]);

  const h = (ms: number | null) => (ms == null ? 'never' : (ms / 3600000).toFixed(1) + 'h');

  const save = async (extra: Record<string, unknown> = {}) => {
    const res = await fetch(`/api/bingo/settings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...settings, ...extra }),
    }).then((r) => r.json());
    setToast(res.message ?? 'Saved.');
  };

  const prefix = testType === 'post' ? 't3_' : 't1_';

  const addTest = async () => {
    const raw = testId.trim().replace(/^t[0-9]_/, '');
    if (!raw) { setTestMsg('Enter an ID.'); return; }
    const res = await fetch('/api/bingo/test/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: testType, id: prefix + raw }),
    }).then((r) => r.json());
    if (res.ok) {
      setBatch((b) => [...b, res.event]);
      setTestId('');
      setResults(null);
      setTestMsg(`Added ${res.event.type} by u/${res.event.author ?? '?'}.`);
    } else setTestMsg(res.reason ?? 'Could not resolve.');
  };

  const runTest = async () => {
    setTestMsg('Validating…');
    const res = await fetch('/api/bingo/test/run', { method: 'POST' }).then((r) => r.json());
    if (res.ok) {
      setResults(res.triggered);
      setTestMsg(res.triggered.length ? `${res.triggered.length} tile(s) triggered.` : 'No tiles triggered.');
    } else setTestMsg(res.reason ?? 'Validation failed.');
  };

  const clearTest = async () => {
    await fetch('/api/bingo/test/clear', { method: 'POST' });
    setBatch([]); setResults(null); setTestMsg('Cleared.');
  };

  const box: React.CSSProperties = { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: 'white', padding: '6px 8px', width: '100%', fontSize: 12, boxSizing: 'border-box' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'rgba(10,20,30,0.98)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12, padding: 16, width: '100%', maxWidth: 380, maxHeight: '85vh', overflowY: 'auto', color: 'white' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button onClick={() => setTab('settings')} style={{ ...box, width: 'auto', background: tab === 'settings' ? '#0071e3' : box.background, cursor: 'pointer' }}>Settings</button>
          <button onClick={() => setTab('stats')} style={{ ...box, width: 'auto', background: tab === 'stats' ? '#0071e3' : box.background, cursor: 'pointer' }}>Stats</button>
          <button onClick={() => setTab('testing')} style={{ ...box, width: 'auto', background: tab === 'testing' ? '#0071e3' : box.background, cursor: 'pointer' }}>Testing</button>
          <button onClick={() => setTab('simulation')} style={{ ...box, width: 'auto', background: tab === 'simulation' ? '#0071e3' : box.background, cursor: 'pointer' }}>Sim</button>
          <button onClick={onClose} style={{ ...box, width: 'auto', marginLeft: 'auto', cursor: 'pointer' }}>✕</button>
        </div>

        {tab === 'stats' && (
          <div>
            {!stats ? <p style={{ fontSize: 12 }}>Loading…</p> : stats.error ? <p style={{ fontSize: 12 }}>Failed to load stats.</p> : (
              <>
                <p style={{ fontSize: 13, fontWeight: 700 }}>Verdict: {stats.pacing.verdict}</p>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>median {h(stats.pacing.medianBingoMs)} · p10 {h(stats.pacing.p10BingoMs)} · p90 {h(stats.pacing.p90BingoMs)} · never {stats.pacing.neverBingoPct}%</p>
                <table style={{ width: '100%', fontSize: 11, marginTop: 8, borderCollapse: 'collapse' }}>
                  <thead><tr style={{ color: 'rgba(255,255,255,0.5)' }}><th style={{ textAlign: 'left' }}>tile</th><th style={{ textAlign: 'left' }}>first</th><th style={{ textAlign: 'left' }}>by</th></tr></thead>
                  <tbody>
                    {stats.tiles.map((t: any) => (
                      <tr key={t.valueKey} style={{ color: t.firstTriggerAt == null ? '#e0857f' : 'white' }}>
                        <td>{t.label}</td><td>{h(t.firstTriggerAt)}</td><td>{t.triggeredBy || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        {tab === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {!settings ? <p style={{ fontSize: 12 }}>Loading…</p> : settings.error ? <p style={{ fontSize: 12 }}>Failed to load settings.</p> : (
              <>
                <label style={{ fontSize: 11 }}>First winner message
                  <input style={box} value={settings.firstWinnerMessage} onChange={(e) => setSettings({ ...settings, firstWinnerMessage: e.target.value })} /></label>
                <label style={{ fontSize: 11 }}>Bingo message
                  <input style={box} value={settings.bingoMessage} onChange={(e) => setSettings({ ...settings, bingoMessage: e.target.value })} /></label>
                <label style={{ fontSize: 11 }}>Full card message
                  <input style={box} value={settings.fullCardMessage} onChange={(e) => setSettings({ ...settings, fullCardMessage: e.target.value })} /></label>
                <button onClick={() => save()} style={{ ...box, cursor: 'pointer', background: '#0071e3' }}>Save</button>
                <button onClick={() => save({ runBatchNow: true })} style={{ ...box, cursor: 'pointer' }}>Run batch validation now</button>
              </>
            )}
            {toast && <p style={{ fontSize: 11, color: '#7fd6a8', margin: 0 }}>{toast}</p>}
          </div>
        )}

        {tab === 'testing' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', margin: 0, lineHeight: 1.4 }}>
              Moderator testing tool. Resolves a real post or comment from r/{settings?.subredditName ?? '…'} only —
              it never reads other subreddits, and never affects the live game or its stats.
            </p>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => { setTestType('post'); setTestId(''); }} style={{ ...box, cursor: 'pointer', background: testType === 'post' ? '#0071e3' : box.background }}>Post</button>
              <button onClick={() => { setTestType('comment'); setTestId(''); }} style={{ ...box, cursor: 'pointer', background: testType === 'comment' ? '#0071e3' : box.background }}>Comment</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', ...box, padding: 0 }}>
              <span style={{ padding: '6px 2px 6px 8px', fontSize: 12, color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace' }}>{prefix}</span>
              <input value={testId} onChange={(e) => setTestId(e.target.value)} placeholder="paste the ID" onKeyDown={(e) => e.key === 'Enter' && addTest()} style={{ ...box, border: 'none', background: 'transparent', paddingLeft: 0 }} />
            </div>
            <button onClick={addTest} style={{ ...box, cursor: 'pointer', background: '#0071e3' }}>Add to test batch</button>
            {batch.length > 0 && (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
                <p style={{ margin: '4px 0', fontWeight: 700 }}>Batch ({batch.length})</p>
                {batch.map((e, i) => (
                  <div key={i} style={{ opacity: 0.85 }}>• [{e.type}] u/{e.author ?? '?'} — {(e.title || e.body || '').slice(0, 50)}</div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={runTest} disabled={batch.length === 0} style={{ ...box, cursor: batch.length ? 'pointer' : 'default', opacity: batch.length ? 1 : 0.5, background: '#0071e3' }}>Run validation</button>
              <button onClick={clearTest} style={{ ...box, width: 'auto', cursor: 'pointer' }}>Clear</button>
            </div>
            {results && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 700, margin: '0 0 4px' }}>Triggered tiles</p>
                {results.length === 0 ? <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>None.</p> : results.map((t: any) => (
                  <div key={t.valueKey} style={{ fontSize: 11 }}>✓ {t.label} <span style={{ color: 'rgba(255,255,255,0.5)' }}>by {t.triggeredBy || '—'}</span></div>
                ))}
              </div>
            )}
            {testMsg && <p style={{ fontSize: 11, color: '#7fd6a8', margin: 0 }}>{testMsg}</p>}
          </div>
        )}

        {tab === 'simulation' && <SimulationTab panelStyle={box} />}
      </div>
    </div>
  );
}

/** Tile label that shrinks its font until it fits the square — never clips or bleeds. */
function AutoFitText({ text, bold }: { text: string; bold: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      // Shrink the font until the content fits both ways. wordBreak is normal, so a long
      // word (e.g. "Cosmological") overflows width and forces a smaller font rather than
      // splitting mid-word; only spaces wrap.
      let size = 15;
      el.style.fontSize = `${size}px`;
      while (size > 5 && (el.scrollWidth > el.clientWidth + 0.5 || el.scrollHeight > el.clientHeight + 0.5)) {
        size -= 0.5;
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [text]);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        inset: '9%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        color: 'white',
        lineHeight: 1.1,
        fontWeight: bold ? 700 : 600,
        textShadow: '0 1px 4px rgba(0,0,0,0.9)',
        overflow: 'hidden',
        wordBreak: 'normal',
        overflowWrap: 'normal',
        whiteSpace: 'normal',
        zIndex: 2,
      }}
    >
      {text}
    </div>
  );
}

// ─── Board layout profiles — one per background art ──────────────────────────────
// The frame is aspect-locked to the chosen art and sized to COVER (fills the modal;
// excess is cropped). The grid is positioned absolutely as a % of the frame so it lands
// on the art's black play-square. The profile is chosen by the modal's real aspect:
// tall modal (mobile, full-screen) → portrait art; wide modal (desktop) → landscape art.
type LayoutProfile = { bg: string; aspect: string; ratio: number; boardTop: string; boardW: string };
const LAYOUTS: Record<'portrait' | 'landscape', LayoutProfile> = {
  // Mobile portrait art (SVG viewBox 318×635).
  portrait: { bg: bgUrl, aspect: '318.19705 / 635.34849', ratio: 1.9967, boardTop: '30%', boardW: '78%' },
  // Desktop landscape art (1920×1080 PNG, centered 1000×1000 black square).
  landscape: { bg: desktopBgUrl, aspect: '1920 / 1080', ratio: 1080 / 1920, boardTop: '3.7%', boardW: '52%' },
};
const FOOTER_BOTTOM = '3%'; // footer distance from the frame bottom
const AMBIENT_BG = '#06080d'; // fill behind the art on letterboxed screens

function BingoGame() {
  const [squares, setSquares] = useState<Square[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [winningIndices, setWinningIndices] = useState<number[]>([]);
  const [selectedTile, setSelectedTile] = useState<Square | null>(null);
  const [isMod, setIsMod] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [isWide, setIsWide] = useState(false);
  const hasWonRef = useRef(false);

  const postId = context.postId || 'unknown';
  const userId = context.userId || 'anonymous';

  // Pick the layout by ORIENTATION (aspect ratio), which is scale-invariant — a phone
  // webview reports a misleadingly large innerWidth, so absolute width is unreliable, but a
  // phone modal is always taller-than-wide and the desktop modal is wider-than-tall.
  useEffect(() => {
    const check = () => setIsWide(window.innerWidth / window.innerHeight >= 1.0);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  const layout = isWide ? LAYOUTS.landscape : LAYOUTS.portrait;

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
          setIsMod(!!data.isMod);
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

  const ambientWrap = (node: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: AMBIENT_BG, color: 'rgba(255,255,255,0.7)', fontFamily: "'Inter', sans-serif", fontSize: '14px' }}>
      {node}
    </div>
  );

  if (loading) return ambientWrap(<p>Loading…</p>);
  if (error) return ambientWrap(<p>Error: {error}</p>);
  if (squares.length === 0) return ambientWrap(<p style={{ color: 'rgba(255,255,255,0.5)' }}>Coming soon.</p>);

  return (
    <div style={{
      height: '100vh',
      width: '100%',
      background: AMBIENT_BG,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      fontFamily: "'Inter', sans-serif",
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale',
      boxSizing: 'border-box',
      overflow: 'hidden',
    }}>
      {selectedTile && <TileModal tile={selectedTile} onClose={() => setSelectedTile(null)} />}
      {isMod && (
        <button
          onClick={() => setPanelOpen(true)}
          style={{ position: 'fixed', top: 10, right: 10, zIndex: 150, width: 40, height: 40, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
          aria-label="Mod settings"
        >
          <img src={settingsBtnUrl} alt="" style={{ width: '100%', height: '100%', display: 'block' }} />
        </button>
      )}
      {panelOpen && <ModPanel postId={postId} onClose={() => setPanelOpen(false)} />}

      {/* Aspect-locked frame matching the active background art, sized to COVER the modal
          (fills it; excess is cropped by the outer overflow:hidden). The grid is positioned
          absolutely as a % of the frame so it always lands on the art's black play-square,
          on either the portrait (mobile) or landscape (desktop) art. */}
      <div style={{
        position: 'relative',
        height: `max(100vh, 100vw * ${layout.ratio})`,
        aspectRatio: layout.aspect,
        backgroundImage: `url(${layout.bg})`,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
      }}>
        <div style={{ position: 'absolute', top: layout.boardTop, left: '50%', transform: 'translateX(-50%)', width: layout.boardW, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
          {squares.map((sq, i) => {
            const isWinning = winningIndices.includes(i);
            const url = tileImage(sq, isWinning);
            const glow = tileGlow(sq, isWinning);
            const isInteractable = !sq.free;

            return (
              <div
                key={i}
                style={{
                  position: 'relative',
                  aspectRatio: '1',
                  cursor: isInteractable ? 'pointer' : 'default',
                  transition: 'transform 0.1s ease',
                }}
                onClick={() => isInteractable && setSelectedTile(sq)}
                onMouseEnter={(e) => { if (isInteractable) e.currentTarget.style.transform = 'scale(1.03)'; }}
                onMouseLeave={(e) => { if (isInteractable) e.currentTarget.style.transform = 'scale(1)'; }}
              >
                {glow && (
                  <img
                    src={glow}
                    style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '140%', height: '140%', zIndex: 0, pointerEvents: 'none' }}
                    alt=""
                  />
                )}
                <img
                  src={url}
                  style={{ width: '100%', height: '100%', display: 'block', position: 'relative', zIndex: 1 }}
                  alt=""
                />
                <AutoFitText text={sq.free ? 'FREE' : (sq.displayName || sq.label)} bold={isWinning} />
              </div>
            );
          })}
        </div>

        <p style={{ position: 'absolute', bottom: FOOTER_BOTTOM, left: 0, right: 0, color: 'rgba(255,255,255,0.4)', fontSize: '9px', textAlign: 'center' }}>
          by AllHailSeizure
        </p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<BingoGame />);