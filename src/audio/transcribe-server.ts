/**
 * Transcribing on the server (the site's /api/transcribe, which passes the
 * recording on to server/transcribe: whisper.cpp behind a small Go service),
 * for when the browser's own model is too slow. Only with the reader's
 * consent: the recording leaves the device. What is sent is the sound already
 * decoded for comparing — 16 kHz mono, as a WAV file — and what comes back is
 * the same transcript the worker makes.
 */
import { ANALYSIS_RATE } from './decode';
import type { Transcript, Word } from './transcribe';

/** The site's transcription endpoint (with the slash every URL here ends in: a redirect would lose the recording). */
function endpoint(): string {
  try {
    return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/api/transcribe/`;
  } catch {
    return '/api/transcribe/';
  }
}

/** Whether this is the single-file build (no server behind it). */
function standalone(): boolean {
  try {
    return import.meta.env?.MODE === 'single';
  } catch {
    return false;
  }
}

/** What the server says about its transcription: whether it has it, and the longest recording it takes (seconds). */
interface Offer {
  available: boolean;
  maxSeconds?: number;
}

let offered: Promise<Offer> | null = null;

function offer(): Promise<Offer> {
  if (standalone() || typeof fetch === 'undefined' || typeof location === 'undefined' || location.protocol === 'file:') return Promise.resolve({ available: false });
  offered ??= fetch(endpoint(), { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<Partial<Offer>>) : ({} as Partial<Offer>)))
    .then((b) => ({ available: !!b.available, maxSeconds: typeof b.maxSeconds === 'number' && b.maxSeconds > 0 ? b.maxSeconds : undefined }))
    .catch(() => ({ available: false }));
  return offered;
}

/** Whether the server this page came from transcribes (asked once). */
export function serverTranscribes(): Promise<boolean> {
  return offer().then((o) => o.available);
}

/**
 * The longest recording the server takes, in seconds, when it says: a longer
 * one is refused there, so it isn't sent (nor, for a pair, the other one).
 */
export function serverLimit(): Promise<number | undefined> {
  return offer().then((o) => o.maxSeconds);
}

/** A length of time in a sentence: "30 minutes", or 31:30 when it isn't a whole number of minutes. */
function span(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (Math.abs(seconds - m * 60) < 1) return `${m} ${m === 1 ? 'minute' : 'minutes'}`;
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Why a pair can't go to the transcription server: a recording longer than it
 * takes (`limit` seconds), which it would refuse once sent. Null when both fit;
 * a recording already transcribed (not sent again) has no length here.
 */
export function tooLongForServer(limit: number | undefined, seconds: { a?: number; b?: number }): string | null {
  if (!limit) return null;
  // The service's limit is on the WAV's size, with a little room for its header.
  const over = (['a', 'b'] as const).filter((side) => (seconds[side] ?? 0) > limit + 0.1);
  if (!over.length) return null;
  const which = over.length === 2 ? `A and B are ${span(seconds.a!)} and ${span(seconds.b!)} long` : `${over[0]!.toUpperCase()} is ${span(seconds[over[0]!]!)} long`;
  return `${which}, and the transcription server takes recordings of up to ${span(limit)}. Transcribe on this device instead, or compare shorter recordings.`;
}

/** Where recordings go, for the reader: this site. */
export function transcribeServer(): string {
  return typeof location === 'undefined' ? '' : location.origin;
}

/** Mono samples (-1 to 1) as a 16-bit PCM WAV file. */
export function wavOf(samples: Float32Array, rate = ANALYSIS_RATE): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** What was said in a recording (mono samples at 16 kHz), transcribed by the service. */
export async function transcribeOnServer(audio: Float32Array, language = 'auto', signal?: AbortSignal): Promise<Transcript> {
  let res: Response;
  try {
    res = await fetch(`${endpoint()}?lang=${encodeURIComponent(language)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: wavOf(audio),
      signal,
      cache: 'no-store',
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error('The transcription server can’t be reached.');
  }
  const body = (await res.json().catch(() => ({}))) as { text?: string; words?: Word[]; error?: string };
  if (!res.ok) throw new Error(body.error ? `The server couldn’t transcribe it: ${body.error}.` : `The transcription server answered ${res.status}.`);
  const words = (body.words ?? []).filter((w) => typeof w.text === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end));
  return { text: body.text ?? words.map((w) => w.text).join(' '), words };
}

/* ------------------------------------------------------------- consent */

const CONSENT_KEY = 'collate.transcribe-consent';

/** Whether the reader has said recordings may go to this server, for good (not just once). */
export function consentGiven(server = transcribeServer()): boolean {
  try {
    return !!server && localStorage.getItem(CONSENT_KEY) === server;
  } catch {
    return false;
  }
}

export function rememberConsent(remember: boolean, server = transcribeServer()): void {
  try {
    if (remember) localStorage.setItem(CONSENT_KEY, server);
    else localStorage.removeItem(CONSENT_KEY);
  } catch {
    /* Asked again next time. */
  }
}
