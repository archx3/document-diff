/**
 * What kind of thing is being compared: text (documents), images or audio.
 * Everything that depends on it — which files a picker offers, which tools the
 * toolbar shows, what the column heads say, which view compares the two —
 * asks here, so a new kind is added in one place.
 */
import type { Doc } from '../core/model';

export type MediaKind = 'text' | 'image' | 'audio';
export const MEDIA_KINDS: readonly MediaKind[] = ['text', 'image', 'audio'];

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'webm'];

export interface MediaInfo {
  /** "Documents", "Images", "Audio": what a picker for them is called. */
  label: string;
  /** One of them: "a document", "an image", "an audio file". */
  one: string;
  /** The formats, for a hint under a picker. */
  formats: string;
}

export const MEDIA: Record<MediaKind, MediaInfo> = {
  text: { label: 'Documents', one: 'a document', formats: 'Word, Google Docs, PDF, OpenDocument, RTF, EPUB, HTML, Markdown, CSV or text' },
  image: { label: 'Images', one: 'an image', formats: 'PNG, JPEG, GIF, WebP, SVG or BMP' },
  audio: { label: 'Audio', one: 'an audio file', formats: 'MP3, WAV, M4A/AAC, Ogg/Opus, FLAC or WebM' },
};

/** The kind of a document. */
export function kindOf(doc: Doc | null | undefined): MediaKind {
  return doc?.kind === 'image' ? 'image' : doc?.kind === 'audio' ? 'audio' : 'text';
}

/**
 * How two documents are compared: two images as images, two audio files as
 * audio, and anything else as text (a picture or recording beside a document
 * shows as an object in its text).
 */
export function pairKind(a: Doc | null | undefined, b: Doc | null | undefined): MediaKind {
  const ka = kindOf(a);
  const kb = kindOf(b);
  if (!a || !b) return a ? ka : b ? kb : 'text';
  return ka === kb ? ka : 'text';
}

/** The kind of file a name is, by its extension (null when it doesn't say). */
export function kindOfName(name: string): MediaKind | null {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  if (!ext) return null;
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
  return 'text';
}
