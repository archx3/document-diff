/**
 * The pictures of a change, paired up for comparing: the first picture of
 * A's side of the change with the first of B's, and so on.
 */
import type { Comparison, Row } from '../core/compare';
import type { Block, InlineObject } from '../core/model';
import type { ImageSide } from './image/use-image-compare';

/** The pictures in a block that can be shown, in order. */
export function blockPictures(b: Block | undefined): InlineObject[] {
  if (!b) return [];
  switch (b.type) {
    case 'p':
      return b.spans.flatMap((s) => (s.obj?.kind === 'image' && s.obj.src ? [s.obj] : []));
    case 'table':
      return b.rows.flatMap((r) => r.cells.flatMap((c) => c.blocks.flatMap(blockPictures)));
    case 'opaque':
      return b.blocks.flatMap(blockPictures);
    case 'marker':
      return [];
  }
}

export interface PicturePair {
  a: InlineObject;
  b: InlineObject;
}

const side = (o: InlineObject, name: string): ImageSide => ({ src: o.src!, name: o.label && !/^(picture|image)\b/i.test(o.label) ? o.label : name });
export const pictureSides = (p: PicturePair, aName: string, bName: string): [ImageSide, ImageSide] => [side(p.a, aName), side(p.b, bName)];

/** The pictures that differ between the sides of some rows, paired in order. */
export function changedPictures(rows: readonly Row[]): PicturePair[] {
  const a = rows.flatMap((r) => blockPictures(r.l));
  const b = rows.flatMap((r) => blockPictures(r.r));
  const out: PicturePair[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i]!.key !== b[i]!.key) out.push({ a: a[i]!, b: b[i]! });
  return out;
}

/** The changed pictures of a change. */
export function hunkPictures(cmp: Comparison, hunk: number): PicturePair[] {
  const h = cmp.hunks[hunk];
  return h ? changedPictures(cmp.rows.slice(h.start, h.end)) : [];
}

/** The pair for a picture clicked in one side of a row: the one at the same place on the other side. */
export function pairFor(row: Row, clickedSide: 'a' | 'b', index: number): PicturePair | null {
  const a = blockPictures(row.l);
  const b = blockPictures(row.r);
  const mine = clickedSide === 'a' ? a : b;
  const theirs = clickedSide === 'a' ? b : a;
  const x = mine[index];
  const y = theirs[Math.min(index, theirs.length - 1)];
  if (!x || !y) return null;
  return clickedSide === 'a' ? { a: x, b: y } : { a: y, b: x };
}
