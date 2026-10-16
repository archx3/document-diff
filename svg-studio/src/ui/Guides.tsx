import { memo } from 'react';

/** The 1-unit grid (shown once the zoom is high enough for it to be useful). */
export const Grid = memo(function Grid({ width, height, zoom }: { width: number; height: number; zoom: number }) {
  const minor: string[] = [];
  const major: string[] = [];
  const showMinor = zoom >= 7;
  for (let x = 0; x <= width; x++) (x % 4 === 0 ? major : minor).push(`M${x} 0V${height}`);
  for (let y = 0; y <= height; y++) (y % 4 === 0 ? major : minor).push(`M0 ${y}H${width}`);
  return (
    <g className="grid" fill="none" vectorEffect="non-scaling-stroke">
      {showMinor && <path className="grid-minor" d={minor.join('')} vectorEffect="non-scaling-stroke" />}
      <path className="grid-major" d={major.join('')} vectorEffect="non-scaling-stroke" />
    </g>
  );
});

/**
 * Keyline shapes, as in Lucide's icon design guide for the 24-unit canvas, scaled for other sizes: the
 * live area inside a 2-unit padding, a 20-unit circle, an 18-unit square and 16 × 20 and 20 × 16 rectangles.
 */
export const Keylines = memo(function Keylines({ width, height }: { width: number; height: number }) {
  const k = Math.min(width, height) / 24;
  const cx = width / 2;
  const cy = height / 2;
  const line = { vectorEffect: 'non-scaling-stroke' as const };
  return (
    <g className="keylines" fill="none">
      <rect x={cx - 10 * k} y={cy - 10 * k} width={20 * k} height={20 * k} className="keyline-pad" {...line} />
      <circle cx={cx} cy={cy} r={10 * k} {...line} />
      <rect x={cx - 9 * k} y={cy - 9 * k} width={18 * k} height={18 * k} rx={2 * k} {...line} />
      <rect x={cx - 8 * k} y={cy - 10 * k} width={16 * k} height={20 * k} rx={2 * k} {...line} />
      <rect x={cx - 10 * k} y={cy - 8 * k} width={20 * k} height={16 * k} rx={2 * k} {...line} />
      <path d={`M0 0L${width} ${height}M${width} 0L0 ${height}M${cx} 0V${height}M0 ${cy}H${width}`} className="keyline-axes" {...line} />
    </g>
  );
});
