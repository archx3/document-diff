/**
 * A review file (.collate): the comparison to hand to someone else — both
 * documents (with the changes copied between them), any other versions, and
 * the review (notes, highlights, reactions, decisions, ignored findings,
 * Claude's suggestions). Optionally locked with a password (AES-GCM, with a
 * key from the password by PBKDF2), so it can be sent by email or chat.
 * Everything is made and read in the browser.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Doc } from '../core/model';
import type { Docs } from './history';
import type { SavedDoc, SavedExtra } from './session';
import { restoreDoc, snapshotDoc } from './session';

export const REVIEW_EXT = 'collate';
const FORMAT = 'collate-review';
const MAGIC = strToU8('COLLATE-LOCKED-1\n');
const ITERATIONS = 250_000;

export interface ReviewContent {
  docs: Docs;
  extra: SavedExtra;
  /** Drafts of the document, when there are more than two. */
  versions: Doc[];
}

interface Manifest {
  format: typeof FORMAT;
  version: 1;
  saved: string;
  reviewer?: string;
  edits: Docs['edits'];
  sample: boolean;
  a: EntryRef | null;
  b: EntryRef | null;
  versions: EntryRef[];
  extra: SavedExtra;
}

/** A document in the file: its own file (`path`), or the model as JSON. */
type EntryRef = { how: 'file'; path: string; name: string } | { how: 'model'; path: string };

/* -------------------------------------------------------------- bytes in JSON */

const B64 = '$bytes';

function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v instanceof Uint8Array) {
      let bin = '';
      for (let i = 0; i < v.length; i += 0x8000) bin += String.fromCharCode(...v.subarray(i, i + 0x8000));
      return { [B64]: btoa(bin) };
    }
    return v;
  });
}

function fromJson<T>(text: string): T {
  return JSON.parse(text, (_k, v) => (v && typeof v === 'object' && typeof v[B64] === 'string' ? Uint8Array.from(atob(v[B64]), (c) => c.charCodeAt(0)) : v)) as T;
}

/* ------------------------------------------------------------------ packing */

/** The comparison and its review as a .collate file (locked when a password is given). */
export async function packReview(content: ReviewContent, opts: { reviewer?: string; password?: string } = {}): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const saved = new Map<Doc, EntryRef>();
  let n = 0;
  const put = async (doc: Doc | null): Promise<EntryRef | null> => {
    if (!doc) return null;
    const hit = saved.get(doc);
    if (hit) return hit;
    const s: SavedDoc = snapshotDoc(doc);
    n++;
    let ref: EntryRef;
    if (s.how === 'file') {
      const path = `docs/${n}/${s.name.replace(/[\\/:*?"<>|]/g, '_') || 'document'}`;
      files[path] = new Uint8Array(await s.file.arrayBuffer());
      ref = { how: 'file', path, name: s.name };
    } else {
      const path = `docs/${n}.json`;
      files[path] = strToU8(toJson(s.doc));
      ref = { how: 'model', path };
    }
    saved.set(doc, ref);
    return ref;
  };
  const manifest: Manifest = {
    format: FORMAT,
    version: 1,
    saved: new Date().toISOString(),
    reviewer: opts.reviewer?.trim() || undefined,
    edits: content.docs.edits,
    sample: content.docs.sample,
    a: await put(content.docs.a),
    b: await put(content.docs.b),
    versions: [],
    extra: content.extra,
  };
  for (const v of content.versions) manifest.versions.push((await put(v))!);
  files['manifest.json'] = strToU8(toJson(manifest));
  const zip = zipSync(files, { level: 6 });
  return opts.password ? lock(zip, opts.password) : zip;
}

/** Whether a review file is locked with a password. */
export function isLocked(bytes: Uint8Array): boolean {
  return bytes.length > MAGIC.length && MAGIC.every((b, i) => bytes[i] === b);
}

export class WrongPassword extends Error {
  constructor() {
    super('That password does not open this review file.');
  }
}

/** The comparison and review from a .collate file. */
export async function unpackReview(bytes: Uint8Array, password?: string): Promise<ReviewContent & { reviewer?: string }> {
  if (isLocked(bytes)) {
    if (!password) throw new WrongPassword();
    bytes = await unlock(bytes, password);
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('This is not a Collate review file.');
  }
  const raw = files['manifest.json'];
  const manifest = raw ? fromJson<Manifest>(strFromU8(raw)) : null;
  if (!manifest || manifest.format !== FORMAT) throw new Error('This is not a Collate review file.');
  const read = new Map<string, Promise<Doc>>();
  const get = (ref: EntryRef | null): Promise<Doc> | null => {
    if (!ref) return null;
    let p = read.get(ref.path);
    if (!p) {
      const data = files[ref.path];
      if (!data) throw new Error('The review file is incomplete.');
      const saved: SavedDoc = ref.how === 'file' ? { how: 'file', file: new Blob([data as BlobPart]), name: ref.name } : { how: 'model', doc: fromJson<Doc>(strFromU8(data)) };
      p = restoreDoc(saved);
      read.set(ref.path, p);
    }
    return p;
  };
  const [a, b, ...versions] = await Promise.all([get(manifest.a), get(manifest.b), ...manifest.versions.map((v) => get(v)!)]);
  return {
    docs: { a: a ?? null, b: b ?? null, edits: manifest.edits ?? { a: 0, b: 0 }, sample: !!manifest.sample },
    extra: manifest.extra ?? {},
    // (Each document is read once: a version that is A or B is the same document.)
    versions,
    reviewer: manifest.reviewer,
  };
}

/* --------------------------------------------------------------- locking */

async function keyFor(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', strToU8(password) as BufferSource, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function lock(data: Uint8Array, password: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(password, salt), data as BufferSource));
  const out = new Uint8Array(MAGIC.length + salt.length + iv.length + sealed.length);
  out.set(MAGIC, 0);
  out.set(salt, MAGIC.length);
  out.set(iv, MAGIC.length + salt.length);
  out.set(sealed, MAGIC.length + salt.length + iv.length);
  return out;
}

async function unlock(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const at = MAGIC.length;
  const salt = bytes.subarray(at, at + 16);
  const iv = bytes.subarray(at + 16, at + 28);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await keyFor(password, salt), bytes.subarray(at + 28) as BufferSource));
  } catch {
    throw new WrongPassword();
  }
}
