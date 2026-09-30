/**
 * More than two versions of one document: drafts in order, any two of them
 * compared, and one paragraph followed from draft to draft.
 */
import type { Comparison } from './compare';
import { compareDocs } from './compare';
import type { Block, Doc } from './model';
import type { CompareOptions } from './tokens';
import { optionsKey } from './tokens';

/** Drafts in the order their names give (v2 before v10), the way they are usually named. */
export function orderVersions<T extends { name: string }>(docs: readonly T[]): T[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...docs].sort((x, y) => collator.compare(x.name, y.name));
}

const pairs = new WeakMap<Doc, WeakMap<Doc, { key: string; cmp: Comparison }>>();

/** The comparison of two versions, made once. */
export function comparePair(a: Doc, b: Doc, opts: CompareOptions): Comparison {
  const key = optionsKey(opts);
  let inner = pairs.get(a);
  if (!inner) pairs.set(a, (inner = new WeakMap()));
  const hit = inner.get(b);
  if (hit && hit.key === key) return hit.cmp;
  const cmp = compareDocs(a, b, opts);
  inner.set(b, { key, cmp });
  return cmp;
}

/** One version's part in a paragraph's history. */
export interface HistoryStep {
  version: number;
  /** The paragraph in this version (null where it is not there). */
  block: Block | null;
  /** It is the same as in the version before. */
  same: boolean;
}

/**
 * A paragraph through the versions: starting from `block` in version `at`,
 * where it came from in each earlier version and where it went in each later
 * one, by comparing each version with the next.
 */
export function paragraphHistory(versions: readonly Doc[], at: number, block: Block, opts: CompareOptions): HistoryStep[] {
  const found: Array<Block | null> = versions.map(() => null);
  found[at] = block;
  for (let i = at; i > 0 && found[i]; i--) {
    const row = comparePair(versions[i - 1]!, versions[i]!, opts).rows.find((r) => r.r === found[i]);
    found[i - 1] = row?.l ?? null;
  }
  for (let i = at; i < versions.length - 1 && found[i]; i++) {
    const row = comparePair(versions[i]!, versions[i + 1]!, opts).rows.find((r) => r.l === found[i]);
    found[i + 1] = row?.r ?? null;
  }
  return found.map((b, i) => {
    let same = false;
    if (b && i > 0 && found[i - 1]) {
      const row = comparePair(versions[i - 1]!, versions[i]!, opts).rows.find((r) => r.r === b);
      same = row?.kind === 'eq';
    }
    return { version: i, block: b, same };
  });
}
