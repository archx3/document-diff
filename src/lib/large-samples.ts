/**
 * The large samples, for trying the app by hand at the sizes the stress tests
 * use: long documents and long recordings, made on this machine by
 * `npm run samples:large` (scripts/stress) into tests/fixtures/out/stress,
 * which is not committed. The site serves them (the page at /samples/large/
 * and /api/large-samples/) only in development, or when LARGE_SAMPLES=1 says
 * so, as they are hundreds of megabytes and exist only where they were made.
 */
import { statSync } from 'node:fs';
import { join } from 'node:path';

export const LARGE_DIR = join(process.cwd(), 'tests', 'fixtures', 'out', 'stress');

export interface LargeSample {
  title: string;
  /** What it is, and what to look for. */
  text: string;
  kind: 'text' | 'audio';
  files: readonly [string, string];
}

const docs = (paragraphs: number, words: string, ext: 'docx' | 'txt'): LargeSample => ({
  title: `${paragraphs.toLocaleString('en')} paragraphs, ${ext === 'docx' ? 'Word' : 'plain text'}`,
  text: `About ${words} words a version. B rewords 4% of the paragraphs, drops 1%, adds 1% and moves a block of 20 from the first third to the last.`,
  kind: 'text',
  files: [`doc-${paragraphs}-a.${ext}`, `doc-${paragraphs}-b.${ext}`],
});

const talk = (minutes: number, a = `talk-${minutes}m-a.wav`, b = `talk-${minutes}m-b.wav`, how = 'WAV, 22.05 kHz mono'): LargeSample => ({
  title: `${minutes} minutes of talk, ${how}`,
  text: 'One sentence said over and over; B says one in seven differently and pauses longer now and then. So repetitive that lining it up is at its hardest.',
  kind: 'audio',
  files: [a, b],
});

const speech = (minutes: number): LargeSample => ({
  title: `${minutes} minutes of speech`,
  text: 'Varied sentences in a synthesised voice; B rewords 8% of them, leaves out 3% and adds 3% (what changed is in speech-*.json beside the files). Try transcribing both.',
  kind: 'audio',
  files: [`speech-${minutes}m-a.wav`, `speech-${minutes}m-b.wav`],
});

export const LARGE_SAMPLES: readonly LargeSample[] = [
  docs(10000, '370,000', 'docx'),
  docs(25000, '925,000', 'docx'),
  docs(50000, '1.85 million', 'docx'),
  docs(50000, '1.85 million', 'txt'),
  speech(10),
  speech(30),
  speech(60),
  talk(10),
  talk(30),
  talk(60),
  talk(30, 'talk-30m-a-stereo.wav', 'talk-30m-b.wav', 'A as a 318 MB WAV (44.1 kHz stereo)'),
  talk(30, 'talk-30m-a.m4a', 'talk-30m-b.m4a', 'AAC'),
];

/** Whether this server offers the large samples. */
export function largeSamplesOn(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.LARGE_SAMPLES === '1';
}

/** A large sample file's size in bytes, or null when it has not been made. */
export function largeSize(name: string): number | null {
  if (!LARGE_SAMPLES.some((s) => s.files.includes(name))) return null;
  try {
    return statSync(join(LARGE_DIR, name)).size;
  } catch {
    return null;
  }
}

const TYPES: Record<string, string> = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain; charset=utf-8', wav: 'audio/wav', m4a: 'audio/mp4' };

export function largeType(name: string): string {
  return TYPES[name.split('.').pop() ?? ''] ?? 'application/octet-stream';
}
