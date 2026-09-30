/**
 * Keeping the comparison across reloads (session.ts writes it to this
 * browser): the documents, where the reader was, and what goes with them;
 * and, after a reload, back where the reader was.
 */
import type { RefObject } from 'react';
import { useEffect } from 'react';
import type { Docs } from '../history';
import { useInstance } from '../hooks';
import type { Restored, SavedExtra, SessionScope } from '../session';
import { SessionWriter } from '../session';
import type { ToastFn } from '../toasts';

interface SessionDeps {
  /** The name the comparison is kept under (none: it isn't kept). */
  scope: SessionScope | undefined;
  /** The comparison as it was before the page was reloaded. */
  restored: Restored | null | undefined;
  docs: Docs;
  /** The current change, and the documents' scroller: where the reader is. */
  cur: number;
  scroller: RefObject<HTMLDivElement | null>;
  /** What goes with the documents (the review, notes, findings and transcripts); written when it changes. */
  extra: SavedExtra;
  toast: ToastFn;
}

export function useSession({ scope, restored, docs, cur, scroller, extra, toast }: SessionDeps): { saveView(): void } {
  const writer = useInstance(SessionWriter, () => new SessionWriter(scope));
  const saveView = () => writer.view({ current: cur, scrollTop: scroller.current?.scrollTop ?? 0 });
  useEffect(() => writer.docs(docs), [writer, docs]);
  useEffect(() => writer.extra(extra), [writer, extra]);
  useEffect(saveView, [cur]);
  useEffect(() => {
    // A reload or a closed tab writes what is still waiting.
    const flush = () => void writer.flush();
    const hidden = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [writer]);
  // Back where the reader was before the reload.
  useEffect(() => {
    if (!restored) return;
    const top = restored.view?.scrollTop ?? 0;
    if (top > 0) requestAnimationFrame(() => scroller.current?.scrollTo({ top }));
    if (restored.lost.length) toast(`${restored.lost.join(' and ')} could not be opened again. Load ${restored.lost.length > 1 ? 'them' : 'it'} again to carry on.`, { error: true });
    // Once, for the comparison the page opened with.
  }, []);
  return { saveView };
}
