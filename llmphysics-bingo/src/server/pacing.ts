export type TileTrigger = { valueKey: string; firstTriggerAt: number | null; triggeredBy: string | null; fireCount: number };

/** 5 rows, 5 cols, 2 diagonals — same set as src/server/bingo.ts checkWin. */
export const WIN_LINES: number[][] = (() => {
  const lines: number[][] = [];
  for (let r = 0; r < 5; r++) lines.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
  for (let c = 0; c < 5; c++) lines.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
  lines.push([0, 6, 12, 18, 24]);
  lines.push([4, 8, 12, 16, 20]);
  return lines;
})();

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Same shape as bingo.ts generateCard: 24 shuffled pool tiles + 'free' spliced at index 12. */
export function generateCardKeys(pool: string[], rng: () => number = Math.random): string[] {
  let picked = shuffle(pool, rng);
  while (picked.length < 24) picked = picked.concat(shuffle(pool, rng));
  picked = picked.slice(0, 24);
  picked.splice(12, 0, 'free');
  return picked;
}

/**
 * Earliest time a winning line is fully marked. FREE counts as marked at t=0.
 * A tile is "marked at t" if firstTrigger[key] is a number; self-triggered keys never count.
 * Returns null if no line ever completes.
 */
export function earliestBingo(
  card: string[],
  firstTrigger: Record<string, number | null>,
  selfTriggered: Set<string>
): number | null {
  const markTime = (key: string): number | null => {
    if (key === 'free') return 0;
    if (selfTriggered.has(key)) return null;
    return firstTrigger[key] ?? null;
  };
  let best: number | null = null;
  for (const line of WIN_LINES) {
    let lineComplete = 0;
    let ok = true;
    for (const idx of line) {
      const t = markTime(card[idx]!);
      if (t === null) { ok = false; break; }
      lineComplete = Math.max(lineComplete, t);
    }
    if (ok && (best === null || lineComplete < best)) best = lineComplete;
  }
  return best;
}

export type PacingOptions = { cards: number; startTs: number; rng?: () => number };
export type PacingResult = {
  cards: number;
  neverBingoPct: number;
  p10BingoMs: number | null;
  medianBingoMs: number | null;
  p90BingoMs: number | null;
  verdict: 'too easy' | 'good' | 'too vague';
};

const DAY = 86_400_000;

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

/** Monte-Carlo: generate `cards` random cards, compute time-to-bingo relative to startTs. */
export function runPacing(pool: string[], timeline: TileTrigger[], opts: PacingOptions): PacingResult {
  const rng = opts.rng ?? Math.random;
  const firstTrigger: Record<string, number | null> = { free: 0 };
  for (const t of timeline) firstTrigger[t.valueKey] = t.firstTriggerAt;

  const times: number[] = [];
  let never = 0;
  for (let i = 0; i < opts.cards; i++) {
    const card = generateCardKeys(pool, rng);
    const t = earliestBingo(card, firstTrigger, new Set());
    if (t === null) never++;
    else times.push(t - opts.startTs);
  }
  times.sort((a, b) => a - b);
  const median = percentile(times, 50);
  const neverPct = (never / opts.cards) * 100;

  let verdict: PacingResult['verdict'] = 'good';
  if (median !== null && median < DAY / 2) verdict = 'too easy';
  else if (median === null || median > 7 * DAY || neverPct > 10) verdict = 'too vague';

  return {
    cards: opts.cards,
    neverBingoPct: Number(neverPct.toFixed(1)),
    p10BingoMs: percentile(times, 10),
    medianBingoMs: median,
    p90BingoMs: percentile(times, 90),
    verdict,
  };
}
