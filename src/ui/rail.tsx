import { memo } from 'react';
import type { IconName } from '../components/icons';
import { Ico } from '../components/icons';
import type { MarginInfo, Reaction } from '../review/marks';
import type { Side } from './util';
import { SIDE_NAME, plural } from './util';

export const REACTION_ICON: Record<Reaction, IconName> = { up: 'thumbUp', down: 'thumbDown', idea: 'bulb' };
export const REACTION_NAME: Record<Reaction, string> = { up: 'Looks right', down: 'Needs work', idea: 'Idea' };

/** What the margins do when their buttons are pressed. */
export interface RailActions {
  /** Opens the marks of one side of a row (and offers to add some). */
  open(anchor: HTMLElement, rowKey: string, side: Side): void;
  /** Highlights, or notes on, the text selected in one side of a row. */
  quick(what: 'highlight' | 'note', anchor: HTMLElement, rowKey: string, side: Side): void;
}

interface RailProps {
  side: Side;
  rowKey: string;
  info?: MarginInfo;
  /** Text in this side of the row is selected. */
  selected: boolean;
  actions: RailActions;
}

function describe(info: MarginInfo): string {
  const parts: string[] = [];
  if (info.reactions.length) parts.push(info.reactions.map((r) => REACTION_NAME[r]).join(', '));
  if (info.notes) parts.push(plural(info.notes, 'note'));
  if (info.highlights.length) parts.push(info.highlights.length > 1 ? 'highlights' : 'a highlight');
  return parts.join(', ');
}

/**
 * The margin outside one document, beside one row: the marks on it (open them
 * with a click), an add button while the row is pointed at, and while text is
 * selected there, buttons to highlight it or add a note on it.
 */
export const Rail = memo(function Rail({ side, rowKey, info, selected, actions }: RailProps) {
  const name = SIDE_NAME[side];
  if (selected) {
    return (
      <div className={`rail ${side} sel`} data-side={side}>
        <button
          type="button"
          className="rail-btn"
          data-rail="highlight"
          aria-label={`Highlight the selected text in ${name}`}
          data-tip="Highlight"
          // Pressing the button must not clear the selection it acts on.
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => actions.quick('highlight', e.currentTarget, rowKey, side)}
        >
          <Ico name="highlighter" />
        </button>
        <button
          type="button"
          className="rail-btn"
          data-rail="note"
          aria-label={`Add a note on the selected text in ${name}`}
          data-tip="Note"
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => actions.quick('note', e.currentTarget, rowKey, side)}
        >
          <Ico name="note" />
        </button>
      </div>
    );
  }
  if (info) {
    const label = describe(info);
    return (
      <div className={`rail ${side} has`} data-side={side}>
        <button type="button" className="rail-marks" data-rail="marks" aria-label={`Marks in ${name}: ${label}`} data-tip={label} onClick={(e) => actions.open(e.currentTarget, rowKey, side)}>
          {info.reactions.map((r) => (
            <span key={r} className={`rx ${r}`}>
              <Ico name={REACTION_ICON[r]} />
            </span>
          ))}
          {info.notes > 0 && (
            <span className="rn">
              <Ico name="note" />
              {info.notes > 1 && <b>{info.notes}</b>}
            </span>
          )}
          {!info.notes && !info.reactions.length && info.highlights.map((c) => <span key={c} className={`rh ${c}`} />)}
        </button>
      </div>
    );
  }
  return (
    <div className={`rail ${side}`} data-side={side}>
      <button type="button" className="rail-btn rail-add" data-rail="add" aria-label={`Add a note, highlight or reaction here in ${name}`} data-tip="Note, highlight or react" onClick={(e) => actions.open(e.currentTarget, rowKey, side)}>
        <Ico name="plus" />
      </button>
    </div>
  );
});

/** An empty margin, for the lines of a row after its first. */
export function RailSpace({ side }: { side: Side }) {
  return <div className={`rail ${side}`} aria-hidden="true" />;
}
