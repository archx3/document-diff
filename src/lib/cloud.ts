/**
 * Opening documents from Google Drive, OneDrive and Dropbox with their own
 * pickers, and earlier versions of a Google Drive file from its revisions.
 * Each service needs the site's own keys (see README); a service without keys
 * is simply not offered. The files come straight from the service to this
 * browser tab; nothing passes through a server of ours.
 */

export type CloudKind = 'gdrive' | 'onedrive' | 'dropbox';

export const CLOUD_NAME: Record<CloudKind, string> = { gdrive: 'Google Drive', onedrive: 'OneDrive', dropbox: 'Dropbox' };

export interface CloudConfig {
  google?: { clientId: string; apiKey: string; appId?: string };
  onedrive?: { clientId: string };
  dropbox?: { appKey: string };
}

/* ------------------------------------------------------------------ config */

// Next.js writes these in when the site is built; elsewhere (the single-file build) they are not there.
function env(read: () => string | undefined): string | undefined {
  try {
    return read() || undefined;
  } catch {
    return undefined;
  }
}

/** The keys this site was built with, or given at run time as `window.COLLATE_CONFIG`. */
export function cloudConfig(): CloudConfig {
  const given = (globalThis as { COLLATE_CONFIG?: CloudConfig }).COLLATE_CONFIG;
  if (given) return given;
  const googleClient = env(() => process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
  const googleKey = env(() => process.env.NEXT_PUBLIC_GOOGLE_API_KEY);
  const oneDrive = env(() => process.env.NEXT_PUBLIC_ONEDRIVE_CLIENT_ID);
  const dropbox = env(() => process.env.NEXT_PUBLIC_DROPBOX_APP_KEY);
  return {
    google: googleClient && googleKey ? { clientId: googleClient, apiKey: googleKey, appId: env(() => process.env.NEXT_PUBLIC_GOOGLE_APP_ID) } : undefined,
    onedrive: oneDrive ? { clientId: oneDrive } : undefined,
    dropbox: dropbox ? { appKey: dropbox } : undefined,
  };
}

/** The services this site can open files from. */
export function availableClouds(config = cloudConfig()): CloudKind[] {
  const out: CloudKind[] = [];
  if (config.google) out.push('gdrive');
  if (config.onedrive) out.push('onedrive');
  if (config.dropbox) out.push('dropbox');
  return out;
}

/* ------------------------------------------------------------------ helpers */

const scripts = new Map<string, Promise<void>>();

function loadScript(src: string, attrs: Record<string, string> = {}): Promise<void> {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('The service could not be reached (it needs an internet connection).'));
      document.head.appendChild(s);
    });
    p.catch(() => scripts.delete(src));
    scripts.set(src, p);
  }
  return p;
}

/** Fetches a file the service handed over, as a File. */
async function fetchFile(url: string, name: string, headers?: Record<string, string>): Promise<File> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`“${name}” could not be downloaded (${res.status}).`);
  return new File([await res.blob()], name);
}

/** Files the reader did not choose: the picker was closed. */
export class PickCancelled extends Error {
  constructor() {
    super('No file was chosen.');
  }
}

/* -------------------------------------------------------------- Dropbox */

interface DropboxFile {
  name: string;
  link: string;
}
interface DropboxApi {
  choose(o: { linkType: 'direct'; multiselect: boolean; extensions?: string[]; success(files: DropboxFile[]): void; cancel(): void }): void;
}

async function pickDropbox(appKey: string, multiple: boolean, extensions: readonly string[]): Promise<File[]> {
  await loadScript('https://www.dropbox.com/static/api/2/dropins.js', { id: 'dropboxjs', 'data-app-key': appKey });
  const api = (globalThis as { Dropbox?: DropboxApi }).Dropbox;
  if (!api) throw new Error('Dropbox did not start.');
  const files = await new Promise<DropboxFile[]>((resolve, reject) =>
    api.choose({ linkType: 'direct', multiselect: multiple, extensions: extensions.map((e) => `.${e}`), success: resolve, cancel: () => reject(new PickCancelled()) }),
  );
  return Promise.all(files.map((f) => fetchFile(f.link, f.name)));
}

/* -------------------------------------------------------------- OneDrive */

interface OneDriveResult {
  value: Array<{ name: string; '@microsoft.graph.downloadUrl': string }>;
}
interface OneDriveApi {
  open(o: {
    clientId: string;
    action: 'download';
    multiSelect: boolean;
    advanced: { filter: string };
    success(r: OneDriveResult): void;
    cancel(): void;
    error(e: unknown): void;
  }): void;
}

async function pickOneDrive(clientId: string, multiple: boolean, extensions: readonly string[]): Promise<File[]> {
  await loadScript('https://js.live.net/v7.2/OneDrive.js');
  const api = (globalThis as { OneDrive?: OneDriveApi }).OneDrive;
  if (!api) throw new Error('OneDrive did not start.');
  const result = await new Promise<OneDriveResult>((resolve, reject) =>
    api.open({
      clientId,
      action: 'download',
      multiSelect: multiple,
      advanced: { filter: extensions.map((e) => `.${e}`).join(',') },
      success: resolve,
      cancel: () => reject(new PickCancelled()),
      error: (e) => reject(new Error(`OneDrive: ${(e as { message?: string })?.message ?? 'the file could not be opened'}`)),
    }),
  );
  return Promise.all(result.value.map((f) => fetchFile(f['@microsoft.graph.downloadUrl'], f.name)));
}

/* ---------------------------------------------------------- Google Drive */

const DRIVE = 'https://www.googleapis.com/drive/v3';
const GOOGLE_DOC = 'application/vnd.google-apps.document';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

interface GoogleApis {
  accounts: { oauth2: { initTokenClient(o: { client_id: string; scope: string; callback(r: { access_token?: string; error?: string }): void }): { requestAccessToken(): void } } };
  picker: {
    PickerBuilder: new () => GooglePickerBuilder;
    ViewId: { DOCS: string };
    Feature: { MULTISELECT_ENABLED: string };
    Action: { PICKED: string; CANCEL: string };
  };
}
interface GooglePickerBuilder {
  addView(v: string): GooglePickerBuilder;
  enableFeature(f: string): GooglePickerBuilder;
  setOAuthToken(t: string): GooglePickerBuilder;
  setDeveloperKey(k: string): GooglePickerBuilder;
  setAppId(id: string): GooglePickerBuilder;
  setCallback(cb: (d: { action: string; docs?: Array<{ id: string; name: string; mimeType: string }> }) => void): GooglePickerBuilder;
  build(): { setVisible(v: boolean): void };
}

let googleToken: { value: string; until: number } | null = null;

async function googleAccess(clientId: string): Promise<string> {
  if (googleToken && googleToken.until > Date.now()) return googleToken.value;
  await loadScript('https://accounts.google.com/gsi/client');
  const g = (globalThis as { google?: GoogleApis }).google;
  if (!g?.accounts) throw new Error('Google sign-in did not start.');
  // Access to the files the reader picks, and nothing else.
  const token = await new Promise<string>((resolve, reject) => {
    g.accounts.oauth2
      .initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (r) => (r.access_token ? resolve(r.access_token) : reject(new Error(r.error === 'access_denied' ? 'Google Drive access was not allowed.' : 'Google sign-in failed.'))),
      })
      .requestAccessToken();
  });
  googleToken = { value: token, until: Date.now() + 50 * 60_000 };
  return token;
}

/** A file picked from Google Drive, remembered so its earlier versions can be offered. */
export interface DriveRef {
  id: string;
  name: string;
  mimeType: string;
}

const driveRefs = new WeakMap<object, DriveRef>();
/** The Drive file a File (or the document read from it) came from, if it did. */
export const driveRefOf = (x: object) => driveRefs.get(x);
/** Remembers that a document was read from a Drive file. */
export function noteDrive(doc: object, from: File): void {
  const ref = driveRefs.get(from);
  if (ref) driveRefs.set(doc, ref);
}

async function driveDownload(ref: DriveRef, token: string): Promise<File> {
  const auth = { Authorization: `Bearer ${token}` };
  // A Google Doc is downloaded as Word, which keeps its headings, lists and tables.
  const file =
    ref.mimeType === GOOGLE_DOC
      ? await fetchFile(`${DRIVE}/files/${ref.id}/export?mimeType=${encodeURIComponent(DOCX)}`, `${ref.name}.docx`, auth)
      : await fetchFile(`${DRIVE}/files/${ref.id}?alt=media`, ref.name, auth);
  driveRefs.set(file, ref);
  return file;
}

async function pickDrive(cfg: NonNullable<CloudConfig['google']>, multiple: boolean): Promise<File[]> {
  const token = await googleAccess(cfg.clientId);
  await loadScript('https://apis.google.com/js/api.js');
  const gapi = (globalThis as { gapi?: { load(name: string, cb: () => void): void } }).gapi;
  if (!gapi) throw new Error('Google Drive did not start.');
  await new Promise<void>((resolve) => gapi.load('picker', resolve));
  const g = (globalThis as { google?: GoogleApis }).google!;
  const picked = await new Promise<DriveRef[]>((resolve, reject) => {
    let b = new g.picker.PickerBuilder().addView(g.picker.ViewId.DOCS).setOAuthToken(token).setDeveloperKey(cfg.apiKey);
    if (cfg.appId) b = b.setAppId(cfg.appId);
    if (multiple) b = b.enableFeature(g.picker.Feature.MULTISELECT_ENABLED);
    b.setCallback((d) => {
      if (d.action === g.picker.Action.PICKED) resolve((d.docs ?? []).map((x) => ({ id: x.id, name: x.name, mimeType: x.mimeType })));
      else if (d.action === g.picker.Action.CANCEL) reject(new PickCancelled());
    })
      .build()
      .setVisible(true);
  });
  return Promise.all(picked.map((r) => driveDownload(r, token)));
}

/** An earlier version of a Drive file. */
export interface DriveRevision {
  id: string;
  modified: string;
  by?: string;
}

/** A Drive file's earlier versions, newest first. */
export async function driveRevisions(ref: DriveRef): Promise<DriveRevision[]> {
  const cfg = cloudConfig().google;
  if (!cfg) return [];
  const token = await googleAccess(cfg.clientId);
  const res = await fetch(`${DRIVE}/files/${ref.id}/revisions?fields=revisions(id,modifiedTime,lastModifyingUser/displayName)&pageSize=200`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`The versions of “${ref.name}” could not be listed (${res.status}).`);
  const data = (await res.json()) as { revisions?: Array<{ id: string; modifiedTime: string; lastModifyingUser?: { displayName?: string } }> };
  return (data.revisions ?? []).map((r) => ({ id: r.id, modified: r.modifiedTime, by: r.lastModifyingUser?.displayName })).reverse();
}

/** One earlier version of a Drive file, as a file. */
export async function driveRevisionFile(ref: DriveRef, rev: DriveRevision): Promise<File> {
  const cfg = cloudConfig().google;
  if (!cfg) throw new Error('Google Drive is not set up here.');
  const token = await googleAccess(cfg.clientId);
  const auth = { Authorization: `Bearer ${token}` };
  const when = new Date(rev.modified).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const base = ref.name.replace(/\.[^.]+$/, '');
  if (ref.mimeType === GOOGLE_DOC) {
    // A Google Doc's version is downloaded as Word, from the link Drive gives for it.
    const res = await fetch(`${DRIVE}/files/${ref.id}/revisions/${rev.id}?fields=exportLinks`, { headers: auth });
    const link = res.ok ? ((await res.json()) as { exportLinks?: Record<string, string> }).exportLinks?.[DOCX] : undefined;
    if (!link) throw new Error('That version could not be downloaded as a Word file.');
    return fetchFile(link, `${base} (${when}).docx`, auth);
  }
  const ext = ref.name.match(/\.[^.]+$/)?.[0] ?? '';
  return fetchFile(`${DRIVE}/files/${ref.id}/revisions/${rev.id}?alt=media`, `${base} (${when})${ext}`, auth);
}

/* ------------------------------------------------------------------ picking */

/** Files chosen in a service's picker. Rejects with PickCancelled when the picker is closed. */
export async function pickFromCloud(kind: CloudKind, opts: { multiple?: boolean; extensions: readonly string[] }): Promise<File[]> {
  const cfg = cloudConfig();
  const multiple = !!opts.multiple;
  if (kind === 'dropbox' && cfg.dropbox) return pickDropbox(cfg.dropbox.appKey, multiple, opts.extensions);
  if (kind === 'onedrive' && cfg.onedrive) return pickOneDrive(cfg.onedrive.clientId, multiple, opts.extensions);
  if (kind === 'gdrive' && cfg.google) return pickDrive(cfg.google, multiple);
  throw new Error(`${CLOUD_NAME[kind]} is not set up here.`);
}
