// Monte Carlo helpers — pure functions mirroring pacing.ts server logic.
// Any logic change to generateCardKeys or earliestBingo in pacing.ts must be mirrored here.

const WIN_LINES: number[][] = (() => {
  const lines: number[][] = [];
  for (let r = 0; r < 5; r++) lines.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
  for (let c = 0; c < 5; c++) lines.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
  lines.push([0, 6, 12, 18, 24]);
  lines.push([4, 8, 12, 16, 20]);
  return lines;
})();

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** 24 shuffled pool tiles + 'free' at index 12. Matches server generateCardKeys. */
export function simGenerateCard(pool: string[]): string[] {
  let picked = shuffle(pool);
  while (picked.length < 24) picked = picked.concat(shuffle(pool));
  picked = picked.slice(0, 24);
  picked.splice(12, 0, 'free');
  return picked;
}

/**
 * Returns the dayIndex (0-6) on which the first win line is complete, or null.
 * 'free' is treated as always triggered (day -Infinity).
 * dayTriggered maps tileKey → first dayIndex it appeared (cumulative from simulation data).
 */
export function simEarliestBingo(card: string[], dayTriggered: Record<string, number>): number | null {
  let best: number | null = null;
  for (const line of WIN_LINES) {
    let lineDay = 0;
    let ok = true;
    for (const idx of line) {
      const key = card[idx]!;
      if (key === 'free') continue;
      const d = dayTriggered[key];
      if (d === undefined) { ok = false; break; }
      if (d > lineDay) lineDay = d;
    }
    if (ok && (best === null || lineDay < best)) best = lineDay;
  }
  return best;
}

/**
 * Run n Monte Carlo simulations. Returns how many cards first got bingo on each
 * day (dayCounts[0..6]) and how many never got bingo within the 7-day window.
 */
export function runSimMonteCarlo(
  pool: string[],
  dayTriggered: Record<string, number>,
  n: number
): { dayCounts: number[]; neverCount: number } {
  const dayCounts = [0, 0, 0, 0, 0, 0, 0];
  let neverCount = 0;
  for (let i = 0; i < n; i++) {
    const card = simGenerateCard(pool);
    const day = simEarliestBingo(card, dayTriggered);
    if (day === null) neverCount++;
    else dayCounts[day]!++;
  }
  return { dayCounts, neverCount };
}
