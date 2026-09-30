/**
 * Looking at sound: the waveform's peaks, loudness over time, the spectrogram,
 * and the features two recordings are compared by (loudness and the shape of
 * the spectrum, frame by frame). Pure functions on mono samples; the page
 * decodes the files (decode.ts) and draws the results.
 */

/* ------------------------------------------------------------------ FFT */

/** In-place radix-2 FFT of `re` + i·`im` (length a power of two). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

const hann = new Map<number, Float64Array>();
function window(n: number): Float64Array {
  let w = hann.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    hann.set(n, w);
  }
  return w;
}

/** The magnitude spectrum (size/2 bins) of `size` samples from `start`. */
export function spectrum(samples: Float32Array, start: number, size: number): Float64Array {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const w = window(size);
  for (let i = 0; i < size; i++) re[i] = (samples[start + i] ?? 0) * w[i]!;
  fft(re, im);
  const out = new Float64Array(size / 2);
  for (let k = 0; k < size / 2; k++) out[k] = Math.hypot(re[k]!, im[k]!) / size;
  return out;
}

/* ------------------------------------------------------------- pictures */

/** The lowest and highest sample in each of `buckets` stretches: the waveform, as it is drawn. */
export function peaks(samples: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets * 2);
  const per = samples.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * per);
    const to = Math.max(from + 1, Math.floor((b + 1) * per));
    let lo = 0;
    let hi = 0;
    for (let i = from; i < to && i < samples.length; i++) {
      const v = samples[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    out[b * 2] = lo;
    out[b * 2 + 1] = hi;
  }
  return out;
}

/** Loudness in decibels (RMS, full scale = 0 dB, floored at -90) in frames of `hop` samples. */
export function loudness(samples: Float32Array, hop: number): Float32Array {
  const n = Math.max(1, Math.ceil(samples.length / hop));
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    let count = 0;
    for (let i = f * hop; i < Math.min(samples.length, (f + 1) * hop); i++) {
      sum += samples[i]! * samples[i]!;
      count++;
    }
    out[f] = count ? Math.max(-90, 10 * Math.log10(sum / count + 1e-12)) : -90;
  }
  return out;
}

export interface Spectrogram {
  /** Frames × bins, in decibels, frame after frame. */
  data: Float32Array;
  frames: number;
  bins: number;
  /** The frequency of the top bin. */
  maxHz: number;
}

/** A spectrogram of `frames` columns (evenly across the recording) with `size`/2 bins each. */
export function spectrogram(samples: Float32Array, rate: number, frames: number, size = 512): Spectrogram {
  const bins = size / 2;
  const data = new Float32Array(frames * bins);
  const span = Math.max(0, samples.length - size);
  for (let f = 0; f < frames; f++) {
    const start = frames > 1 ? Math.round((f / (frames - 1)) * span) : 0;
    const s = spectrum(samples, start, size);
    for (let k = 0; k < bins; k++) data[f * bins + k] = 20 * Math.log10(s[k]! + 1e-9);
  }
  return { data, frames, bins, maxHz: rate / 2 };
}

/* ------------------------------------------------------------- features */

/** Frames per second the recordings are compared at, and the most frames a recording gets (three hours' worth: longer ones get fewer a second). */
export const FEATURE_FPS = 20;
const MAX_FRAMES = FEATURE_FPS * 3 * 3600;
const BANDS = 24;

export interface Features {
  /** Frames per second. */
  fps: number;
  frames: number;
  /** Loudness per frame, dB. */
  level: Float32Array;
  /** The spectrum's shape per frame: BANDS log band energies, the frame's mean taken out. */
  shape: Float32Array;
  /** The notes per frame: energy in each of the 12 pitch classes (so a change of pitch counts, however small the step). */
  chroma: Float32Array;
}

const CHROMA = 12;

/** The pitch class (0 = A) of each spectrum bin between 80 Hz and 5 kHz, or -1. */
function chromaBins(rate: number, size: number): Int8Array {
  const out = new Int8Array(size / 2).fill(-1);
  for (let k = 1; k < size / 2; k++) {
    const f = (k * rate) / size;
    if (f < 80 || f > 5000) continue;
    out[k] = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12) % 12;
  }
  return out;
}

/** Band edges on a mel-like scale, from 60 Hz to just under half the rate. */
function bandEdges(rate: number, size: number): number[] {
  const mel = (f: number) => 2595 * Math.log10(1 + f / 700);
  const hz = (m: number) => 700 * (10 ** (m / 2595) - 1);
  const lo = mel(60);
  const hi = mel(Math.min(7600, rate / 2 - 1));
  const edges: number[] = [];
  for (let i = 0; i <= BANDS; i++) edges.push(Math.max(1, Math.round((hz(lo + ((hi - lo) * i) / BANDS) / rate) * size)));
  return edges;
}

/**
 * The frames a second two recordings are compared at, the longer lasting
 * `duration` seconds: FEATURE_FPS, or fewer, so that neither has more than
 * `maxFrames` frames. Both recordings must have the same: frames of
 * different lengths don't line up, and the same sound would seem to differ.
 */
export function featureRate(duration: number, maxFrames = MAX_FRAMES): number {
  return Math.min(FEATURE_FPS, maxFrames / Math.max(duration, 1e-3));
}

/**
 * What a recording is compared by: loudness and spectral shape, frame by
 * frame, at `fps` frames a second (featureRate). At fewer than FEATURE_FPS
 * (a long recording), each frame's spectrum is the average of windows across
 * the whole frame, one every 1/FEATURE_FPS s as at the full rate, so none of
 * the sound goes unheard.
 */
export function features(samples: Float32Array, rate: number, fps = featureRate(samples.length / rate)): Features {
  const hop = rate / fps;
  const size = 1024;
  const frames = Math.max(1, Math.floor(samples.length / hop));
  const level = new Float32Array(frames);
  const shape = new Float32Array(frames * BANDS);
  const chroma = new Float32Array(frames * CHROMA);
  const edges = bandEdges(rate, size);
  const pitch = chromaBins(rate, size);
  /** Windows a frame's spectrum is averaged over: one at the full frame rate. */
  const windows = Math.max(1, Math.ceil(fps < FEATURE_FPS ? FEATURE_FPS / fps : 1));
  const power = new Float64Array(size / 2);
  for (let f = 0; f < frames; f++) {
    const start = Math.round(f * hop);
    let sum = 0;
    const end = Math.min(samples.length, start + Math.round(hop));
    for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!;
    level[f] = Math.max(-90, 10 * Math.log10(sum / Math.max(1, end - start) + 1e-12));
    power.fill(0);
    for (let w = 0; w < windows; w++) {
      const at = start + Math.round((w * hop) / windows);
      const sw = spectrum(samples, Math.max(0, Math.min(at, samples.length - size)), size);
      for (let k = 0; k < sw.length; k++) power[k] = power[k]! + (sw[k]! * sw[k]!) / windows;
    }
    let mean = 0;
    for (let b = 0; b < BANDS; b++) {
      let e = 0;
      for (let k = edges[b]!; k < Math.max(edges[b]! + 1, edges[b + 1]!); k++) e += power[k]!;
      const v = 10 * Math.log10(e + 1e-12);
      shape[f * BANDS + b] = v;
      mean += v;
    }
    mean /= BANDS;
    for (let b = 0; b < BANDS; b++) shape[f * BANDS + b] = shape[f * BANDS + b]! - mean;
    for (let k = 0; k < pitch.length; k++) if (pitch[k]! >= 0) chroma[f * CHROMA + pitch[k]!] = chroma[f * CHROMA + pitch[k]!]! + power[k]!;
  }
  return { fps, frames, level, shape, chroma };
}

/** How different two frames sound, about 0 (the same) to 1 (nothing alike). */
export function frameDistance(a: Features, i: number, b: Features, j: number): number {
  const la = a.level[i]!;
  const lb = b.level[j]!;
  // Two silences are the same, whatever their spectra.
  if (la < -55 && lb < -55) return 0;
  const dLevel = Math.min(1, Math.abs(la - lb) / 24);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let k = 0; k < BANDS; k++) {
    const x = a.shape[i * BANDS + k]!;
    const y = b.shape[j * BANDS + k]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const cos = na && nb ? dot / Math.sqrt(na * nb) : 1;
  const dShape = Math.min(1, Math.max(0, (1 - cos) / 1.2));
  let cd = 0;
  let ca = 0;
  let cb = 0;
  for (let k = 0; k < CHROMA; k++) {
    const x = a.chroma[i * CHROMA + k]!;
    const y = b.chroma[j * CHROMA + k]!;
    cd += x * y;
    ca += x * x;
    cb += y * y;
  }
  // No pitched sound in either: nothing to say about notes.
  const dChroma = ca > 1e-10 && cb > 1e-10 ? Math.min(1, Math.max(0, 1 - cd / Math.sqrt(ca * cb))) : 0;
  return Math.min(1, 0.35 * dLevel + 0.35 * dShape + 0.3 * dChroma * 1.6);
}
