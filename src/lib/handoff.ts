import type { Doc } from '../core/model';
import type { MediaKind } from '../media/kinds';

/**
 * Carries what the reader picked from one page to the next: the file dropped
 * on the landing page, then the two documents to compare. It lives in memory,
 * so it survives moving between pages in the app but not a reload; each page
 * then starts over.
 */

let files: File[] = [];
let kind: MediaKind | null = null;
let docs: { a: Doc; b: Doc } | null = null;

/** Files chosen on the landing page (and what kind of thing they are), for the page that asks for the other version. */
export function handOffFiles(chosen: File[], chosenKind?: MediaKind): void {
  files = chosen.slice(0, 2);
  kind = chosenKind ?? null;
}

/** The kind chosen with the files handed over, if one was. */
export function takeKind(): MediaKind | null {
  const out = kind;
  kind = null;
  return out;
}

export function takeFiles(): File[] {
  const out = files;
  files = [];
  return out;
}

/** Two documents, read and ready for the comparison workspace. */
export function handOffDocs(a: Doc, b: Doc): void {
  docs = { a, b };
}

export function takeDocs(): { a: Doc; b: Doc } | null {
  const out = docs;
  docs = null;
  return out;
}
