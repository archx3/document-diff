import type { Block, Doc, Fmt, InlineObject, ListInfo, ParaBlock, ParaProps, Role, Span, TableCell, TableRow } from '../../core/model';
import { OBJ_CHAR, fieldKey, hashBytes, newId, normalizeSpans, roleFromName } from '../../core/model';
import { Cfb } from './cfb';

/**
 * Reader for Word 97–2003 binary documents (.doc): text from the piece
 * table, paragraph and character properties from the formatted disk pages,
 * styles, lists, tables, fields, notes and inline pictures.
 */

const cp1252 = new TextDecoder('windows-1252');

function u16(b: Uint8Array, o: number): number {
  return (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0;
}

function i32(b: Uint8Array, o: number): number {
  return u32(b, o) | 0;
}

function utf16(b: Uint8Array, o: number, chars: number): string {
  let s = '';
  for (let i = 0; i < chars; i++) s += String.fromCharCode(u16(b, o + i * 2));
  return s;
}

/* ----------------------------------------------------------------- FIB */

/** Indices into the FIB's table of (offset, size) pairs. */
const FC = {
  Stshf: 1,
  PlcffndRef: 2,
  PlcffndTxt: 3,
  PlcfandRef: 4,
  PlcfBteChpx: 12,
  PlcfBtePapx: 13,
  SttbfFfn: 15,
  Clx: 33,
  PlcfendRef: 46,
  PlcfendTxt: 47,
  PlfLst: 73,
  PlfLfo: 74,
} as const;

interface Fib {
  flags: number;
  ccpText: number;
  ccpFtn: number;
  ccpHdd: number;
  ccpAtn: number;
  ccpEdn: number;
  fcLcb(i: number): [number, number];
}

function readFib(wd: Uint8Array): Fib {
  if (u16(wd, 0) !== 0xa5ec) throw new Error('This file is not a Word document.');
  const nFib = u16(wd, 2);
  const flags = u16(wd, 0x0a);
  if (flags & 0x0100) throw new Error('This document is password protected. Remove the password in Word, save it, and load it again.');
  if (nFib < 0xb0) throw new Error('This is a Word 6 or Word 95 file. Open it in Word or LibreOffice and save it as a Word Document (.docx).');
  let pos = 32;
  const csw = u16(wd, pos);
  pos += 2 + csw * 2;
  const cslw = u16(wd, pos);
  pos += 2;
  const lw = pos;
  pos += cslw * 4;
  const cbRgFcLcb = u16(wd, pos);
  pos += 2;
  const rg = pos;
  const long = (i: number) => (i < cslw ? i32(wd, lw + i * 4) : 0);
  return {
    flags,
    ccpText: long(3),
    ccpFtn: long(4),
    ccpHdd: long(5),
    ccpAtn: long(7),
    ccpEdn: long(8),
    fcLcb: (i) => (i < cbRgFcLcb ? [u32(wd, rg + i * 8), u32(wd, rg + i * 8 + 4)] : [0, 0]),
  };
}

/* --------------------------------------------------------- piece table */

interface Piece {
  cp: number;
  cpEnd: number;
  fc: number;
  compressed: boolean;
}

function readPieces(table: Uint8Array, fc: number, lcb: number): Piece[] {
  let pos = fc;
  const end = fc + lcb;
  while (pos < end && table[pos] === 0x01) pos += 3 + u16(table, pos + 1);
  if (table[pos] !== 0x02) throw new Error('The document’s text table is damaged.');
  const size = u32(table, pos + 1);
  pos += 5;
  const n = Math.floor((size - 4) / 12);
  const pieces: Piece[] = [];
  for (let i = 0; i < n; i++) {
    const raw = u32(table, pos + (n + 1) * 4 + i * 8 + 2);
    const compressed = (raw & 0x40000000) !== 0;
    const value = raw & 0x3fffffff;
    pieces.push({ cp: u32(table, pos + i * 4), cpEnd: u32(table, pos + (i + 1) * 4), fc: compressed ? value / 2 : value, compressed });
  }
  return pieces;
}

/* ------------------------------------------------------------- sprms */

interface Sprm {
  op: number;
  /** Operand bytes (for variable-length sprms, without the size prefix). */
  arg: Uint8Array;
}

function* sprms(g: Uint8Array): Generator<Sprm> {
  let i = 0;
  while (i + 2 <= g.length) {
    const op = u16(g, i);
    i += 2;
    const spra = op >> 13;
    let start = i;
    let len: number;
    if (spra === 0 || spra === 1) len = 1;
    else if (spra === 2 || spra === 4 || spra === 5) len = 2;
    else if (spra === 3) len = 4;
    else if (spra === 7) len = 3;
    else if (op === 0xd608 || op === 0xd606) {
      // Table definitions carry a two-byte size.
      len = Math.max(0, u16(g, i) - 1);
      start = i + 2;
      i += 2;
    } else if (op === 0xc615 && g[i] === 255) {
      return; // Tab stops with an extended layout: nothing further we need.
    } else {
      len = g[i] ?? 0;
      start = i + 1;
      i += 1;
    }
    yield { op, arg: g.subarray(start, start + len) };
    i += len;
  }
}

/* ------------------------------------------------------- formatted pages */

interface Run {
  fc: number;
  fcEnd: number;
  grpprl: Uint8Array;
  istd: number;
}

const EMPTY: Uint8Array = new Uint8Array(0);

function readPapx(wd: Uint8Array, table: Uint8Array, fc: number, lcb: number): Run[] {
  const runs: Run[] = [];
  const n = Math.floor((lcb - 4) / 8);
  for (let i = 0; i < n; i++) {
    const page = (u32(table, fc + (n + 1) * 4 + i * 4) & 0x3fffff) * 512;
    if (page + 512 > wd.length) continue;
    const crun = wd[page + 511]!;
    for (let j = 0; j < crun; j++) {
      const bOffset = wd[page + (crun + 1) * 4 + j * 13]!;
      let grpprl: Uint8Array = EMPTY;
      let istd = 0;
      if (bOffset) {
        const at = page + bOffset * 2;
        const cb = wd[at]!;
        const start = cb ? at + 1 : at + 2;
        const size = cb ? 2 * cb - 1 : 2 * wd[at + 1]!;
        istd = u16(wd, start);
        grpprl = wd.subarray(start + 2, start + size);
      }
      runs.push({ fc: u32(wd, page + j * 4), fcEnd: u32(wd, page + (j + 1) * 4), grpprl, istd });
    }
  }
  return runs.sort((a, b) => a.fc - b.fc);
}

function readChpx(wd: Uint8Array, table: Uint8Array, fc: number, lcb: number): Run[] {
  const runs: Run[] = [];
  const n = Math.floor((lcb - 4) / 8);
  for (let i = 0; i < n; i++) {
    const page = (u32(table, fc + (n + 1) * 4 + i * 4) & 0x3fffff) * 512;
    if (page + 512 > wd.length) continue;
    const crun = wd[page + 511]!;
    for (let j = 0; j < crun; j++) {
      const b = wd[page + (crun + 1) * 4 + j]!;
      const grpprl = b ? wd.subarray(page + b * 2 + 1, page + b * 2 + 1 + wd[page + b * 2]!) : EMPTY;
      runs.push({ fc: u32(wd, page + j * 4), fcEnd: u32(wd, page + (j + 1) * 4), grpprl, istd: 0 });
    }
  }
  return runs.sort((a, b) => a.fc - b.fc);
}

function findRun(runs: Run[], fc: number): Run | undefined {
  let lo = 0;
  let hi = runs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = runs[mid]!;
    if (fc < r.fc) hi = mid - 1;
    else if (fc >= r.fcEnd) lo = mid + 1;
    else return r;
  }
  return undefined;
}

/* -------------------------------------------------------------- styles */

interface StyleDef {
  name: string;
  sti: number;
  /** 1 paragraph, 2 character, 3 table, 4 numbering. */
  stk: number;
  base: number;
  papx: Uint8Array;
  chpx: Uint8Array;
}

function readStyles(table: Uint8Array, fc: number, lcb: number): Array<StyleDef | undefined> {
  const out: Array<StyleDef | undefined> = [];
  if (!lcb) return out;
  const cbStshi = u16(table, fc);
  const cstd = u16(table, fc + 2);
  const cbBase = u16(table, fc + 4) || 10;
  let pos = fc + 2 + cbStshi;
  const end = fc + lcb;
  for (let i = 0; i < cstd && pos + 2 <= end; i++) {
    const cbStd = u16(table, pos);
    pos += 2;
    if (!cbStd) {
      out.push(undefined);
      continue;
    }
    const std = table.subarray(pos, pos + cbStd);
    pos += cbStd;
    const sti = u16(std, 0) & 0x0fff;
    const stk = u16(std, 2) & 0x000f;
    const base = u16(std, 2) >> 4;
    const cupx = u16(std, 4) & 0x000f;
    let p = cbBase;
    const cch = u16(std, p);
    const name = utf16(std, p + 2, Math.min(cch, 255));
    p += 2 + cch * 2 + 2;
    let papx: Uint8Array = EMPTY;
    let chpx: Uint8Array = EMPTY;
    for (let k = 0; k < cupx && p + 2 <= std.length; k++) {
      const cb = u16(std, p);
      p += 2;
      const upx = std.subarray(p, p + cb);
      p += cb + (cb & 1);
      if (stk === 1 && k === 0) papx = upx.subarray(2);
      else if ((stk === 1 && k === 1) || (stk === 2 && k === 0)) chpx = upx;
    }
    out.push({ name, sti, stk, base, papx, chpx });
  }
  return out;
}

/** Built-in style identifiers of styles whose names may be translated. */
function roleFromSti(sti: number): { role: Role; level?: number } | undefined {
  if (sti >= 1 && sti <= 9) return { role: 'h', level: sti };
  if (sti >= 19 && sti <= 27) return { role: 'toc', level: sti - 18 };
  if (sti === 62) return { role: 'title' };
  if (sti === 74) return { role: 'subtitle' };
  if (sti === 34) return { role: 'caption' };
  return undefined;
}

/* --------------------------------------------------------------- fonts */

function readFonts(table: Uint8Array, fc: number, lcb: number): string[] {
  const fonts: string[] = [];
  if (!lcb) return fonts;
  let count = u16(table, fc);
  let pos = fc + 4;
  if (count === 0xffff) {
    count = u16(table, fc + 2);
    pos = fc + 6;
  }
  for (let i = 0; i < count && pos < fc + lcb; i++) {
    const cb = table[pos]!;
    const ffn = table.subarray(pos + 1, pos + 1 + cb);
    const family = (ffn[0]! >> 4) & 0x7;
    let name = '';
    for (let o = 39; o + 1 < ffn.length; o += 2) {
      const c = u16(ffn, o);
      if (!c) break;
      name += String.fromCharCode(c);
    }
    fonts.push(family === 3 ? `${name} (modern)` : name);
    pos += 1 + cb;
  }
  return fonts;
}

/* --------------------------------------------------------------- lists */

interface LevelDef {
  start: number;
  nfc: number;
  text: string;
}

interface ListDef {
  lsid: number;
  levels: LevelDef[];
}

interface LfoDef {
  lsid: number;
  starts: Map<number, number>;
}

function readLevel(b: Uint8Array, pos: number): { level: LevelDef; next: number } {
  const start = i32(b, pos);
  const nfc = b[pos + 4]!;
  const cbChpx = b[pos + 24]!;
  const cbPapx = b[pos + 25]!;
  let p = pos + 28 + cbPapx + cbChpx;
  const cch = u16(b, p);
  let text = '';
  for (let i = 0; i < cch; i++) {
    const c = u16(b, p + 2 + i * 2);
    text += c < 9 ? `%${c + 1}` : String.fromCharCode(c);
  }
  p += 2 + cch * 2;
  return { level: { start, nfc, text }, next: p };
}

function readLists(table: Uint8Array, fib: Fib): { lists: Map<number, ListDef>; lfos: LfoDef[] } {
  const lists = new Map<number, ListDef>();
  const lfos: LfoDef[] = [];
  const [fcLst, lcbLst] = fib.fcLcb(FC.PlfLst);
  if (lcbLst) {
    const count = u16(table, fcLst);
    let pos = fcLst + 2 + count * 28;
    for (let i = 0; i < count; i++) {
      const lstf = fcLst + 2 + i * 28;
      const simple = (table[lstf + 26]! & 1) !== 0;
      const levels: LevelDef[] = [];
      for (let l = 0; l < (simple ? 1 : 9); l++) {
        const r = readLevel(table, pos);
        levels.push(r.level);
        pos = r.next;
      }
      const lsid = i32(table, lstf);
      lists.set(lsid, { lsid, levels });
    }
  }
  const [fcLfo, lcbLfo] = fib.fcLcb(FC.PlfLfo);
  if (lcbLfo) {
    const count = u32(table, fcLfo);
    let pos = fcLfo + 4 + count * 16;
    for (let i = 0; i < count; i++) {
      const lfo = fcLfo + 4 + i * 16;
      const def: LfoDef = { lsid: i32(table, lfo), starts: new Map() };
      const clfolvl = table[lfo + 12]!;
      pos += 4;
      for (let k = 0; k < clfolvl; k++) {
        const start = i32(table, pos);
        const flags = u32(table, pos + 4);
        pos += 8;
        if (flags & 0x10) def.starts.set(flags & 0xf, start);
        if (flags & 0x20) pos = readLevel(table, pos).next;
      }
      lfos.push(def);
    }
  }
  return { lists, lfos };
}

const NFC: Record<number, string> = { 0: 'decimal', 1: 'upperRoman', 2: 'lowerRoman', 3: 'upperLetter', 4: 'lowerLetter', 5: 'decimal', 22: 'decimalZero', 23: 'bullet', 255: 'none' };

/* ------------------------------------------------------------ pictures */

const BLIP_TYPES: Record<number, string> = { 0xf01d: 'image/jpeg', 0xf01e: 'image/png', 0xf02a: 'image/jpeg' };
const TWO_UIDS = new Set([0x46b, 0x6e3, 0x6e1, 0x6cb]);

/** The first PNG or JPEG picture in an OfficeArt record tree. */
function findBlip(b: Uint8Array, start: number, end: number, depth = 0): { data: Uint8Array; mime: string } | undefined {
  let pos = start;
  while (pos + 8 <= end && depth < 8) {
    const verInst = u16(b, pos);
    const type = u16(b, pos + 2);
    const len = u32(b, pos + 4);
    const body = pos + 8;
    const stop = Math.min(end, body + len);
    if ((verInst & 0xf) === 0xf) {
      const hit = findBlip(b, body, stop, depth + 1);
      if (hit) return hit;
    } else if (type === 0xf007) {
      // A picture store entry: its picture record follows a 36-byte header and a name.
      const hit = findBlip(b, body + 36 + b[body + 33]!, stop, depth + 1);
      if (hit) return hit;
    } else if (BLIP_TYPES[type]) {
      const inst = verInst >> 4;
      const off = body + 16 + (TWO_UIDS.has(inst) ? 16 : 0) + 1;
      if (off < stop) return { data: b.slice(off, stop), mime: BLIP_TYPES[type]! };
    }
    if (len <= 0 && (verInst & 0xf) !== 0xf) break;
    pos = body + len;
  }
  return undefined;
}

function scanImage(b: Uint8Array, start: number, end: number): { data: Uint8Array; mime: string } | undefined {
  for (let i = start; i + 8 < end; i++) {
    if (b[i] === 0x89 && b[i + 1] === 0x50 && b[i + 2] === 0x4e && b[i + 3] === 0x47) {
      // Up to and including the IEND chunk.
      for (let j = i + 8; j + 12 <= end; ) {
        const len = (b[j]! << 24) | (b[j + 1]! << 16) | (b[j + 2]! << 8) | b[j + 3]!;
        const type = String.fromCharCode(b[j + 4]!, b[j + 5]!, b[j + 6]!, b[j + 7]!);
        j += 12 + len;
        if (type === 'IEND') return { data: b.slice(i, j), mime: 'image/png' };
        if (len < 0) break;
      }
      return undefined;
    }
    if (b[i] === 0xff && b[i + 1] === 0xd8 && b[i + 2] === 0xff) {
      for (let j = end - 2; j > i; j--) if (b[j] === 0xff && b[j + 1] === 0xd9) return { data: b.slice(i, j + 2), mime: 'image/jpeg' };
      return undefined;
    }
  }
  return undefined;
}

function pictureAt(data: Uint8Array | undefined, fc: number): { data: Uint8Array; mime: string; w?: number; h?: number } | undefined {
  if (!data || fc + 68 > data.length) return undefined;
  const lcb = u32(data, fc);
  const cbHeader = u16(data, fc + 4);
  const mm = u16(data, fc + 6);
  const end = Math.min(data.length, fc + lcb);
  let start = fc + cbHeader;
  if (mm === 0x66) start += 1 + data[start]!;
  const dxaGoal = u16(data, fc + 28);
  const dyaGoal = u16(data, fc + 30);
  const mx = u16(data, fc + 32) || 1000;
  const my = u16(data, fc + 34) || 1000;
  const img = findBlip(data, start, end) ?? scanImage(data, start, end);
  if (!img) return undefined;
  return { ...img, w: Math.round(((dxaGoal * mx) / 1000) / 15) || undefined, h: Math.round(((dyaGoal * my) / 1000) / 15) || undefined };
}

/* ------------------------------------------------------------- builder */

interface ParaInfo {
  istd: number;
  ilfo: number;
  ilvl: number;
  align?: ParaProps['align'];
  inTable: boolean;
  ttp: boolean;
  itap: number;
  innerCell: boolean;
  innerTtp: boolean;
  outline?: number;
  header: boolean;
  /** Vertical and horizontal merge flags of the row's cells (row-end paragraphs only). */
  merges?: Array<{ v: number; h: number }>;
}

interface TableBuilder {
  rows: TableRow[];
  cells: TableCell[];
  blocks: Block[];
}

const HIGHLIGHT = ['', 'black', 'blue', 'cyan', 'green', 'magenta', 'red', 'yellow', '', 'darkBlue', 'darkCyan', 'darkGreen', 'darkMagenta', 'darkRed', 'darkYellow', 'darkGray', 'lightGray'];
const MONO = /courier|consolas|mono|menlo|lucida console|source code|\(modern\)$/i;
const INDEX_FIELDS: Record<string, string> = { TOC: 'Table of contents', INDEX: 'Index', BIBLIOGRAPHY: 'Bibliography' };

interface Field {
  instr: string;
  code: string;
  result: string;
  inResult: boolean;
  href?: string;
  passthrough: boolean;
  startBlock?: number;
}

class DocReader {
  readonly blocks: Block[] = [];
  tracked = false;
  comments = false;
  private spans: Span[] = [];
  private tables: TableBuilder[] = [];
  private fields: Field[] = [];
  private text = '';
  private pieces: Piece[];
  private papx: Run[];
  private chpx: Run[];
  private styles: Array<StyleDef | undefined>;
  private fonts: string[];
  private lists: Map<number, ListDef>;
  private lfos: LfoDef[];
  private notes = new Map<number, InlineObject>();
  private charStyleFmt = new Map<number, Fmt>();

  constructor(
    private readonly wd: Uint8Array,
    private readonly table: Uint8Array,
    private readonly data: Uint8Array | undefined,
    private readonly fib: Fib,
  ) {
    this.pieces = readPieces(table, ...fib.fcLcb(FC.Clx));
    this.papx = readPapx(wd, table, ...fib.fcLcb(FC.PlcfBtePapx));
    this.chpx = readChpx(wd, table, ...fib.fcLcb(FC.PlcfBteChpx));
    this.styles = readStyles(table, ...fib.fcLcb(FC.Stshf));
    this.fonts = readFonts(table, ...fib.fcLcb(FC.SttbfFfn));
    ({ lists: this.lists, lfos: this.lfos } = readLists(table, fib));
    this.text = this.decode();
    this.readNotes();
  }

  private decode(): string {
    let out = '';
    for (const p of this.pieces) {
      const n = p.cpEnd - p.cp;
      if (p.compressed) out += cp1252.decode(this.wd.subarray(p.fc, p.fc + n));
      else out += utf16(this.wd, p.fc, n);
    }
    return out;
  }

  private fcOf(cp: number): number {
    let lo = 0;
    let hi = this.pieces.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const p = this.pieces[mid]!;
      if (cp < p.cp) hi = mid - 1;
      else if (cp >= p.cpEnd) lo = mid + 1;
      else return p.fc + (cp - p.cp) * (p.compressed ? 1 : 2);
    }
    return -1;
  }

  /* ---------------------------------------------------------- notes */

  private plcCps(fc: number, lcb: number, cbData: number): number[] {
    if (!lcb) return [];
    const n = Math.floor((lcb - 4) / (4 + cbData));
    const out: number[] = [];
    for (let i = 0; i <= n; i++) out.push(u32(this.table, fc + i * 4));
    return out;
  }

  private readNotes(): void {
    const kinds: Array<['footnote' | 'endnote', number, number, number]> = [
      ['footnote', FC.PlcffndRef, FC.PlcffndTxt, this.fib.ccpText],
      ['endnote', FC.PlcfendRef, FC.PlcfendTxt, this.fib.ccpText + this.fib.ccpFtn + this.fib.ccpHdd + this.fib.ccpAtn],
    ];
    for (const [kind, refIdx, txtIdx, base] of kinds) {
      const refs = this.plcCps(...this.fib.fcLcb(refIdx), 2);
      const txt = this.plcCps(...this.fib.fcLcb(txtIdx), 0);
      for (let i = 0; i + 1 < refs.length; i++) {
        if (txt[i] === undefined || txt[i + 1] === undefined) break;
        const raw = this.text.slice(base + txt[i]!, base + txt[i + 1]!);
        const text = raw
          .replace(/[\u0002\u0005\u0008\u0001]/g, '')
          .replace(/\u0013[^\u0014\u0015]*\u0014?/g, '')
          .replace(/[\u0015]/g, '')
          .replace(/[\r\u000b\u0007]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        this.notes.set(refs[i]!, { kind, key: `${kind}:${text}`, label: `${kind === 'footnote' ? 'Footnote' : 'Endnote'}: ${text}`, note: text });
      }
    }
  }

  /* ----------------------------------------------------- properties */

  private styleChain(istd: number): StyleDef[] {
    const out: StyleDef[] = [];
    const seen = new Set<number>();
    for (let s = istd; s !== 0x0fff && !seen.has(s) && out.length < 16; ) {
      seen.add(s);
      const st = this.styles[s];
      if (!st) break;
      out.push(st);
      s = st.base;
    }
    return out;
  }

  private paraInfo(cp: number): ParaInfo {
    const run = findRun(this.papx, this.fcOf(cp));
    const info: ParaInfo = { istd: run?.istd ?? 0, ilfo: 0, ilvl: 0, inTable: false, ttp: false, itap: 0, innerCell: false, innerTtp: false, header: false };
    // List numbering set by the style applies unless the paragraph overrides it.
    for (const st of this.styleChain(info.istd).reverse()) this.applyPara(st.papx, info);
    if (run) this.applyPara(run.grpprl, info);
    return info;
  }

  private applyPara(g: Uint8Array, info: ParaInfo): void {
    for (const { op, arg } of sprms(g)) {
      switch (op) {
        case 0x460b:
          info.ilfo = u16(arg, 0);
          break;
        case 0x260a:
          info.ilvl = arg[0]!;
          break;
        case 0x2403:
        case 0x2461: {
          const jc = arg[0]!;
          info.align = jc === 1 ? 'center' : jc === 2 ? 'right' : jc === 3 || jc === 4 ? 'justify' : undefined;
          break;
        }
        case 0x2416:
          info.inTable = arg[0] !== 0;
          break;
        case 0x2417:
          info.ttp = arg[0] !== 0;
          break;
        case 0x6649:
          info.itap = i32(arg, 0);
          break;
        case 0x244b:
          info.innerCell = arg[0] !== 0;
          break;
        case 0x244c:
          info.innerTtp = arg[0] !== 0;
          break;
        case 0x2640:
          info.outline = arg[0]! < 9 ? arg[0]! + 1 : undefined;
          break;
        case 0x3404:
          info.header = arg[0] !== 0;
          break;
        case 0xd608: {
          const itcMac = arg[0]!;
          const tcs = 1 + (itcMac + 1) * 2;
          const merges: Array<{ v: number; h: number }> = [];
          for (let i = 0; i < itcMac; i++) {
            const grf = u16(arg, tcs + i * 20);
            merges.push({ h: grf & 0x3, v: (grf >> 5) & 0x3 });
          }
          info.merges = merges;
          break;
        }
        case 0xd62b: {
          const itc = arg[0]!;
          if (!info.merges) info.merges = [];
          while (info.merges.length <= itc) info.merges.push({ h: 0, v: 0 });
          info.merges[itc]!.v = arg[1]! & 0x3;
          break;
        }
      }
    }
  }

  private toggle(v: number, base: boolean | undefined): boolean {
    if (v === 0x80) return !!base;
    if (v === 0x81) return !base;
    return (v & 1) === 1;
  }

  private applyChar(g: Uint8Array, f: Fmt, extra: { spec: boolean; pic: number; deleted: boolean; symbol?: string; ole: boolean }): void {
    for (const { op, arg } of sprms(g)) {
      const v = arg[0] ?? 0;
      switch (op) {
        case 0x0835:
          f.b = this.toggle(v, f.b);
          break;
        case 0x0836:
          f.i = this.toggle(v, f.i);
          break;
        case 0x0837:
        case 0x2a53:
          f.s = this.toggle(v, f.s);
          break;
        case 0x2a3e:
          f.u = v !== 0;
          break;
        case 0x2a48:
          f.sup = v === 1;
          f.sub = v === 2;
          break;
        case 0x4a4f: {
          const font = this.fonts[u16(arg, 0)] ?? '';
          f.code = MONO.test(font);
          break;
        }
        case 0x2a0c:
          if (HIGHLIGHT[v]) f.hl = HIGHLIGHT[v];
          else delete f.hl;
          break;
        case 0x4a30: {
          Object.assign(f, this.charStyle(u16(arg, 0)));
          break;
        }
        case 0x0855:
          extra.spec = v !== 0;
          break;
        case 0x6a03:
          extra.pic = u32(arg, 0);
          break;
        case 0x0800:
          extra.deleted = v !== 0;
          break;
        case 0x0801:
          if (v) this.tracked = true;
          break;
        case 0x080a:
          extra.ole = v !== 0;
          break;
        case 0x6a09: {
          const font = this.fonts[u16(arg, 0)] ?? '';
          const code = u16(arg, 2);
          extra.symbol = `${font}:${code}`;
          break;
        }
      }
    }
  }

  private charStyle(istd: number): Fmt {
    let hit = this.charStyleFmt.get(istd);
    if (hit) return hit;
    hit = {};
    const extra = { spec: false, pic: -1, deleted: false, ole: false };
    for (const st of this.styleChain(istd).reverse()) if (st.stk === 2) this.applyChar(st.chpx, hit, extra);
    this.charStyleFmt.set(istd, hit);
    return hit;
  }

  private charAt(cp: number): { fmt: Fmt; spec: boolean; pic: number; deleted: boolean; symbol?: string; ole: boolean } {
    const run = findRun(this.chpx, this.fcOf(cp));
    const fmt: Fmt = {};
    const extra = { spec: false, pic: -1, deleted: false, symbol: undefined as string | undefined, ole: false };
    if (run) this.applyChar(run.grpprl, fmt, extra);
    for (const k of Object.keys(fmt) as Array<keyof Fmt>) if (fmt[k] === false || fmt[k] === undefined) delete fmt[k];
    return { fmt, ...extra };
  }

  private props(info: ParaInfo): ParaProps {
    const props: ParaProps = { role: 'p' };
    for (const st of this.styleChain(info.istd)) {
      const r = roleFromName(st.name) ?? roleFromSti(st.sti);
      if (r) {
        props.role = r.role;
        props.level = r.level;
        break;
      }
    }
    if (props.role === 'p' && info.outline) {
      props.role = 'h';
      props.level = info.outline;
    }
    props.styleName = this.styles[info.istd]?.name;
    if (info.align) props.align = info.align;
    if (info.ilfo > 0 && info.ilfo <= this.lfos.length) {
      const lfo = this.lfos[info.ilfo - 1]!;
      const list = this.lists.get(lfo.lsid);
      if (list) props.list = this.listInfo(list, lfo, info.ilfo, Math.min(info.ilvl, list.levels.length - 1));
    }
    return props;
  }

  private listInfo(list: ListDef, lfo: LfoDef, ilfo: number, level: number): ListInfo {
    const formats: string[] = [];
    const starts: number[] = [];
    for (let l = 0; l <= level; l++) {
      const d = list.levels[l] ?? list.levels[0]!;
      formats.push(NFC[d.nfc] ?? 'decimal');
      starts.push(lfo.starts.get(l) ?? d.start);
    }
    const d = list.levels[level] ?? list.levels[0]!;
    const fmt = NFC[d.nfc] ?? 'decimal';
    return {
      ordered: fmt !== 'bullet' && fmt !== 'none',
      level,
      key: `lst${list.lsid}`,
      overrideKey: lfo.starts.size ? `lfo${ilfo}` : undefined,
      formats,
      starts,
      template: d.text,
    };
  }

  /* ------------------------------------------------------ building */

  private buf = '';
  private bufFmt: Fmt = {};

  private flush(): void {
    if (!this.buf) return;
    this.spans.push({ text: this.buf, fmt: this.bufFmt });
    this.buf = '';
  }

  private emitText(s: string, fmt: Fmt): void {
    const field = this.collecting();
    if (field) {
      field.result += s;
      return;
    }
    const href = this.linkHref();
    const f = href ? { ...fmt, href } : fmt;
    if (this.buf && !sameFmtLoose(f, this.bufFmt)) this.flush();
    if (!this.buf) this.bufFmt = f;
    this.buf += s;
  }

  private emitObject(obj: InlineObject, fmt: Fmt): void {
    if (this.collecting()) return;
    this.flush();
    const href = this.linkHref();
    this.spans.push({ text: OBJ_CHAR, fmt: href ? { ...fmt, href } : fmt, obj });
  }

  /** The innermost field whose result is being collected (hidden until the field ends), if any. */
  private collecting(): Field | undefined {
    for (let i = this.fields.length - 1; i >= 0; i--) {
      const f = this.fields[i]!;
      if (!f.inResult) return f;
      if (f.href !== undefined || f.passthrough) continue;
      return f;
    }
    return undefined;
  }

  private linkHref(): string | undefined {
    for (let i = this.fields.length - 1; i >= 0; i--) if (this.fields[i]!.href && this.fields[i]!.inResult) return this.fields[i]!.href;
    return undefined;
  }

  private endParagraph(info: ParaInfo): void {
    this.flush();
    const spans = normalizeSpans(this.spans);
    this.spans = [];
    const block: ParaBlock = { id: newId('p'), type: 'p', props: this.props(info), spans };
    const depth = info.inTable ? Math.max(1, info.itap) : 0;
    this.closeTablesDeeperThan(depth);
    if (!depth) {
      this.blocks.push(block);
      return;
    }
    while (this.tables.length < depth) this.tables.push({ rows: [], cells: [], blocks: [] });
    const t = this.tables[depth - 1]!;
    const rowEnd = depth === 1 ? info.ttp : info.innerTtp;
    if (rowEnd) {
      this.endRow(t, info);
      return;
    }
    t.blocks.push(block);
  }

  /** A cell mark: the paragraph just ended closes the current cell. */
  private endCell(depth: number): void {
    const t = this.tables[depth - 1];
    if (!t) return;
    t.cells.push({ blocks: t.blocks });
    t.blocks = [];
  }

  private endRow(t: TableBuilder, info: ParaInfo): void {
    const cells = t.cells;
    t.cells = [];
    t.blocks = [];
    const merges = info.merges ?? [];
    const out: TableCell[] = [];
    cells.forEach((c, i) => {
      const m = merges[i];
      if (m && (m.h === 2 || m.h === 3) && out.length) {
        const prev = out[out.length - 1]!;
        prev.colspan = (prev.colspan ?? 1) + 1;
        return;
      }
      if (m?.v === 3) c.vmerge = 'restart';
      else if (m?.v === 1) {
        c.vmerge = 'continue';
        c.blocks = [];
      }
      out.push(c);
    });
    t.rows.push({ id: newId('r'), cells: out, header: info.header || undefined });
  }

  private closeTablesDeeperThan(depth: number): void {
    while (this.tables.length > depth) {
      const t = this.tables.pop()!;
      if (t.blocks.length || t.cells.length) {
        // An unfinished row (a damaged file): keep its content.
        if (t.blocks.length) t.cells.push({ blocks: t.blocks });
        t.rows.push({ id: newId('r'), cells: t.cells });
      }
      if (!t.rows.length) continue;
      const block: Block = { id: newId('t'), type: 'table', rows: t.rows };
      const parent = this.tables[this.tables.length - 1];
      if (parent) parent.blocks.push(block);
      else this.blocks.push(block);
    }
  }

  run(): void {
    const end = Math.min(this.fib.ccpText, this.text.length);
    const text = this.text;
    let i = 0;
    while (i < end) {
      const ch = text.charCodeAt(i);
      if (ch === 0x0d || ch === 0x07 || (ch === 0x0c && this.isParagraphEnd(i))) {
        const info = this.paraInfo(i);
        this.fieldAtParagraphEnd();
        const depth = info.inTable ? Math.max(1, info.itap) : 0;
        const rowEnd = depth === 1 ? info.ttp : depth > 1 && info.innerTtp;
        const cellEnd = !rowEnd && (depth === 1 ? ch === 0x07 : depth > 1 && info.innerCell);
        this.endParagraph(info);
        if (cellEnd) this.endCell(depth);
        i++;
        continue;
      }
      const c = this.charAt(i);
      if (c.deleted) {
        this.tracked = true;
        i++;
        continue;
      }
      switch (ch) {
        case 0x13: {
          this.flush();
          this.fields.push({ instr: '', code: '', result: '', inResult: false, passthrough: false });
          i++;
          continue;
        }
        case 0x14: {
          const f = this.fields[this.fields.length - 1];
          if (f && !f.inResult) this.fieldSeparator(f);
          i++;
          continue;
        }
        case 0x15: {
          this.fieldEnd(c.fmt);
          i++;
          continue;
        }
      }
      const top = this.fields[this.fields.length - 1];
      if (top && !top.inResult) {
        // Field instruction text.
        if (ch >= 0x20) top.instr += text[i];
        i++;
        continue;
      }
      if (c.spec) {
        this.special(ch, i, c);
        i++;
        continue;
      }
      if (c.symbol) {
        const code = parseInt(c.symbol.split(':').pop()!, 10);
        this.emitObject({ kind: 'symbol', key: c.symbol, label: `Symbol (${c.symbol.split(':')[0]})`, text: String.fromCharCode(code >= 0xf000 ? code - 0xf000 : code) }, c.fmt);
        i++;
        continue;
      }
      let j = i;
      let s = '';
      // Consecutive plain characters with the same properties.
      const run = findRun(this.chpx, this.fcOf(i));
      while (j < end) {
        const cj = text.charCodeAt(j);
        if (cj === 0x0d || cj === 0x07 || cj === 0x0c || cj === 0x13 || cj === 0x14 || cj === 0x15 || cj < 0x09 || (cj > 0x0b && cj < 0x20 && cj !== 0x1e && cj !== 0x1f)) break;
        if (j > i && findRun(this.chpx, this.fcOf(j)) !== run) break;
        s += cj === 0x0b ? '\n' : cj === 0x1e ? '‑' : cj === 0x1f ? '\u00ad' : text[j];
        j++;
      }
      if (j === i) {
        // A control character with no meaning here.
        if (ch === 0x0c) this.emitObject({ kind: 'pagebreak', key: 'page', label: 'Page break' }, {});
        i++;
        continue;
      }
      this.emitText(s, c.fmt);
      i = j;
    }
    this.fields = [];
    this.flush();
    if (this.spans.length) this.endParagraph({ istd: 0, ilfo: 0, ilvl: 0, inTable: false, ttp: false, itap: 0, innerCell: false, innerTtp: false, header: false });
    this.closeTablesDeeperThan(0);
  }

  /**
   * A 0x0C character is either a page break inside a paragraph or a section
   * mark ending one. Paragraph marks always end a run of paragraph properties.
   */
  private isParagraphEnd(i: number): boolean {
    const fc = this.fcOf(i);
    const run = findRun(this.papx, fc);
    if (!run) return false;
    const piece = this.pieces.find((p) => i >= p.cp && i < p.cpEnd);
    return run.fcEnd === fc + (piece?.compressed ? 1 : 2);
  }

  private special(ch: number, cp: number, c: ReturnType<DocReader['charAt']>): void {
    switch (ch) {
      case 0x01: {
        if (c.ole) {
          this.emitObject({ kind: 'object', key: `obj:${c.pic}`, label: 'Embedded object' }, c.fmt);
          return;
        }
        const pic = c.pic >= 0 ? pictureAt(this.data, c.pic) : undefined;
        if (pic) {
          const src = imageUrl(pic.data, pic.mime);
          this.emitObject({ kind: 'image', key: `img:${hashBytes(pic.data)}`, label: 'Image', src, width: pic.w, height: pic.h, data: pic.data, mime: pic.mime }, c.fmt);
        } else {
          this.emitObject({ kind: 'image', key: `img:doc:${c.pic}`, label: 'Picture' }, c.fmt);
        }
        return;
      }
      case 0x08:
        this.emitObject({ kind: 'object', key: 'shape', label: 'Drawing' }, c.fmt);
        return;
      case 0x02: {
        const note = this.notes.get(cp);
        if (note) this.emitObject(note, c.fmt);
        return;
      }
      case 0x05:
        this.comments = true;
        return;
      default:
        return;
    }
  }

  private fieldSeparator(f: Field): void {
    f.inResult = true;
    f.code = f.instr.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
    if (f.code === 'HYPERLINK') {
      const m = /HYPERLINK\s+(?:\\l\s+)?"([^"]*)"/i.exec(f.instr) ?? /HYPERLINK\s+(\S+)/i.exec(f.instr);
      f.href = m ? (/\\l\s+"/i.test(f.instr) ? '#' + m[1] : m[1]!) : '';
    }
  }

  /** A paragraph mark inside a field result: the field spans paragraphs (a table of contents). */
  private fieldAtParagraphEnd(): void {
    const f = this.collecting();
    if (!f || !f.inResult) return;
    f.passthrough = true;
    if (INDEX_FIELDS[f.code] && !this.tables.length) f.startBlock = this.blocks.length;
    const text = f.result;
    f.result = '';
    if (text) this.emitText(text, {});
  }

  private fieldEnd(fmt: Fmt): void {
    const f = this.fields.pop();
    if (!f) return;
    if (!f.inResult) this.fieldSeparator(f);
    if (f.href !== undefined) {
      this.flush();
      return;
    }
    if (f.passthrough) {
      if (f.startBlock !== undefined && !this.tables.length) {
        this.flush();
        // The index's own title ("Contents") belongs to it.
        const prev = this.blocks[f.startBlock - 1];
        if (prev?.type === 'p' && /\b(toc|contents|index) heading$/i.test(prev.props.styleName ?? '')) f.startBlock--;
        const inner = this.blocks.splice(f.startBlock);
        if (this.spans.length) {
          inner.push({ id: newId('p'), type: 'p', props: { role: 'p' }, spans: normalizeSpans(this.spans) });
          this.spans = [];
        }
        this.blocks.push({ id: newId('o'), type: 'opaque', label: INDEX_FIELDS[f.code]!, blocks: inner });
      }
      return;
    }
    if (!f.code && !f.result) return;
    this.emitObject({ kind: 'field', key: fieldKey(f.code, f.result), label: f.code ? `Field: ${f.code}` : 'Field', text: f.result }, fmt);
  }
}

function sameFmtLoose(a: Fmt, b: Fmt): boolean {
  return (
    !!a.b === !!b.b &&
    !!a.i === !!b.i &&
    !!a.u === !!b.u &&
    !!a.s === !!b.s &&
    !!a.sup === !!b.sup &&
    !!a.sub === !!b.sub &&
    !!a.code === !!b.code &&
    (a.href ?? '') === (b.href ?? '') &&
    (a.hl ?? '') === (b.hl ?? '')
  );
}

const urls = new Map<string, string>();

function imageUrl(data: Uint8Array, mime: string): string | undefined {
  const key = hashBytes(data);
  let url = urls.get(key);
  if (url || typeof URL.createObjectURL !== 'function') return url;
  try {
    url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
    urls.set(key, url);
  } catch {
    /* no preview */
  }
  return url;
}

export function readDoc(data: Uint8Array, name: string): Doc {
  let cfb: Cfb;
  try {
    cfb = new Cfb(data);
  } catch {
    throw new Error('This file is not a Word 97–2003 document.');
  }
  const wd = cfb.stream('WordDocument');
  if (!wd) {
    if (cfb.stream('EncryptedPackage')) throw new Error('This document is password protected. Remove the password in Word, save it, and load it again.');
    throw new Error('This file is not a Word document (it has no WordDocument stream).');
  }
  const fib = readFib(wd);
  const table = cfb.stream(fib.flags & 0x0200 ? '1Table' : '0Table');
  if (!table) throw new Error('The document’s table stream is missing.');
  const reader = new DocReader(wd, table, cfb.stream('Data'), fib);
  reader.run();
  const notes: string[] = [];
  if (reader.tracked) notes.push('Tracked changes are compared as if they were all accepted.');
  if (reader.comments) notes.push('Comments are not compared.');
  notes.push('Word 97–2003 files are read only: exports are saved as a new file (Word .docx keeps the most).');
  return { id: newId('d'), name, kind: 'doc', blocks: reader.blocks, version: 0, ext: 'doc', formatLabel: 'Word 97', notes };
}
