/**
 * The documents being compared: the sample drafts, a side replaced, whether a
 * document has anything to compare, the backend that edits one, and the
 * words of a word-level change.
 */
import type { Comparison } from '../../core/compare';
import { inlineDiff } from '../../core/compare';
import { fullRange } from '../../core/inline';
import type { Doc } from '../../core/model';
import { isBlank } from '../../core/model';
import { modelBackend } from '../../core/model-backend';
import type { CompareOptions } from '../../core/tokens';
import { docxBackend } from '../../formats/docx/backend';
import { DocxPackage } from '../../formats/docx/package';
import { readHtml } from '../../formats/html/read';
import { odtBackend } from '../../formats/odt/backend';
import { OdtPackage } from '../../formats/odt/package';
import { SAMPLE_A, SAMPLE_A_NAME, SAMPLE_B, SAMPLE_B_NAME } from '../../samples/sample';
import type { Docs } from '../history';
import type { Side } from '../util';

export function sampleDocs(): Docs {
  return {
    a: { ...readHtml(SAMPLE_A, SAMPLE_A_NAME), kind: 'sample' },
    b: { ...readHtml(SAMPLE_B, SAMPLE_B_NAME), kind: 'sample' },
    edits: { a: 0, b: 0 },
    sample: true,
  };
}

/** The format backend that edits a document: in place for Word and OpenDocument files. */
export function backendFor(doc: Doc) {
  return doc.pkg instanceof DocxPackage ? docxBackend : doc.pkg instanceof OdtPackage ? odtBackend : modelBackend;
}

export function withDoc(docs: Docs, side: Side, doc: Doc | null, edits: number): Docs {
  return side === 'a' ? { ...docs, a: doc, edits: { ...docs.edits, a: edits } } : { ...docs, b: doc, edits: { ...docs.edits, b: edits } };
}

/** Whether a document has any text to compare. */
export function hasText(doc: Doc): boolean {
  return doc.blocks.some((x) => x.type !== 'marker' && !isBlank(x));
}

/** The words on each side of a word-level change, for its menu (null when the row has no such change). */
export function inlineWords(cmp: Comparison | null, opts: CompareOptions, rowKey: string, change: number) {
  const row = cmp?.rows.find((r) => r.key === rowKey);
  if (!row || row.l?.type !== 'p' || row.r?.type !== 'p') return null;
  const d = inlineDiff(row.l, row.r, opts);
  const ch = d.changes[change];
  if (!ch) return null;
  const words = (t: typeof d.a, c0: number, c1: number) => {
    const [f0, f1] = fullRange(t, c0, c1);
    return t.tokens
      .slice(f0, f1)
      .map((x) => x.text)
      .join('')
      .trim();
  };
  return { a: words(d.a, ch.a0, ch.a1), b: words(d.b, ch.b0, ch.b1), fmtOnly: ch.fmtOnly };
}
