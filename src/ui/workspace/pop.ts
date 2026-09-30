/**
 * The menu or card open over the workspace (one at a time), what it was
 * opened for, and the button or words it opens from.
 */
import { useCallback, useState } from 'react';
import type { TextTarget } from '../../review/anchor';
import type { SelectionTarget } from '../../review/dom';
import type { DocMenu } from '../heads';
import type { Side } from '../util';

/** An open menu, and the button (or word) it belongs to. */
export type Pop =
  | { type: 'load' | 'export'; side: Side; anchor: HTMLElement }
  | { type: 'options' | 'copy' | 'redline' | 'report' | 'share'; anchor: HTMLElement }
  | { type: 'inline'; anchor: HTMLElement; rowKey: string; change: number }
  /**
   * The marks on one side of a row, from its margin; `selection` is the selected text it was opened for,
   * and `mark` the highlight clicked to open it.
   */
  | { type: 'review'; anchor: HTMLElement; rowKey: string; side: Side; selection: TextTarget | null; writing: boolean; mark?: string }
  /** What can be done with a highlight or a note, from a right-click on its words. */
  | { type: 'mark'; anchor: HTMLElement; id: string }
  /** What can be done with selected text, from a right-click on it. */
  | { type: 'select'; anchor: HTMLElement; sel: SelectionTarget }
  /**
   * Everything that can be done with a change, from a right-click on it: a word-level change (`change`), or with
   * `change` -1 a whole changed paragraph; `target` is its words on `side`.
   */
  | { type: 'change'; anchor: HTMLElement; rowKey: string; side: Side; change: number; target: TextTarget | null }
  | { type: 'check'; anchor: HTMLElement }
  /** A spelling or grammar finding, from a click on its words; `anchor` marks the words on the screen. */
  | { type: 'issue'; anchor: HTMLElement; key: string; suggestions: string[] };

export type ReviewPop = Extract<Pop, { type: 'review' }>;

/** The open menu, and ways to open one (from the button of the one open, it closes instead) and to close it. */
export function usePop() {
  const [pop, setPop] = useState<Pop | null>(null);
  const openPop = (next: Pop) => setPop((p) => (p?.anchor === next.anchor ? null : next));
  const closePop = useCallback(() => setPop(null), []);
  const openDocMenu = (menu: DocMenu, side: Side, anchor: HTMLElement) => openPop({ type: menu, side, anchor });
  return { pop, setPop, openPop, closePop, openDocMenu };
}

/** A small box over some words on the screen, for a card to open from. */
export function floatingAnchor(root: HTMLElement | null, rect: DOMRect): HTMLElement {
  for (const old of Array.from(document.querySelectorAll('.float-anchor'))) old.remove();
  const el = document.createElement('span');
  el.className = 'float-anchor';
  el.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;pointer-events:none`;
  root?.appendChild(el);
  return el;
}
