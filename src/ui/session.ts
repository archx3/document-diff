/**
 * Keeps the comparison across reloads: the two documents with the changes
 * copied between them, and where the reader was, in this browser's IndexedDB.
 * Each tab keeps its own session, so reloading a tab brings back what that tab
 * showed. The comparison page opened afresh (typed in, or from a bookmark)
 * picks up the most recent comparison of any tab.
 *
 * A document is saved as its file while it is as loaded, as its Word or
 * OpenDocument file with the copied changes written in once it has been
 * edited, and otherwise (a PDF, a paste, the sample drafts … after an edit) as
 * the document model itself.
 */
import type { Block, Doc, InlineObject, Span, TableCell } from '../core/model';
import { newId } from '../core/model';
import { DocxPackage } from '../formats/docx/package';
import { exportDocx } from '../formats/docx/writer';
import { loadFile } from '../formats/load';
import { OdtPackage } from '../formats/odt/package';
import { exportOdt } from '../formats/odt/writer';
import { noteSource, sourceOf } from '../lib/sources';
import type { Docs } from './history';
import type { Side } from './util';

/** Which workspace a session belongs to: the comparison page, the sample page or the single-file page. */
export type SessionScope = 'compare' | 'sample' | 'single';

/** A document as saved: a file to read again, or the model itself. */
export type SavedDoc = { how: 'file'; file: Blob; name: string } | { how: 'model'; doc: Doc };

interface SavedDocs {
  a: SavedDoc | null;
  b: SavedDoc | null;
  edits: Record<Side, number>;
  sample: boolean;
}

/** Where the reader was. */
export interface SavedView {
  current: number;
  scrollTop: number;
}

/** Anything else the workspace keeps with a session (the review marks), as plain data. */
export type SavedExtra = Record<string, unknown>;

export interface Restored {
  docs: Docs;
  view: SavedView | null;
  extra: SavedExtra;
  /** Documents that could not be read again, by name. */
  lost: string[];
}

const DB_NAME = 'collate';
const STORE = 'sessions';
const TAB_KEY = 'collate.tab';
/** Sessions kept, most recent first; older ones are removed. */
const KEEP = 8;

/* ------------------------------------------------------------- storage */

let dbPromise: Promise<IDBDatabase | null> | null = null;
/** The database once it is open, for writes that can't wait for a promise (as the page unloads). */
let openedDb: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve((openedDb = req.result));
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      // Storage switched off (a private window in some browsers, a sandboxed frame).
      resolve(null);
    }
  });
  return dbPromise;
}

/**
 * One request, in a transaction of its own that is committed as soon as it is
 * made. Left to commit itself, a transaction waits for its request to come
 * back first, and a page that is being unloaded is gone before then: the
 * write is lost.
 */
function request<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.commit?.();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

const get = <T>(db: IDBDatabase, key: string) => request<T>(db, 'readonly', (s) => s.get(key) as IDBRequest<T>);
const put = (db: IDBDatabase, key: string, value: unknown) => request(db, 'readwrite', (s) => s.put(value, key));
const del = (db: IDBDatabase, key: string) => request(db, 'readwrite', (s) => s.delete(key));

/** This tab's id, which a reload keeps (sessionStorage lives as long as the tab). */
function tabId(): string {
  try {
    let id = sessionStorage.getItem(TAB_KEY);
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(TAB_KEY, id);
    }
    return id;
  } catch {
    return 'tab';
  }
}

interface IndexEntry {
  scope: SessionScope;
  tab: string;
  savedAt: number;
}

const INDEX = 'index';
const docsKey = (scope: SessionScope, tab: string) => `${scope}:${tab}:docs`;
const viewKey = (scope: SessionScope, tab: string) => `${scope}:${tab}:view`;
const extraKey = (scope: SessionScope, tab: string) => `${scope}:${tab}:extra`;

/** Records this session as the latest, and forgets all but the most recent few. */
async function touch(db: IDBDatabase, scope: SessionScope, tab: string): Promise<void> {
  const index = (await get<IndexEntry[]>(db, INDEX)) ?? [];
  const next = [{ scope, tab, savedAt: Date.now() }, ...index.filter((e) => e.scope !== scope || e.tab !== tab)];
  for (const old of next.splice(KEEP)) {
    await del(db, docsKey(old.scope, old.tab));
    await del(db, viewKey(old.scope, old.tab));
    await del(db, extraKey(old.scope, old.tab));
  }
  await put(db, INDEX, next);
}

/* ------------------------------------------------------------ documents */

const snapshots = new WeakMap<Doc, SavedDoc>();

/** The document as it is saved. */
export function snapshotDoc(doc: Doc): SavedDoc {
  let s = snapshots.get(doc);
  if (s) return s;
  const file = sourceOf(doc);
  if (file) s = { how: 'file', file, name: file.name };
  else if (doc.pkg instanceof DocxPackage) s = { how: 'file', file: new Blob([exportDocx(doc) as BlobPart]), name: doc.name };
  else if (doc.pkg instanceof OdtPackage) s = { how: 'file', file: new Blob([exportOdt(doc) as BlobPart]), name: doc.name };
  else s = { how: 'model', doc: plainDoc(doc) };
  snapshots.set(doc, s);
  return s;
}

/** The document again, from what was saved. Blocks get new ids, as a newly read file's do. */
export async function restoreDoc(saved: SavedDoc): Promise<Doc> {
  if (saved.how === 'file') {
    const file = new File([saved.file], saved.name);
    const doc = await loadFile(file);
    // Unedited, it is still the file it was read from.
    noteSource(doc, file);
    return doc;
  }
  return reviveDoc(saved.doc);
}

/** A copy of the model with only plain data: no format package, no backend data, no blob: URLs. */
export function plainDoc(doc: Doc): Doc {
  const { pkg: _pkg, ...rest } = doc;
  return { ...rest, blocks: doc.blocks.map(plainBlock) };
}

function plainBlock(b: Block): Block {
  switch (b.type) {
    case 'p':
      return { id: b.id, type: 'p', props: b.props, spans: b.spans.map(plainSpan) };
    case 'table':
      return {
        id: b.id,
        type: 'table',
        rows: b.rows.map((r) => ({ id: r.id, header: r.header, cells: r.cells.map(plainCell) })),
        fragment: b.fragment,
      };
    case 'opaque':
      return { id: b.id, type: 'opaque', label: b.label, blocks: b.blocks.map(plainBlock) };
    case 'marker':
      return { id: b.id, type: 'marker' };
  }
}

function plainCell(c: TableCell): TableCell {
  return { blocks: c.blocks.map(plainBlock), colspan: c.colspan, vmerge: c.vmerge, rowspan: c.rowspan, header: c.header };
}

function plainSpan(s: Span): Span {
  const out: Span = { text: s.text, fmt: s.fmt };
  if (s.marker) out.marker = true;
  if (s.obj) {
    const { src, ...obj } = s.obj;
    // A blob: URL belongs to this page; the picture is shown again from its bytes.
    out.obj = src && !src.startsWith('blob:') ? { ...obj, src } : obj;
  }
  return out;
}

/** A saved model made live: new ids, and pictures shown from their bytes. */
export function reviveDoc(doc: Doc): Doc {
  return { ...doc, id: newId('d'), blocks: doc.blocks.map(reviveBlock) };
}

function reviveBlock(b: Block): Block {
  switch (b.type) {
    case 'p':
      return { ...b, id: newId('p'), spans: b.spans.map(reviveSpan) };
    case 'table':
      return { ...b, id: newId('t'), rows: b.rows.map((r) => ({ ...r, id: newId('r'), cells: r.cells.map((c) => ({ ...c, blocks: c.blocks.map(reviveBlock) })) })) };
    case 'opaque':
      return { ...b, id: newId('o'), blocks: b.blocks.map(reviveBlock) };
    case 'marker':
      return { ...b, id: newId('m') };
  }
}

function reviveSpan(s: Span): Span {
  const o = s.obj;
  if (!o || o.src || !o.data || !o.mime || typeof URL.createObjectURL !== 'function') return s;
  const obj: InlineObject = { ...o, src: URL.createObjectURL(new Blob([o.data as BlobPart], { type: o.mime })) };
  return { ...s, obj };
}

/* ------------------------------------------------------------- sessions */

interface DocsRecord {
  docs: SavedDocs;
}

/**
 * The saved session for this workspace: this tab's, or for the comparison
 * page, the most recent of any tab. Null when there is none, or storage is off.
 */
export async function restoreSession(scope: SessionScope): Promise<Restored | null> {
  const db = await openDb();
  if (!db) return null;
  let tab = tabId();
  let rec = await get<DocsRecord>(db, docsKey(scope, tab));
  if (!rec && scope === 'compare') {
    const latest = ((await get<IndexEntry[]>(db, INDEX)) ?? []).find((e) => e.scope === scope);
    if (latest) {
      tab = latest.tab;
      rec = await get<DocsRecord>(db, docsKey(scope, tab));
    }
  }
  if (!rec?.docs) return null;
  const view = (await get<SavedView>(db, viewKey(scope, tab))) ?? null;
  const extra = (await get<SavedExtra>(db, extraKey(scope, tab))) ?? {};
  const lost: string[] = [];
  const read = async (saved: SavedDoc | null): Promise<Doc | null> => {
    if (!saved) return null;
    try {
      return await restoreDoc(saved);
    } catch (err) {
      console.error(err);
      lost.push(saved.how === 'file' ? saved.name : saved.doc.name);
      return null;
    }
  };
  const [a, b] = await Promise.all([read(rec.docs.a), read(rec.docs.b)]);
  const docs: Docs = {
    a,
    b,
    edits: { a: a ? rec.docs.edits.a : 0, b: b ? rec.docs.edits.b : 0 },
    sample: rec.docs.sample && !!a && !!b,
  };
  return { docs, view, extra, lost };
}

/**
 * Writes a workspace's session as it changes. Documents are written a moment
 * after they change (an edited Word file takes a little while to write), the
 * view and extras a little later still, and everything at once when the page
 * is hidden or unloaded.
 */
export class SessionWriter {
  private readonly tab = tabId();
  private pendingDocs: Docs | null = null;
  private pendingView: SavedView | null = null;
  private pendingExtra: SavedExtra | null = null;
  private timer = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly scope: SessionScope | undefined) {}

  docs(docs: Docs): void {
    this.pendingDocs = docs;
    this.schedule(250);
  }

  view(view: SavedView): void {
    this.pendingView = view;
    this.schedule(500);
  }

  extra(extra: SavedExtra): void {
    this.pendingExtra = extra;
    this.schedule(300);
  }

  /** Writes whatever is waiting now. */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = 0;
    const docs = this.pendingDocs;
    const view = this.pendingView;
    const extra = this.pendingExtra;
    this.pendingDocs = this.pendingView = this.pendingExtra = null;
    if (!this.scope || (!docs && !view && !extra)) return this.chain;
    const scope = this.scope;
    const tab = this.tab;
    // Documents are copied now, as they are; the writing waits its turn.
    let saved: SavedDocs | null = null;
    if (docs) {
      try {
        saved = { a: docs.a && snapshotDoc(docs.a), b: docs.b && snapshotDoc(docs.b), edits: { ...docs.edits }, sample: docs.sample };
      } catch (err) {
        console.error('The session could not be saved', err);
      }
    }
    // Written now, not after a promise or the write before: when the page is
    // being unloaded there is no later. (The database keeps writes in the order they were made.)
    const write = (db: IDBDatabase) =>
      Promise.all([
        saved && put(db, docsKey(scope, tab), { docs: saved } satisfies DocsRecord),
        view && put(db, viewKey(scope, tab), view),
        extra && put(db, extraKey(scope, tab), extra),
      ]);
    const written = openedDb ? write(openedDb) : openDb().then((db) => db && write(db));
    // The list of sessions can wait: the next load of this one lists it again.
    this.chain = Promise.all([this.chain, written]).then(async () => {
      const db = await openDb();
      if (db && saved) await touch(db, scope, tab);
    });
    return this.chain;
  }

  private schedule(ms: number): void {
    if (!this.scope) return;
    if (this.timer) return;
    this.timer = window.setTimeout(() => void this.flush(), ms);
  }
}
