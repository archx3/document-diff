/**
 * Transcribing recordings (the worker does the listening: transcribe.worker.ts).
 * Transcripts come with each word's time, so the words that differ between two
 * recordings can be found (the text comparison) and heard (the times).
 */
import type { WorkerIn, WorkerOut } from './transcribe.worker';

export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface Transcript {
  text: string;
  words: Word[];
  /** Stretches (start and end, in seconds) in which nothing is said, as far as the model can tell. */
  quiet?: Array<[number, number]>;
}

export type TranscribeProgress = { stage: 'model'; done: number } | { stage: 'transcribing' };

let worker: Worker | null = null;
let seq = 0;

/** Whether this page can transcribe (not the single-file build, which carries no worker). */
export function canTranscribe(): boolean {
  if (typeof Worker === 'undefined') return false;
  try {
    return import.meta.env?.MODE !== 'single';
  } catch {
    return true;
  }
}

/** The site's base path, where the model and its runtime are served. */
function base(): string {
  try {
    return process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  } catch {
    return '';
  }
}

/** What was said in a recording (mono samples at 16 kHz), with each word's time. */
export function transcribe(audio: Float32Array, onProgress?: (p: TranscribeProgress) => void, language?: string): Promise<Transcript> {
  worker ??= new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' });
  const id = ++seq;
  const w = worker;
  return new Promise((resolve, reject) => {
    const on = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'progress') onProgress?.(m.stage === 'model' ? { stage: 'model', done: m.done ?? 0 } : { stage: 'transcribing' });
      else {
        w.removeEventListener('message', on);
        if (m.type === 'done') resolve({ text: m.text, words: m.words, quiet: m.quiet });
        else reject(new Error(m.message));
      }
    };
    w.addEventListener('message', on);
    // The samples are copied: the caller keeps its own for drawing and playing.
    const msg: WorkerIn = { id, audio: audio.slice(), base: base(), language };
    w.postMessage(msg, [msg.audio.buffer]);
  });
}
