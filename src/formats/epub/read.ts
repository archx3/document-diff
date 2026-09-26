import { unzipSync } from 'fflate';
import type { Block, Doc } from '../../core/model';
import { hashBytes, newId } from '../../core/model';
import { htmlBlocks } from '../html/read';

/**
 * EPUB e-books: the chapters listed in the package's reading order, read as
 * XHTML. Formatting that the book's stylesheets attach to classes is applied
 * so bold, italic and monospace text is recognized.
 */

const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i + 1);
}

/** Resolves a relative href against the folder of `from` (a path inside the zip). */
function resolve(from: string, href: string): string {
  let rel = href.split('#')[0]!.split('?')[0]!;
  try {
    rel = decodeURIComponent(rel);
  } catch {
    /* keep as is */
  }
  const parts: string[] = [];
  for (const seg of (rel.startsWith('/') ? rel : dirOf(from) + rel).split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function parseXml(text: string): Document | null {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  return doc.getElementsByTagName('parsererror').length ? null : doc;
}

function byLocal(root: Document | Element, local: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', local));
}

/* ------------------------------------------------------------------ CSS */

interface Rule {
  tag: string;
  classes: string[];
  decls: string;
}

/** Rules with simple selectors (`p`, `.bold`, `span.c1`); anything more complex is ignored. */
function parseCss(css: string): Rule[] {
  const rules: Rule[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@[^{;]+;/g, '');
  // Drop at-rule blocks (media queries, font faces) including their nested rules.
  let flat = '';
  let depth = 0;
  let skipDepth = -1;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (ch === '@' && skipDepth < 0) skipDepth = depth;
    if (ch === '{') depth++;
    if (skipDepth < 0) flat += ch;
    if (ch === '}') {
      depth--;
      if (depth === skipDepth) {
        skipDepth = -1;
        continue;
      }
    }
  }
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = m[2]!.trim();
    if (!decls) continue;
    for (const raw of m[1]!.split(',')) {
      const sel = raw.trim();
      const sm = /^([a-z][a-z0-9]*)?((?:\.[\w-]+)*)$/i.exec(sel);
      if (!sm || (!sm[1] && !sm[2])) continue;
      rules.push({ tag: (sm[1] ?? '').toLowerCase(), classes: sm[2] ? sm[2].slice(1).split('.') : [], decls });
    }
  }
  return rules;
}

/** Copies matching stylesheet declarations into each element's style attribute (inline styles still win). */
function applyCss(root: Element, rules: Rule[]): void {
  if (!rules.length) return;
  const byClass = new Map<string, Rule[]>();
  const byTag = new Map<string, Rule[]>();
  rules.forEach((r) => {
    const key = r.classes[0];
    if (key) {
      let list = byClass.get(key);
      if (!list) byClass.set(key, (list = []));
      list.push(r);
    } else {
      let list = byTag.get(r.tag);
      if (!list) byTag.set(r.tag, (list = []));
      list.push(r);
    }
  });
  for (const el of Array.from(root.getElementsByTagName('*'))) {
    const tag = el.localName.toLowerCase();
    const classes = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    const matched: Rule[] = [...(byTag.get(tag) ?? [])];
    for (const c of classes) for (const r of byClass.get(c) ?? []) if ((!r.tag || r.tag === tag) && r.classes.every((x) => classes.includes(x))) matched.push(r);
    if (!matched.length) continue;
    // Element rules first, then class rules, in stylesheet order.
    matched.sort((a, b) => (a.classes.length ? 1 : 0) - (b.classes.length ? 1 : 0) || rules.indexOf(a) - rules.indexOf(b));
    const inline = el.getAttribute('style') ?? '';
    el.setAttribute('style', matched.map((r) => r.decls).join(';') + ';' + inline);
  }
}

/* --------------------------------------------------------------- reader */

export function readEpub(data: Uint8Array, name: string): Doc {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new Error('The file could not be unzipped.');
  }
  const dec = new TextDecoder();
  const text = (path: string) => (files[path] ? dec.decode(files[path]) : undefined);
  const container = parseXml(text('META-INF/container.xml') ?? '');
  const opfPath = container ? byLocal(container, 'rootfile')[0]?.getAttribute('full-path') : undefined;
  if (!opfPath || !files[opfPath]) throw new Error('This file is not an EPUB book (its package document is missing).');
  if (files['META-INF/encryption.xml'] && /EncryptedData/.test(text('META-INF/encryption.xml') ?? '') && !/obfuscation/i.test(text('META-INF/encryption.xml') ?? ''))
    throw new Error('This book is protected with DRM, so its text cannot be read.');
  const opf = parseXml(text(opfPath)!);
  if (!opf) throw new Error('The book’s package document is malformed.');

  const manifest = new Map<string, { path: string; type: string; props: string }>();
  for (const item of byLocal(opf, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, { path: resolve(opfPath, href), type: item.getAttribute('media-type') ?? '', props: item.getAttribute('properties') ?? '' });
  }
  const spine = byLocal(opf, 'itemref')
    .map((r) => manifest.get(r.getAttribute('idref') ?? ''))
    .filter((m): m is { path: string; type: string; props: string } => !!m && /html|xml/.test(m.type) && !/\bnav\b/.test(m.props));

  const urls = new Map<string, string>();
  const imageFor = (from: string) => (src: string) => {
    const path = resolve(from, src);
    const bytes = files[path];
    if (!bytes) return undefined;
    const mime = [...manifest.values()].find((m) => m.path === path)?.type || IMAGE_MIME[path.split('.').pop()!.toLowerCase()] || 'application/octet-stream';
    const hash = hashBytes(bytes);
    let url = urls.get(hash);
    if (!url && typeof URL.createObjectURL === 'function' && /^image\//.test(mime)) {
      try {
        url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
        urls.set(hash, url);
      } catch {
        /* no preview */
      }
    }
    return { data: bytes, mime, url };
  };

  const cssCache = new Map<string, Rule[]>();
  const blocks: Block[] = [];
  for (const item of spine) {
    const raw = text(item.path);
    if (raw === undefined) continue;
    const dom = parseXml(raw) ?? new DOMParser().parseFromString(raw, 'text/html');
    const body = byLocal(dom, 'body')[0] ?? dom.documentElement;
    const rules: Rule[] = [];
    for (const link of byLocal(dom, 'link')) {
      if (!/stylesheet/i.test(link.getAttribute('rel') ?? '')) continue;
      const path = resolve(item.path, link.getAttribute('href') ?? '');
      let parsed = cssCache.get(path);
      if (!parsed) cssCache.set(path, (parsed = parseCss(text(path) ?? '')));
      rules.push(...parsed);
    }
    for (const style of byLocal(dom, 'style')) rules.push(...parseCss(style.textContent ?? ''));
    applyCss(body, rules);
    blocks.push(...htmlBlocks(body, { image: imageFor(item.path) }));
  }
  return {
    id: newId('d'),
    name,
    kind: 'epub',
    blocks,
    version: 0,
    ext: 'epub',
    formatLabel: 'EPUB',
    notes: ['EPUB books are compared as text. Export a merged book as a Word, OpenDocument, HTML or Markdown file.'],
  };
}
