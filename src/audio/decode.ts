/**
 * Decoding recordings in the browser: the file's own duration, sample rate
 * and channels, and the sound as mono samples at 16 kHz — enough to draw,
 * compare (analyze.ts) and transcribe (Whisper listens at 16 kHz). Each file
 * is decoded once.
 */

export const ANALYSIS_RATE = 16000;

export interface DecodedAudio {
  duration: number;
  /** The file's own sample rate, where its header says (the browser decodes at its own rate). */
  sampleRate: number | null;
  /** Bits per second of the file, for compressed formats. */
  bitrate: number;
  channels: number;
  /** The sound, mixed to one channel, at ANALYSIS_RATE. */
  mono: Float32Array;
}

const cache = new WeakMap<Uint8Array, Promise<DecodedAudio>>();

const MPEG_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** The sample rate a file's header gives (WAV, FLAC, MP3, Opus), or null. */
export function nativeRate(d: Uint8Array): number | null {
  const at = (i: number, s: string) => [...s].every((c, k) => d[i + k] === c.charCodeAt(0));
  const le32 = (i: number) => (d[i]! | (d[i + 1]! << 8) | (d[i + 2]! << 16) | (d[i + 3]! << 24)) >>> 0;
  if (at(0, 'RIFF') && at(8, 'WAVE')) {
    // The fmt chunk, wherever it is.
    for (let i = 12; i + 8 < Math.min(d.length, 4096); ) {
      const size = le32(i + 4);
      if (at(i, 'fmt ')) return le32(i + 12);
      i += 8 + size + (size % 2);
    }
    return null;
  }
  if (at(0, 'fLaC')) return ((d[18]! << 12) | (d[19]! << 4) | (d[20]! >> 4)) >>> 0;
  if (at(0, 'OggS') && d.length > 40 && at(28, 'OpusHead')) return 48000;
  // MPEG audio: past an ID3 tag, the first frame header.
  let i = 0;
  if (at(0, 'ID3')) i = 10 + ((d[6]! << 21) | (d[7]! << 14) | (d[8]! << 7) | d[9]!);
  for (const end = Math.min(d.length - 4, i + 8192); i < end; i++) {
    if (d[i] !== 0xff || (d[i + 1]! & 0xe0) !== 0xe0) continue;
    const version = (d[i + 1]! >> 3) & 3;
    const rate = MPEG_RATES[version]?.[(d[i + 2]! >> 2) & 3];
    if (rate) return rate;
  }
  return null;
}

/** A recording's sound, decoded (rejects when the browser can't play its format). */
export function decodeAudio(data: Uint8Array): Promise<DecodedAudio> {
  let p = cache.get(data);
  if (!p) {
    p = (async () => {
      if (typeof OfflineAudioContext === 'undefined') throw new Error('This browser can’t decode audio.');
      // decodeAudioData takes its buffer away: it gets a copy.
      const probe = new OfflineAudioContext(1, 1, 44100);
      let buf: AudioBuffer;
      try {
        buf = await probe.decodeAudioData(data.slice().buffer);
      } catch {
        throw new Error('This browser can’t play this recording’s format.');
      }
      const length = Math.max(1, Math.ceil(buf.duration * ANALYSIS_RATE));
      const ctx = new OfflineAudioContext(1, length, ANALYSIS_RATE);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
      const rendered = await ctx.startRendering();
      return {
        duration: buf.duration,
        sampleRate: nativeRate(data),
        bitrate: buf.duration ? (data.length * 8) / buf.duration : 0,
        channels: buf.numberOfChannels,
        mono: rendered.getChannelData(0),
      };
    })();
    p.catch(() => cache.delete(data));
    cache.set(data, p);
  }
  return p;
}
