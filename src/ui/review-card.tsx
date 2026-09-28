import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Ico } from '../components/icons';
import type { HighlightColor, Reaction } from '../review/marks';
import { HIGHLIGHT_COLORS, REACTIONS } from '../review/marks';
import { REACTION_ICON, REACTION_NAME } from './rail';
import type { Side } from './util';
import { SIDE_NAME } from './util';

/** A note as the card shows it. */
export interface CardNote {
  id: string;
  text: string;
  /** The words it is on, for a note on some text. */
  quote?: string;
  /** On the change as a whole. */
  onChange: boolean;
  created: number;
  updated?: number;
}

/** What the card is about, and the marks already there. */
export interface ReviewContext {
  side: Side;
  rowKey: string;
  /** The change the row is part of, or -1. */
  hunk: number;
  /** What a new note or highlight goes on: the selected text, the change, or the paragraph. */
  what: 'selection' | 'change' | 'paragraph';
  /** The selected words, or the start of the paragraph. */
  quote: string;
  notes: CardNote[];
  reactions: Reaction[];
  /** Highlight colours on what a highlight would go on. */
  highlights: HighlightColor[];
  /** Opened to write a note. */
  writing: boolean;
}

export interface ReviewCardProps {
  ctx: ReviewContext;
  onReact(r: Reaction): void;
  /** Highlights in a colour, or with null clears the highlights. */
  onHighlight(color: HighlightColor | null): void;
  onAddNote(text: string): void;
  onEditNote(id: string, text: string): void;
  onDelete(id: string): void;
}

const COLOR_NAME: Record<HighlightColor, string> = { yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink' };

export function when(t: number, now = Date.now()): string {
  const s = Math.round((now - t) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(t).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

function excerpt(s: string, n = 90): string {
  const t = s.replace(/\ufffc/g, '▫').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Saves on Ctrl/⌘+Enter. */
function saveKey(e: KeyboardEvent<HTMLTextAreaElement>, save: () => void) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    save();
  }
}

/**
 * The marks on one side of a row, from its margin: reactions to the change,
 * highlight colours, the notes there, and a box to write a new one.
 */
export function ReviewCard({ ctx, onReact, onHighlight, onAddNote, onEditNote, onDelete }: ReviewCardProps) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState('');
  const where = SIDE_NAME[ctx.side];
  const title = ctx.what === 'selection' ? `Selected text in ${where}` : ctx.hunk >= 0 ? `Change ${ctx.hunk + 1}` : `Paragraph in ${where}`;
  const noteOn = ctx.what === 'selection' ? 'the selected text' : ctx.what === 'change' ? 'this change' : 'this paragraph';
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onAddNote(t);
    setDraft('');
  };
  const save = (id: string) => {
    const t = edit.trim();
    if (t) onEditNote(id, t);
    setEditing(null);
  };
  return (
    <div className="review-card" role="dialog" aria-label={title} id="review-card">
      <div className="rc-head">
        <span className="rc-title">{title}</span>
        {ctx.quote && ctx.what !== 'change' && <span className="rc-quote">“{excerpt(ctx.quote)}”</span>}
      </div>

      {ctx.hunk >= 0 && (
        <div className="rc-section">
          <span className="rc-label">Mark the change</span>
          <div className="rc-reactions" role="group" aria-label="Mark the change">
            {REACTIONS.map((r) => (
              <button key={r} type="button" className={`rc-react ${r}`} data-react={r} aria-pressed={ctx.reactions.includes(r)} onClick={() => onReact(r)}>
                <Ico name={REACTION_ICON[r]} />
                <span>{REACTION_NAME[r]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {ctx.quote && (
        <div className="rc-section">
          <span className="rc-label">{ctx.what === 'selection' ? 'Highlight the selection' : 'Highlight the paragraph'}</span>
          <div className="rc-swatches" role="group" aria-label="Highlight colour">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`rc-swatch ${c}`}
                data-color={c}
                aria-label={`${COLOR_NAME[c]} highlight`}
                aria-pressed={ctx.highlights.includes(c)}
                data-tip={COLOR_NAME[c]}
                onClick={() => onHighlight(c)}
              />
            ))}
            {ctx.highlights.length > 0 && (
              <button type="button" className="btn ghost sm rc-clear" data-color="none" onClick={() => onHighlight(null)}>
                Remove
              </button>
            )}
          </div>
        </div>
      )}

      <div className="rc-section">
        <span className="rc-label">Notes</span>
        {ctx.notes.length > 0 && (
          <ul className="rc-notes">
            {ctx.notes.map((n) => (
              <li key={n.id} className="rc-note" data-note={n.id}>
                {n.quote && <span className="rc-note-on">on “{excerpt(n.quote, 60)}”</span>}
                {n.onChange && ctx.what !== 'change' && <span className="rc-note-on">on the change</span>}
                {editing === n.id ? (
                  <>
                    <textarea
                      className="rc-text"
                      aria-label="Edit the note"
                      value={edit}
                      rows={3}
                      data-autofocus
                      onChange={(e) => setEdit(e.currentTarget.value)}
                      onKeyDown={(e) => saveKey(e, () => save(n.id))}
                    />
                    <div className="rc-actions">
                      <button type="button" className="btn sm" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                      <button type="button" className="btn sm primary" onClick={() => save(n.id)}>
                        Save
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="rc-note-text">{n.text}</p>
                    <div className="rc-note-foot">
                      <span className="rc-when">{n.updated ? `edited ${when(n.updated)}` : when(n.created)}</span>
                      <button
                        type="button"
                        className="btn ghost icon-only sm"
                        aria-label="Edit the note"
                        data-tip="Edit"
                        onClick={() => {
                          setEditing(n.id);
                          setEdit(n.text);
                        }}
                      >
                        <Ico name="edit" />
                      </button>
                      <button type="button" className="btn ghost icon-only sm" aria-label="Delete the note" data-tip="Delete" onClick={() => onDelete(n.id)}>
                        <Ico name="trash" />
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <textarea
          className="rc-text"
          aria-label={`A new note on ${noteOn}`}
          placeholder={`Add a note on ${noteOn}…`}
          value={draft}
          rows={ctx.writing ? 3 : 2}
          data-autofocus={ctx.writing || undefined}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => saveKey(e, add)}
        />
        <div className="rc-actions">
          <span className="rc-hint">Ctrl+Enter</span>
          <button type="button" className="btn sm primary" data-add-note disabled={!draft.trim()} onClick={add}>
            Add note
          </button>
        </div>
      </div>
    </div>
  );
}
