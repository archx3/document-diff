import type { Doc } from '../core/model';

/**
 * The files documents were read from, while they are as read. A reloaded
 * workspace reads an unedited document from its file again (see ui/session.ts).
 */
const sources = new WeakMap<Doc, Blob & { name: string }>();

/** Remembers the file a document was read from. */
export function noteSource(doc: Doc, file: Blob & { name: string }): void {
  sources.set(doc, file);
}

/** The file a document was read from, if it is still as read. */
export function sourceOf(doc: Doc): (Blob & { name: string }) | undefined {
  return sources.get(doc);
}
