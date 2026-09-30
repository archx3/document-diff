/**
 * One recording drawn on a canvas: its waveform, its spectrogram or its
 * loudness over time. Drawn once per size and form (the playhead and marks
 * are drawn over it, by the view).
 */
import { memo, useEffect, useRef } from 'react';
import { loudness, peaks, spectrogram } from '../../audio/analyze';
import { ANALYSIS_RATE } from '../../audio/decode';
import type { AudioVis } from './use-audio-compare';

/** A colour map from quiet (dark) to loud (bright), like a thermal camera's. */
const STOPS: Array<[number, [number, number, number]]> = [
  [0, [12, 7, 35]],
  [0.25, [87, 16, 110]],
  [0.5, [188, 55, 84]],
  [0.75, [249, 142, 9]],
  [1, [252, 255, 164]],
];

function heat(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i]!;
    const [p0, c0] = STOPS[i - 1]!;
    if (x <= p1) {
      const k = (x - p0) / (p1 - p0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return STOPS[STOPS.length - 1]![1];
}

interface TrackProps {
  samples: Float32Array;
  vis: AudioVis;
  width: number;
  height: number;
  /** The side's colour (A's or B's). */
  color: string;
}

export const Track = memo(function Track({ samples, vis, width, height, color }: TrackProps) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c || width < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const cols = Math.max(1, Math.round(width));
    if (vis === 'wave') {
      const p = peaks(samples, cols);
      const mid = height / 2;
      g.fillStyle = color;
      for (let x = 0; x < cols; x++) {
        const lo = p[x * 2]!;
        const hi = p[x * 2 + 1]!;
        const top = mid - hi * mid * 0.95;
        g.fillRect(x, top, 1, Math.max(1, (hi - lo) * mid * 0.95));
      }
      g.fillStyle = 'rgba(128,128,128,0.35)';
      g.fillRect(0, mid, width, 1);
    } else if (vis === 'loudness') {
      const l = loudness(samples, Math.max(1, samples.length / cols));
      g.beginPath();
      g.moveTo(0, height);
      for (let x = 0; x < l.length; x++) g.lineTo((x / l.length) * width, height - ((Math.max(-60, l[x]!) + 60) / 60) * (height - 4));
      g.lineTo(width, height);
      g.closePath();
      g.globalAlpha = 0.35;
      g.fillStyle = color;
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = color;
      g.lineWidth = 1.5;
      g.stroke();
      // -20 and -40 dB lines, to read the levels by.
      g.fillStyle = 'rgba(128,128,128,0.35)';
      for (const db of [-20, -40]) g.fillRect(0, height - ((db + 60) / 60) * (height - 4), width, 1);
    } else {
      const frames = Math.min(cols, 1600);
      const sg = spectrogram(samples, ANALYSIS_RATE, frames, 512);
      const img = new ImageData(frames, sg.bins);
      for (let f = 0; f < frames; f++) {
        for (let k = 0; k < sg.bins; k++) {
          const [r, gg, b] = heat((sg.data[f * sg.bins + k]! + 110) / 90);
          const i = ((sg.bins - 1 - k) * frames + f) * 4;
          img.data[i] = r;
          img.data[i + 1] = gg;
          img.data[i + 2] = b;
          img.data[i + 3] = 255;
        }
      }
      const off = document.createElement('canvas');
      off.width = frames;
      off.height = sg.bins;
      off.getContext('2d')!.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true;
      g.drawImage(off, 0, 0, width, height);
    }
  }, [samples, vis, width, height, color]);

  return <canvas ref={canvas} className="at-canvas" style={{ width, height }} aria-hidden="true" />;
});
