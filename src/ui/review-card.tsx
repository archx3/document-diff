import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Ico } from '../components/icons';
import type { Decision, HighlightColor, Reaction } from '../review/marks';
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
  author?: string;
}

/** What the card is about, and the marks already there. */
export interface ReviewContext {
  side: Side;
  rowKey: string;
  /** The change the row is part of, or -1. */
  hunk: number;
  /** What a new note or highlight goes on: the selected text, a highlight's text, the change, or the paragraph. */
  what: 'selection' | 'highlight' | 'change' | 'paragraph';
  /** The selected or highlighted words, or the start of the paragraph. */
  quote: string;
  notes: CardNote[];
  reactions: Reaction[];
  /** Highlight colours on what a highlight would go on. */
  highlights: HighlightColor[];
  /** Opened to write a note. */
  writing: boolean;
  /** The decision on the change, if any. */
  decision?: Decision;
}

export interface ReviewCardProps {
  ctx: ReviewContext;
  onReact(r: Reaction): void;
  onDecide(status: Decision): void;
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
export function ReviewCard({ ctx, onReact, onDecide, onHighlight, onAddNote, onEditNote, onDelete }: ReviewCardProps) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState('');
  const where = SIDE_NAME[ctx.side];
  const title =
    ctx.what === 'selection' ? `Selected text in ${where}` : ctx.what === 'highlight' ? `Highlighted text in ${where}` : ctx.hunk >= 0 ? `Change ${ctx.hunk + 1}` : `Paragraph in ${where}`;
  const noteOn = ctx.what === 'selection' ? 'the selected text' : ctx.what === 'highlight' ? 'the highlighted text' : ctx.what === 'change' ? 'this change' : 'this paragraph';
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
          <DecisionButtons decision={ctx.decision} onDecide={onDecide} />
        </div>
      )}

      {ctx.quote && (
        <div className="rc-section">
          <span className="rc-label">{ctx.what === 'highlight' ? 'Highlight colour' : ctx.what === 'selection' ? 'Highlight the selection' : 'Highlight the paragraph'}</span>
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
                      <span className="rc-when">
                        {n.author && <b className="rc-author">{n.author}</b>}
                        {n.updated ? `edited ${when(n.updated)}` : when(n.created)}
                      </span>
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

export interface MarkMenuProps {
  /** A highlight's or a note's words, or selected text. */
  kind: 'highlight' | 'note' | 'selection';
  side: Side;
  /** The words it is on. */
  quote: string;
  /** A highlight's colour. */
  color?: HighlightColor;
  onColor(color: HighlightColor): void;
  /** Opens its card from the margin (a highlight or a note). */
  onOpen?(): void;
  /** Opens its card to write a note on its words. */
  onNote(): void;
  onCopy(): void;
  /** Removes the highlight or the note. */
  onRemove?(): void;
}

/** What can be done with a highlight, a note or selected text, from a right-click on the words. */
export function MarkMenu({ kind, side, quote, color, onColor, onOpen, onNote, onCopy, onRemove }: MarkMenuProps) {
  const name = kind === 'highlight' ? 'Highlight' : kind === 'note' ? 'Note' : 'Selected text';
  const mark = kind !== 'selection';
  return (
    <div className="menu mark-menu" role="menu" aria-label={`${name} in ${SIDE_NAME[side]}`} id="mark-menu">
      <div className="mm-head">
        <span className="menu-title">{`${name} in ${SIDE_NAME[side]}`}</span>
        <span className="mm-quote">“{excerpt(quote, 60)}”</span>
      </div>
      {kind !== 'note' && (
        <div className="rc-swatches mm-swatches" role="group" aria-label={kind === 'selection' ? 'Highlight the selection' : 'Highlight colour'}>
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`rc-swatch ${c}`}
              data-color={c}
              aria-label={`${COLOR_NAME[c]} highlight`}
              aria-pressed={color === c}
              data-tip={COLOR_NAME[c]}
              onClick={() => onColor(c)}
            />
          ))}
        </div>
      )}
      {mark && (
        <button type="button" className="mi" role="menuitem" data-mark="open" data-autofocus onClick={onOpen}>
          <Ico name="review" />
          <span>{kind === 'note' ? 'Open the note' : 'Open in the margin'}</span>
        </button>
      )}
      {kind !== 'note' && (
        <button type="button" className="mi" role="menuitem" data-mark="note" data-autofocus={!mark || undefined} onClick={onNote}>
          <Ico name="note" />
          <span>Add a note…</span>
        </button>
      )}
      <button type="button" className="mi" role="menuitem" data-mark="copy" onClick={onCopy}>
        <Ico name="copy" />
        <span>Copy the text</span>
      </button>
      {mark && (
        <>
          <div className="menu-sep" />
          <button type="button" className="mi danger" role="menuitem" data-mark="remove" onClick={onRemove}>
            <Ico name="trash" />
            <span>{kind === 'note' ? 'Delete the note' : 'Remove the highlight'}</span>
          </button>
        </>
      )}
    </div>
  );
}

/** Accept and reject, for a change. */
function DecisionButtons({ decision, onDecide }: { decision?: Decision; onDecide(status: Decision): void }) {
  return (
    <div className="rc-reactions rc-decide" role="group" aria-label="Decision">
      <button type="button" className="rc-react up" data-decide="accepted" aria-pressed={decision === 'accepted'} onClick={() => onDecide('accepted')}>
        <Ico name="check" />
        <span>Accept</span>
      </button>
      <button type="button" className="rc-react down" data-decide="rejected" aria-pressed={decision === 'rejected'} onClick={() => onDecide('rejected')}>
        <Ico name="close" />
        <span>Reject</span>
      </button>
    </div>
  );
}

export interface ChangeMenuProps {
  side: Side;
  hunk: number;
  decision?: Decision;
  onDecide(status: Decision): void;
  /** For a moved paragraph: going to its other place. */
  moved?: { label: string; go(): void };
  /** With more than two versions: the paragraph through all of them. */
  onHistory?(): void;
  /** The change has pictures that differ: comparing them. */
  onPictures?(): void;
  /** The changed words on this side (none where the words are only in the other document). */
  quote: string;
  reactions: Reaction[];
  /** Highlight colours on the changed words. */
  highlights: HighlightColor[];
  /** Copying the words across, where it can be done. */
  apply: boolean;
  /** About a whole paragraph (added, removed or changed) rather than some words in it. */
  whole: boolean;
  onReact(r: Reaction): void;
  onColor(color: HighlightColor): void;
  onClearHighlight(): void;
  /** Opens the change's card in the margin, to write a note when `writing`. */
  onOpen(writing: boolean): void;
  onCopy(): void;
  onApply(dir: 'l2r' | 'r2l'): void;
}

/** Everything that can be done with a change, from a right-click on it: some changed words, or a whole paragraph. */
export function ChangeMenu({ side, hunk, decision, onDecide, moved, onHistory, onPictures, quote, reactions, highlights, apply, whole, onReact, onColor, onClearHighlight, onOpen, onCopy, onApply }: ChangeMenuProps) {
  return (
    <div className="menu mark-menu" role="menu" aria-label={`Change ${hunk + 1} in ${SIDE_NAME[side]}`} id="change-menu">
      <div className="mm-head">
        <span className="menu-title">{`Change ${hunk + 1} in ${SIDE_NAME[side]}`}</span>
        {quote && <span className="mm-quote">“{excerpt(quote, 60)}”</span>}
      </div>
      <div className="mm-swatches">
        <DecisionButtons decision={decision} onDecide={onDecide} />
      </div>
      <div className="rc-reactions mm-swatches" role="group" aria-label="Mark the change">
        {REACTIONS.map((r) => (
          <button key={r} type="button" className={`rc-react ${r}`} data-react={r} aria-pressed={reactions.includes(r)} aria-label={REACTION_NAME[r]} data-tip={REACTION_NAME[r]} onClick={() => onReact(r)}>
            <Ico name={REACTION_ICON[r]} />
          </button>
        ))}
      </div>
      {quote && (
        <div className="rc-swatches mm-swatches" role="group" aria-label={whole ? 'Highlight the paragraph' : 'Highlight the changed words'}>
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`rc-swatch ${c}`}
              data-color={c}
              aria-label={`${COLOR_NAME[c]} highlight`}
              aria-pressed={highlights.includes(c)}
              data-tip={COLOR_NAME[c]}
              onClick={() => onColor(c)}
            />
          ))}
        </div>
      )}
      {moved && (
        <button type="button" className="mi" role="menuitem" data-mark="moved" onClick={moved.go}>
          <Ico name="arrow" />
          <span>{moved.label}</span>
        </button>
      )}
      <button type="button" className="mi" role="menuitem" data-mark="note" data-autofocus onClick={() => onOpen(true)}>
        <Ico name="note" />
        <span>Add a note on the change…</span>
      </button>
      {onPictures && (
        <button type="button" className="mi" role="menuitem" data-mark="pictures" onClick={onPictures}>
          <Ico name="sideBySide" />
          <span>Compare the pictures…</span>
        </button>
      )}
      {onHistory && (
        <button type="button" className="mi" role="menuitem" data-mark="history" onClick={onHistory}>
          <Ico name="undo" />
          <span>History across the versions…</span>
        </button>
      )}
      <button type="button" className="mi" role="menuitem" data-mark="open" onClick={() => onOpen(false)}>
        <Ico name="review" />
        <span>Open in the margin</span>
      </button>
      {quote && (
        <button type="button" className="mi" role="menuitem" data-mark="copy" onClick={onCopy}>
          <Ico name="copy" />
          <span>Copy the text</span>
        </button>
      )}
      {apply && (
        <>
          <div className="menu-sep" />
          <button type="button" className="mi" role="menuitem" data-inline="l2r" onClick={() => onApply('l2r')}>
            <Ico name="toB" />
            <span>{whole ? 'Use A’s version in B' : 'Use A’s wording in B'}</span>
          </button>
          <button type="button" className="mi" role="menuitem" data-inline="r2l" onClick={() => onApply('r2l')}>
            <Ico name="toA" />
            <span>{whole ? 'Use B’s version in A' : 'Use B’s wording in A'}</span>
          </button>
        </>
      )}
      {highlights.length > 0 && (
        <>
          <div className="menu-sep" />
          <button type="button" className="mi danger" role="menuitem" data-mark="remove" onClick={onClearHighlight}>
            <Ico name="trash" />
            <span>Remove the highlight</span>
          </button>
        </>
      )}
    </div>
  );
}
