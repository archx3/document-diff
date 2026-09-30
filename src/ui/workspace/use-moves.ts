import type { RefObject } from 'react';
import { useLayoutEffect } from 'react';
import type { Comparison } from '../../core/compare';
import { movesByRow } from '../../core/moves';

/** Moved paragraphs say where they went, or came from (shown by the stylesheet), after every update of the grid. */
export function useMoveLabels(grid: RefObject<HTMLDivElement | null>, cmp: Comparison | null): void {
  useLayoutEffect(() => {
    const moved = cmp ? movesByRow(cmp) : new Map();
    for (const el of Array.from(grid.current?.querySelectorAll<HTMLElement>('.row[data-moved]') ?? [])) {
      if (moved.has(el.dataset.key!)) continue;
      delete el.dataset.moved;
      for (const c of Array.from(el.querySelectorAll<HTMLElement>('.cell[data-moved-label]'))) delete c.dataset.movedLabel;
    }
    for (const [key, mv] of moved) {
      const from = mv.from === key;
      for (const el of Array.from(grid.current?.querySelectorAll<HTMLElement>(`.row[data-key="${CSS.escape(key)}"]`) ?? [])) {
        el.dataset.moved = from ? 'a' : 'b';
        const cell = el.querySelector<HTMLElement>(`:scope > .cell.${from ? 'a' : 'b'}`);
        if (cell) cell.dataset.movedLabel = `${from ? 'Moved to' : 'Moved here from'} change ${(from ? mv.toHunk : mv.fromHunk) + 1}${mv.exact ? '' : ', with changes'}`;
      }
    }
  });
}
