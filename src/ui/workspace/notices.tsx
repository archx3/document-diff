import { kindOf } from '../../media/kinds';
import type { MediaKind } from '../../media/kinds';
import type { Docs } from '../history';
import type { Notice } from '../notices';

/** What the notices over the documents say: that they are the samples, how a picture or recording beside a document is compared, and what the files themselves note. */
export function workspaceNotices(docs: Docs, kind: MediaKind, onStartOver: () => void): Notice[] {
  const { a, b } = docs;
  const notes: Notice[] = [];
  if (docs.sample && a && b)
    notes.push({
      key: 'sample',
      content: (
        <>
          <span>
            <b>Sample drafts.</b> Replace A and B with your own documents, or drop two files anywhere on the page.
          </span>
          <button type="button" className="btn sm" data-cmd="clear" onClick={onStartOver}>
            Use my own documents
          </button>
        </>
      ),
    });
  // A picture or recording beside a document is compared as text: say so, and how to compare the media itself.
  if (a && b && kind === 'text' && (kindOf(a) !== 'text' || kindOf(b) !== 'text')) {
    const media = kindOf(a) !== 'text' ? a : b;
    const what = kindOf(media) === 'image' ? 'picture' : 'recording';
    notes.push({
      key: `mixed:${a.id}:${b.id}`,
      content: (
        <span>
          <b>{media === a ? 'A' : 'B'} is a {what}</b> and the other a document, so they are compared as text. Replace the document with another {what} to compare the{' '}
          {what === 'picture' ? 'pictures' : 'sound'}.
        </span>
      ),
    });
  }
  // Notes that apply to both documents are shown once.
  const notesA = a?.notes ?? [];
  const notesB = b?.notes ?? [];
  for (const note of new Set([...notesA, ...notesB])) {
    const who = notesA.includes(note) && notesB.includes(note) ? 'A and B' : notesA.includes(note) ? 'A' : 'B';
    notes.push({
      key: `note:${note}`,
      content: (
        <span>
          <b>{who}:</b> {note}
        </span>
      ),
    });
  }
  return notes;
}
