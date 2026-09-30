/**
 * The pane beside two pictures: the notes on them. Clicking one zooms in on
 * its area and opens it.
 */
import { Ico } from '../../components/icons';
import { notesOf } from '../../review/media-notes';
import type { MediaNotesApi } from '../media-notes-ui';
import { NotesList } from '../media-notes-ui';
import type { ImageCompare } from './use-image-compare';

export function ImagePanel({ ctl, notes, onClose }: { ctl: ImageCompare; notes: MediaNotesApi; onClose(): void }) {
  const list = notesOf(notes.list, 'box');
  return (
    <aside className="changes media-changes" id="changes" aria-labelledby="changes-title">
      <div className="changes-head">
        <h2 id="changes-title">Notes {list.length > 0 && <span className="changes-count">{list.length.toLocaleString()}</span>}</h2>
        <button
          type="button"
          className={`btn sm${ctl.annotate ? ' primary' : ''}`}
          data-panel="annotate"
          aria-pressed={ctl.annotate}
          data-tip="Drag over an area of a picture, or click a point, to write a note on it (C)"
          onClick={() => ctl.setAnnotate(!ctl.annotate)}
        >
          <Ico name="note" />
          <span>{ctl.annotate ? 'Adding notes' : 'Add a note'}</span>
        </button>
        <button type="button" className="btn ghost icon-only" data-close-changes aria-label="Close the notes" data-tip="Close" onClick={onClose}>
          <Ico name="close" />
        </button>
      </div>
      <NotesList
        notes={list}
        api={notes}
        empty="No notes yet. Choose Add a note, then drag over an area of either picture, or click a point on it."
        onGo={(n) => {
          if (n.at.type === 'box') ctl.showBox(n.at);
          notes.setOpen(n.id);
        }}
      />
    </aside>
  );
}
