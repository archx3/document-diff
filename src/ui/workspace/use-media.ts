/**
 * Pictures and recordings: two of either are compared in a view of their own
 * (filling the workspace), with notes of their own; the recordings'
 * transcripts are kept with the comparison.
 */
import { useMemo, useState } from 'react';
import type { Doc } from '../../core/model';
import type { MediaKind } from '../../media/kinds';
import type { MediaNote } from '../../review/media-notes';
import { readMediaNotes, swapMediaNotes } from '../../review/media-notes';
import type { KeptTranscripts } from '../audio/use-audio-compare';
import { keptFor, readKeptTranscripts, useAudioCompare } from '../audio/use-audio-compare';
import { mediaObject } from '../facts';
import { useImageCompare } from '../image/use-image-compare';
import type { MediaNotesApi } from '../media-notes-ui';
import { blockPictures, pictureSides } from '../pictures';
import type { SavedExtra } from '../session';

interface MediaDeps {
  a: Doc | null;
  b: Doc | null;
  kind: MediaKind;
  /** What was kept with the comparison (before a reload). */
  saved: SavedExtra | undefined;
  /** The reader's name, for their notes. */
  author: string;
}

export type MediaCompare = ReturnType<typeof useMediaCompare>;

export function useMediaCompare({ a, b, kind, saved, author }: MediaDeps) {
  /** Notes on pictures and recordings (kept beside the marks on text). */
  const [notes, setNotes] = useState<MediaNote[]>(() => readMediaNotes(saved?.media));
  /** What was said in the recordings, kept with the session (a reload doesn't transcribe them again). */
  const [transcripts, setTranscripts] = useState<KeptTranscripts | null>(() => readKeptTranscripts(saved?.transcripts));
  const [openNote, setOpenNote] = useState<string | null>(null);

  /** Two picture files: compared as pictures, filling the workspace. */
  const bothPictures = useMemo(() => {
    if (a?.kind !== 'image' || b?.kind !== 'image') return null;
    const pa = blockPictures(a.blocks[0])[0];
    const pb = blockPictures(b.blocks[0])[0];
    return pa && pb ? pictureSides({ a: pa, b: pb }, a.name, b.name) : null;
  }, [a, b]);
  const imageSides = useMemo(() => (bothPictures ? { a: bothPictures[0], b: bothPictures[1] } : null), [bothPictures]);
  const imageCtl = useImageCompare(imageSides);
  /** Two recordings: compared as sound, filling the workspace. */
  const audioDocs = useMemo(() => (kind === 'audio' && a && b ? { a, b } : null), [kind, a, b]);
  const audioCtl = useAudioCompare(audioDocs, { kept: transcripts, setKept: setTranscripts });

  /** What the picture and recording views do with notes. */
  const notesApi = useMemo<MediaNotesApi>(
    () => ({
      list: notes,
      add: (n) => setNotes((ns) => [...ns, n]),
      update: (id, patch) => setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch, updated: Date.now() } : n))),
      remove: (id) => {
        setNotes((ns) => ns.filter((n) => n.id !== id));
        setOpenNote((o) => (o === id ? null : o));
      },
      author: author.trim() || undefined,
      open: openNote,
      setOpen: setOpenNote,
    }),
    [notes, openNote, author],
  );

  /** The recordings compared, by their content (none for documents): the transcripts kept are theirs. */
  const recordings = [a, b].map((d) => (d && mediaObject(d)?.key) ?? '').join(' ');
  const keptTranscripts = useMemo(() => keptFor(transcripts, recordings.split(' ')), [transcripts, recordings]);

  return {
    bothPictures,
    imageCtl,
    audioCtl,
    notes,
    notesApi,
    /** The transcripts of the recordings compared, to keep with the session. */
    transcripts: keptTranscripts,
    /** Forgets the notes (for new documents). */
    clearNotes: () => setNotes([]),
    /** Moves each note to the other side, as the documents are swapped. */
    swapNotes: () => setNotes((ns) => swapMediaNotes(ns)),
    /** The notes kept with the documents. */
    loadNotes: (extra: SavedExtra) => setNotes(readMediaNotes(extra.media)),
  };
}
