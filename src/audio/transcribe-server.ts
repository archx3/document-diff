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

let offered: Promise<boolean> | null = null;

/** Whether the server this page came from transcribes (asked once). */
export function serverTranscribes(): Promise<boolean> {
  if (standalone() || typeof fetch === 'undefined' || typeof location === 'undefined' || location.protocol === 'file:') return Promise.resolve(false);
  offered ??= fetch(endpoint(), { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<{ available?: boolean }>) : { available: false }))
    .then((b) => !!b.available)
    .catch(() => false);
  return offered;
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
  } catch {
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
