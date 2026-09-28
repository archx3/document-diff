/**
 * Replacing words in one paragraph (a spelling or grammar fix), through the
 * same format backends that copy changes between documents: the new words
 * take the formatting of the text they replace, and a Word or OpenDocument
 * file keeps its own XML for everything else.
 */
import type { MergeBackend, SplicePiece } from '../core/merge';
import type { Doc, ParaBlock, Span } from '../core/model';

/**
 * The document with characters [start, end) of a top-level paragraph's text
 * (objects count as one character) replaced by `text`, or null when the
 * paragraph is not one of the document's own (a paragraph inside a table).
 */
export function replaceInParagraph(doc: Doc, block: ParaBlock, start: number, end: number, text: string, backend: MergeBackend): Doc | null {
  const idx = doc.blocks.indexOf(block);
  if (idx < 0 || end < start) return null;
  const spans = block.spans;
  const len = (s: Span) => (s.marker ? 0 : s.obj ? 1 : s.text.length);

  // The words take the formatting of the text where they go.
  let fmtSpan: Span | undefined;
  let pos = 0;
  for (const s of spans) {
    const b = pos + len(s);
    if (!s.marker && !s.obj && (pos <= start || !fmtSpan)) fmtSpan = s;
    if (b > start && !s.marker && !s.obj) break;
    pos = b;
  }
  const extra = spans.length;
  const pieces: SplicePiece[] = [];
  let inserted = false;
  const insert = () => {
    if (inserted) return;
    inserted = true;
    if (text) pieces.push({ from: 't', span: extra, start: 0, end: text.length });
  };
  pos = 0;
  spans.forEach((s, k) => {
    const a = pos;
    const b = pos + len(s);
    pos = b;
    if (s.marker) {
      pieces.push({ from: 't', span: k, start: 0, end: 0 });
      return;
    }
    if (s.obj) {
      if (b <= start) pieces.push({ from: 't', span: k, start: 0, end: 1 });
      else {
        insert();
        // An object inside the replaced words goes with them.
        if (a >= end) pieces.push({ from: 't', span: k, start: 0, end: 1 });
      }
      return;
    }
    if (a < start) pieces.push({ from: 't', span: k, start: 0, end: Math.min(b, start) - a });
    if (start <= b && b > a && start >= a) insert();
    if (b > end) pieces.push({ from: 't', span: k, start: Math.max(a, end) - a, end: b - a });
  });
  insert();
  const base: Span = fmtSpan ?? { text: '', fmt: {} };
  const target: ParaBlock = { ...block, spans: [...spans, { ...base, text, obj: undefined, marker: undefined }] };
  const replaced = backend.splice(target, { ...block, spans: [] }, pieces, {
    source: doc,
    target: doc,
    replacing: block,
    prev: doc.blocks[idx - 1],
    next: doc.blocks[idx + 1],
  });
  return { ...doc, blocks: doc.blocks.map((b, i) => (i === idx ? replaced : b)), version: doc.version + 1 };
}
