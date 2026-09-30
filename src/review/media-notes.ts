/**
 * Notes on pictures and recordings: an area of a picture (or a point on it),
 * or a stretch of a recording (or a moment in it), with what the reader wrote
 * and a colour. Like the notes on documents they are the reader's own, kept
 * with the comparison and in review files; they never go into the files.
 *
 * A picture's area is kept as fractions of the picture (both are compared at
 * the same size), so it stays put whatever the zoom; a recording's stretch is
 * in seconds of that recording.
 */
import type { HighlightColor } from './marks';
import { HIGHLIGHT_COLORS, markId } from './marks';
import type { Side } from './anchor';

export type MediaAnchor = { type: 'box'; x: number; y: number; w: number; h: number } | { type: 'time'; start: number; end: number };

export interface MediaNote {
  id: string;
  /** The picture or recording it was made on. */
  side: Side;
  at: MediaAnchor;
  text: string;
  color: HighlightColor;
  created: number;
  updated?: number;
  author?: string;
}

export function newMediaNote(side: Side, at: MediaAnchor, author?: string): MediaNote {
  return { id: markId(), side, at: normalize(at), text: '', color: 'yellow', created: Date.now(), author };
}

/** An anchor the right way round and within bounds (a box inside the picture, a stretch from its start to its end). */
export function normalize(at: MediaAnchor): MediaAnchor {
  if (at.type === 'time') {
    const [start, end] = at.start <= at.end ? [at.start, at.end] : [at.end, at.start];
    return { type: 'time', start: Math.max(0, start), end: Math.max(0, end) };
  }
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const x0 = clamp(Math.min(at.x, at.x + at.w));
  const y0 = clamp(Math.min(at.y, at.y + at.h));
  const x1 = clamp(Math.max(at.x, at.x + at.w));
  const y1 = clamp(Math.max(at.y, at.y + at.h));
  return { type: 'box', x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The notes of one kind (on pictures, or on recordings), in the order they were made. */
export function notesOf(notes: readonly MediaNote[], type: MediaAnchor['type']): MediaNote[] {
  return notes.filter((n) => n.at.type === type).sort((p, q) => p.created - q.created);
}

/** After A and B trade places. */
export function swapMediaNotes(notes: readonly MediaNote[]): MediaNote[] {
  return notes.map((n) => ({ ...n, side: n.side === 'a' ? 'b' : 'a' }));
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function readAnchor(raw: unknown): MediaAnchor | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.type === 'box' && num(o.x) && num(o.y) && num(o.w) && num(o.h)) return normalize({ type: 'box', x: o.x, y: o.y, w: o.w, h: o.h });
  if (o.type === 'time' && num(o.start) && num(o.end)) return normalize({ type: 'time', start: o.start, end: o.end });
  return null;
}

/** Notes read back from a session or a review file (anything malformed is left out). */
export function readMediaNotes(raw: unknown): MediaNote[] {
  if (!Array.isArray(raw)) return [];
  const out: MediaNote[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const at = readAnchor(o.at);
    if (!at || typeof o.id !== 'string' || (o.side !== 'a' && o.side !== 'b') || typeof o.text !== 'string' || !num(o.created)) continue;
    out.push({
      id: o.id,
      side: o.side,
      at,
      text: o.text,
      color: HIGHLIGHT_COLORS.includes(o.color as HighlightColor) ? (o.color as HighlightColor) : 'yellow',
      created: o.created,
      updated: num(o.updated) ? o.updated : undefined,
      author: typeof o.author === 'string' && o.author ? o.author : undefined,
    });
  }
  return out;
}
