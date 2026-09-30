/**
 * The parts shared by notes on pictures and on recordings: what the views
 * can do with them (MediaNotesApi, kept by the app with the other marks), the
 * card a note is written in, and the list of notes in the pane.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Ico } from '../components/icons';
import type { MediaNote } from '../review/media-notes';
import type { HighlightColor } from '../review/marks';
import { HIGHLIGHT_COLORS } from '../review/marks';
import { clock } from './facts';
import { when } from './review-card';
import { SIDE_NAME } from './util';

export interface MediaNotesApi {
  list: readonly MediaNote[];
  add(note: MediaNote): void;
  update(id: string, patch: Partial<Pick<MediaNote, 'text' | 'color'>>): void;
  remove(id: string): void;
  /** Who is writing (for new notes). */
  author?: string;
  /** The note open to write in, if any. */
  open: string | null;
  setOpen(id: string | null): void;
}

const COLOR_NAME: Record<HighlightColor, string> = { yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink' };

/** Where a note is, in words: "A, 0:12–0:15" or "B, top left". */
export function whereIs(n: MediaNote): string {
  const side = SIDE_NAME[n.side];
  if (n.at.type === 'time') return n.at.end - n.at.start < 0.05 ? `${side}, ${clock(n.at.start)}` : `${side}, ${clock(n.at.start)}–${clock(n.at.end)}`;
  const cx = n.at.x + n.at.w / 2;
  const cy = n.at.y + n.at.h / 2;
  const v = cy < 1 / 3 ? 'top' : cy > 2 / 3 ? 'bottom' : 'middle';
  const h = cx < 1 / 3 ? 'left' : cx > 2 / 3 ? 'right' : v === 'middle' ? '' : 'middle';
  return `${side}, ${v === 'middle' && !h ? 'middle' : `${v}${h ? ` ${h}` : ''}`}`;
}

/**
 * The card a note is written in, beside its area or stretch. Done (or a press
 * elsewhere, or Ctrl+Enter) keeps it; Escape leaves it as it was. A note left
 * with nothing written is removed.
 */
export function NoteEditor({ note, number, api, style }: { note: MediaNote; number: number; api: MediaNotesApi; style?: CSSProperties }) {
  const [text, setText] = useState(note.text);
  const [color, setColor] = useState(note.color);
  const el = useRef<HTMLDivElement>(null);
  const latest = useRef({ text, color });
  latest.current = { text, color };

  const finish = (keep: boolean) => {
    const t = keep ? latest.current.text.trim() : note.text;
    if (!t) api.remove(note.id);
    else if (keep && (t !== note.text || latest.current.color !== note.color)) api.update(note.id, { text: t, color: latest.current.color });
    api.setOpen(null);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // A press anywhere else keeps what was written.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (el.current && !el.current.contains(e.target as Node)) finishRef.current(true);
    };
    const t = setTimeout(() => document.addEventListener('pointerdown', down, true));
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', down, true);
    };
  }, []);

  return (
    <div
      className="mn-editor"
      ref={el}
      style={style}
      role="dialog"
      aria-label={`Note ${number}`}
      data-note-editor={note.id}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') finish(false);
        else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) finish(true);
      }}
    >
      <div className="mn-editor-head">
        <span className={`mn-num hl-${color}`}>{number}</span>
        <span className="mn-where">{whereIs(note)}</span>
        <span className="mn-swatches" role="radiogroup" aria-label="Colour">
          {HIGHLIGHT_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={COLOR_NAME[c]} className={`mn-swatch hl-${c}`} data-color={c} onClick={() => setColor(c)} />
          ))}
        </span>
      </div>
      <textarea
        className="mn-text"
        value={text}
        placeholder="Write a note…"
        rows={3}
        autoFocus
        data-note-text
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mn-actions">
        <button type="button" className="btn ghost sm" data-note="delete" onClick={() => api.remove(note.id)}>
          <Ico name="trash" />
          <span>Delete</span>
        </button>
        <button type="button" className="btn primary sm" data-note="done" onClick={() => finish(true)}>
          Done
        </button>
      </div>
    </div>
  );
}

/** The notes in the pane: each goes to its place when clicked. */
export function NotesList({ notes, api, onGo, empty }: { notes: readonly MediaNote[]; api: MediaNotesApi; onGo(n: MediaNote): void; empty: string }) {
  if (!notes.length) return <p className="ap-none">{empty}</p>;
  return (
    <ol className="changes-list" data-notes>
      {notes.map((n, i) => (
        <li key={n.id}>
          <div className={`chg-card mn-card${api.open === n.id ? ' cur' : ''}`}>
            <button type="button" className="mn-go" data-note-item={i} onClick={() => onGo(n)}>
              <span className="chg-head">
                <span className={`mn-num hl-${n.color}`}>{i + 1}</span>
                <span className="mn-where">{whereIs(n)}</span>
                <span className="at-len">{when(n.updated ?? n.created)}</span>
              </span>
              <span className="mn-card-text">{n.text || <em>No words yet</em>}</span>
              {n.author && <span className="mn-author">{n.author}</span>}
            </button>
            <button type="button" className="btn ghost icon-only sm mn-del" aria-label={`Delete note ${i + 1}`} data-tip="Delete" onClick={() => api.remove(n.id)}>
              <Ico name="trash" />
            </button>
          </div>
        </li>
      ))}
    </ol>
  );
}
