/**
 * The keyboard shortcuts (the help dialog lists them): the documents', and
 * for pictures and recordings, their tools' own.
 */
import type { RefObject } from 'react';
import { useEffect } from 'react';
import type { Comparison } from '../../core/compare';
import type { MediaKind } from '../../media/kinds';
import { audioKey } from '../audio/audio-tools';
import type { DialogState } from '../dialogs';
import { useStable } from '../hooks';
import { imageKey } from '../image/image-tools';
import type { View } from '../util';
import { isTyping } from '../util';
import type { Editing } from './use-editing';
import type { MediaCompare } from './use-media';
import type { Navigation } from './use-navigation';
import type { Pop } from './pop';
import type { Prefs, SetPref } from './prefs';
import type { Review } from './use-review';

interface KeyboardDeps {
  kind: MediaKind;
  cmp: Comparison | null;
  prefs: Prefs;
  setPref: SetPref;
  view: View;
  pop: Pop | null;
  setPop(pop: Pop | null): void;
  dialog: DialogState | null;
  openDialog(dialog: DialogState): void;
  root: RefObject<HTMLDivElement | null>;
  navigation: Pick<Navigation, 'scroller' | 'page' | 'step' | 'toggleChangesOnly' | 'setView' | 'toggleBands' | 'toggleSidebar'>;
  editing: Pick<Editing, 'undo' | 'redo' | 'applyCurrent'>;
  review: Pick<Review, 'decideCurrent'>;
  media: Pick<MediaCompare, 'imageCtl' | 'audioCtl'>;
}

export function useKeyboard({ kind, cmp, prefs, setPref, view, pop, setPop, dialog, openDialog, root, navigation, editing, review, media }: KeyboardDeps): void {
  const onKey = useStable((e: KeyboardEvent) => {
    const { scroller, page, step, toggleChangesOnly, setView, toggleBands, toggleSidebar } = navigation;
    const { undo, redo, applyCurrent } = editing;
    if (e.key === 'Escape' && pop) {
      setPop(null);
      return;
    }
    if (dialog || isTyping(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod && !e.altKey && (k === 'z' || k === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && (k === 'y' || k === 'Y')) {
      e.preventDefault();
      redo();
      return;
    }
    if (mod) return;
    if ((k === 'PageDown' || k === 'PageUp') && !e.altKey && !e.shiftKey) {
      // Inside the documents or the list of changes, the key scrolls that; anywhere else it pages the documents.
      const t = e.target as Node;
      if (!scroller.current?.contains(t) && !root.current?.querySelector('#changes')?.contains(t)) {
        e.preventDefault();
        page(k === 'PageDown' ? 1 : -1);
      }
      return;
    }
    if (e.altKey && (k === 'ArrowRight' || k === 'ArrowLeft')) {
      e.preventDefault();
      applyCurrent(k === 'ArrowRight' ? 'l2r' : 'r2l');
      return;
    }
    if (e.altKey) return;
    // Pictures and recordings have their own keys; the text ones don't apply.
    if (kind === 'image' || kind === 'audio') {
      // A dialog of the tools' own (asking before sending recordings away) has the keys.
      if (document.querySelector('dialog[open]')) return;
      // Space on a focused button or slider is that control's; elsewhere it plays and pauses.
      if (k === ' ' && (e.target as Element | null)?.closest?.('button, input, [role="slider"], a')) return;
      if (k === '?') openDialog({ type: 'help' });
      else if (k === 's' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        toggleSidebar();
      } else if (kind === 'image' ? imageKey(media.imageCtl, e) : audioKey(media.audioCtl, e)) e.preventDefault();
      return;
    }
    switch (k) {
      case 'n':
      case 'j':
        e.preventDefault();
        step(1);
        break;
      case 'p':
      case 'k':
        e.preventDefault();
        step(-1);
        break;
      case '>':
        applyCurrent('l2r');
        break;
      case '<':
        applyCurrent('r2l');
        break;
      case 'c':
        toggleChangesOnly();
        break;
      case 'a':
        review.decideCurrent('accepted');
        break;
      case 'x':
        review.decideCurrent('rejected');
        break;
      case 'm':
        if (cmp) setPref({ minimap: !prefs.minimap });
        break;
      case 'l':
        if (cmp) setPref({ lines: !prefs.lines });
        break;
      case 'v':
        if (cmp) setView(view === 'split' ? 'unified' : 'split');
        break;
      case 'b':
        toggleBands();
        break;
      case 's':
        toggleSidebar();
        break;
      case 'r':
        if (cmp) setPref({ review: !prefs.review });
        break;
      case 'g':
        if (cmp) setPref({ check: !prefs.check });
        break;
      case '?':
        openDialog({ type: 'help' });
        break;
    }
  });
  useEffect(() => {
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onKey]);
}
