import type { Doc } from '../core/model';
import type { CompareOptions } from '../core/tokens';

export type Side = 'a' | 'b';

/** The documents side by side, or in one column with A above B where they differ. */
export type View = 'split' | 'unified';

export const SIDE_NAME: Record<Side, string> = { a: 'A', b: 'B' };

export const other = (s: Side): Side => (s === 'a' ? 'b' : 'a');

/** Short name of a document's format, for its badge. */
export function kindLabel(doc: Doc): string {
  if (doc.formatLabel) return doc.formatLabel;
  switch (doc.kind) {
    case 'docx':
      return 'Word';
    case 'odt':
      return 'OpenDocument';
    case 'rtf':
      return 'RTF';
    case 'doc':
      return 'Word 97';
    case 'epub':
      return 'EPUB';
    case 'pdf':
      return 'PDF';
    case 'html':
      return /^Pasted/.test(doc.name) ? 'Pasted' : 'HTML';
    case 'markdown':
      return 'Markdown';
    case 'text':
      return /^Pasted/.test(doc.name) ? 'Pasted' : 'Text';
    case 'csv':
      return 'CSV';
    case 'sample':
      return 'Sample';
  }
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** "a", "a and b", "a, b and c". */
export function listText(items: string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** A document's name without its extension, for the files saved from it. */
export function baseName(doc: Doc): string {
  return doc.name.replace(/\.[a-z0-9]{1,8}$/i, '').trim() || 'document';
}

export function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** The event comes from a text field, where keys type rather than act. */
export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}

/** Words for documents with no differences, naming what the options leave out. */
export function sameText(o: CompareOptions): string {
  const ignored = [
    o.ignoreFormatting && 'formatting',
    o.ignoreCase && 'letter case',
    o.ignoreWhitespace && 'extra spaces',
    o.normalizePunctuation && 'quote and dash styles',
  ].filter((x): x is string => !!x);
  return ignored.length ? `A and B match, ignoring ${listText(ignored)}` : 'A and B are identical';
}
