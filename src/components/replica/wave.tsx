/**
 * Made-up recordings for the replicas and sample cards: how loud a recording
 * is over time, as bursts of sound (words, notes) between quiet stretches.
 * Seeded, so the server and the browser draw the same picture.
 */

function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Loudness from 0 to 1 at `n` points over `length` seconds, with sound during each [start, end] span. */
export function fakePeaks(seed: number, n: number, length: number, spans: ReadonlyArray<readonly [number, number]>): number[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * length;
    const s = spans.find(([a, b]) => t >= a && t < b);
    if (!s) return 0.02 + r() * 0.03;
    const p = (t - s[0]) / (s[1] - s[0]);
    return Math.min(1, Math.sin(Math.PI * p) ** 0.5 * (0.35 + r() * 0.65));
  });
}

/** A waveform: a bar above and below the middle for each point. */
export function Waveform({ peaks, color, className }: { peaks: number[]; color: string; className?: string }) {
  const h = 40;
  const d = peaks.map((p, i) => `M${i + 0.5} ${h / 2 - (p * h) / 2 - 0.3}V${h / 2 + (p * h) / 2 + 0.3}`).join('');
  return (
    <svg className={className} viewBox={`0 0 ${peaks.length} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} stroke={color} strokeWidth={0.62} fill="none" />
    </svg>
  );
}

/** Loudness: the peaks smoothed into a filled curve. */
export function Loudness({ peaks, color }: { peaks: number[]; color: string }) {
  const h = 40;
  const smooth = peaks.map((_, i) => {
    const w = peaks.slice(Math.max(0, i - 3), i + 4);
    return w.reduce((s, x) => s + x, 0) / w.length;
  });
  const top = smooth.map((p, i) => `${i === 0 ? 'M' : 'L'}${i} ${(h - p * h * 0.9).toFixed(2)}`).join('');
  return (
    <svg viewBox={`0 0 ${peaks.length} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${top}L${peaks.length} ${h}L0 ${h}Z`} fill={color} fillOpacity={0.3} stroke={color} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** A spectrogram: each column's loudness spread over pitch bands, strongest low down, as speech is. */
export function Spectrogram({ peaks, seed }: { peaks: number[]; seed: number }) {
  const r = rng(seed);
  const rows = 14;
  const cells = [];
  for (let x = 0; x < peaks.length; x += 2) {
    const p = peaks[x] ?? 0;
    for (let y = 0; y < rows; y++) {
      // Rows run from the highest pitches at the top to the lowest, and loudest, at the bottom.
      const band = (y + 1) / rows;
      const v = Math.min(1, p * (0.25 + band * 0.9) * (0.6 + r() * 0.6));
      if (v < 0.06) continue;
      cells.push(<rect key={`${x}-${y}`} x={x} y={y * 3} width={2} height={3} fill={`hsl(${30 + v * 20} 90% ${25 + v * 45}%)`} fillOpacity={0.25 + v * 0.75} />);
    }
  }
  return (
    <svg viewBox={`0 0 ${peaks.length} ${rows * 3}`} preserveAspectRatio="none" aria-hidden="true" style={{ background: '#10222b' }}>
      {cells}
    </svg>
  );
}
