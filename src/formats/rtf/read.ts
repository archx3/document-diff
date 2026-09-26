import type { Block, Doc, Fmt, InlineObject, ListInfo, ParaBlock, ParaProps, Span, TableCell, TableRow } from '../../core/model';
import { OBJ_CHAR, fieldKey, hashBytes, newId, normalizeSpans, roleFromName, sameFmt } from '../../core/model';

/**
 * Rich Text Format reader. Handles the parts of RTF that carry document
 * content: character and paragraph formatting, style names (for headings),
 * lists, tables, hyperlinks, footnotes, pictures, Unicode and code pages.
 */

/* --------------------------------------------------------------- tokens */

type Token =
  | { t: 'open' }
  | { t: 'close' }
  | { t: 'word'; word: string; param: number | null }
  | { t: 'sym'; ch: string }
  | { t: 'hex'; byte: number }
  | { t: 'text'; bytes: number[] }
  | { t: 'bin'; bytes: Uint8Array };

function isLetter(b: number): boolean {
  return (b >= 0x61 && b <= 0x7a) || (b >= 0x41 && b <= 0x5a);
}

function isDigit(b: number): boolean {
  return b >= 0x30 && b <= 0x39;
}

function hexVal(b: number): number {
  if (b >= 0x30 && b <= 0x39) return b - 0x30;
  if (b >= 0x61 && b <= 0x66) return b - 0x57;
  if (b >= 0x41 && b <= 0x46) return b - 0x37;
  return -1;
}

export function* tokenize(data: Uint8Array): Generator<Token> {
  let i = 0;
  const n = data.length;
  let text: number[] = [];
  const flush = function* (): Generator<Token> {
    if (text.length) {
      yield { t: 'text', bytes: text };
      text = [];
    }
  };
  while (i < n) {
    const b = data[i]!;
    if (b === 0x7b) {
      yield* flush();
      yield { t: 'open' };
      i++;
    } else if (b === 0x7d) {
      yield* flush();
      yield { t: 'close' };
      i++;
    } else if (b === 0x5c) {
      yield* flush();
      i++;
      if (i >= n) break;
      const c = data[i]!;
      if (isLetter(c)) {
        let j = i;
        while (j < n && isLetter(data[j]!) && j - i < 32) j++;
        const word = String.fromCharCode(...data.subarray(i, j));
        let param: number | null = null;
        let k = j;
        let neg = false;
        if (data[k] === 0x2d && isDigit(data[k + 1] ?? 0)) {
          neg = true;
          k++;
        }
        if (isDigit(data[k] ?? 0)) {
          let v = 0;
          while (k < n && isDigit(data[k]!)) v = v * 10 + (data[k++]! - 0x30);
          param = neg ? -v : v;
        } else {
          k = j;
        }
        if (data[k] === 0x20) k++;
        i = k;
        if (word === 'bin' && param !== null && param > 0) {
          yield { t: 'bin', bytes: data.subarray(i, i + param) };
          i += param;
          continue;
        }
        yield { t: 'word', word, param };
      } else if (c === 0x27) {
        const hi = hexVal(data[i + 1] ?? 0);
        const lo = hexVal(data[i + 2] ?? 0);
        if (hi >= 0 && lo >= 0) {
          yield { t: 'hex', byte: hi * 16 + lo };
          i += 3;
        } else {
          i++;
        }
      } else if (c === 0x0d || c === 0x0a) {
        // "\" followed by a line break is a paragraph mark.
        yield { t: 'word', word: 'par', param: null };
        i++;
      } else {
        yield { t: 'sym', ch: String.fromCharCode(c) };
        i++;
      }
    } else if (b === 0x0d || b === 0x0a) {
      i++;
    } else {
      text.push(b);
      i++;
    }
  }
  yield* flush();
}

/* --------------------------------------------------------------- state */

const CHARSET_CODEPAGE: Record<number, string> = {
  77: 'x-mac-roman',
  128: 'shift_jis',
  129: 'euc-kr',
  134: 'gbk',
  136: 'big5',
  161: 'windows-1253',
  162: 'windows-1254',
  163: 'windows-1258',
  177: 'windows-1255',
  178: 'windows-1256',
  186: 'windows-1257',
  204: 'windows-1251',
  222: 'windows-874',
  238: 'windows-1250',
};

const decoders = new Map<string, TextDecoder>();
function decode(bytes: number[], encoding: string): string {
  let d = decoders.get(encoding);
  if (!d) {
    try {
      d = new TextDecoder(encoding);
    } catch {
      d = new TextDecoder('windows-1252');
    }
    decoders.set(encoding, d);
  }
  return d.decode(new Uint8Array(bytes));
}

/** Symbol-font bytes that Word uses for bullets. */
const SYMBOL_CHARS: Record<number, string> = { 0xb7: '•', 0xa7: '▪', 0xd8: '➢', 0xfc: '✓', 0x76: '❖', 0x6f: '○', 0x2d: '–' };

interface Font {
  family: string;
  charset: number;
  name: string;
}

interface ParaState {
  style: number;
  align?: ParaProps['align'];
  ls: number;
  ilvl: number;
  intbl: boolean;
  itap: number;
  outline: number | null;
  pnKind: 'bullet' | 'number' | null;
  pnLevel: number;
}

const FMT_WORDS = new Set(['b', 'i', 'strike', 'ul', 'uld', 'uldb', 'ulw', 'ulnone']);

const newPara = (): ParaState => ({ style: 0, ls: 0, ilvl: 0, intbl: false, itap: 0, outline: null, pnKind: null, pnLevel: 0 });

interface GroupState {
  /** Where text goes: 'body', a named destination, or 'skip'. */
  dest: string;
  fmt: Fmt;
  uc: number;
  font: number;
  para: ParaState;
  /** Skip the next group (used for \upr's ANSI half). */
  skipNextGroup: boolean;
  /** This group started a \field. */
  field: boolean;
  /** Text marked as a tracked deletion. */
  deleted: boolean;
}

interface CellDef {
  vmerge?: 'restart' | 'continue';
  hmerge?: 'first' | 'cont';
}

/** A table being built; nested tables stack one per nesting level. */
interface TableBuilder {
  rows: TableRow[];
  rowCells: TableCell[];
  cellBlocks: Block[];
  rowDef: CellDef[];
  cellDef: CellDef;
  rowHeader: boolean;
}

const newTable = (): TableBuilder => ({ rows: [], rowCells: [], cellBlocks: [], rowDef: [], cellDef: {}, rowHeader: false });

interface ListDef {
  levels: Array<{ nfc: number; start: number }>;
}

const NFC_FORMAT: Record<number, string> = { 0: 'decimal', 1: 'upperRoman', 2: 'lowerRoman', 3: 'upperLetter', 4: 'lowerLetter', 22: 'decimalZero', 23: 'bullet', 255: 'none' };

const SKIP_DESTINATIONS = new Set([
  'colortbl',
  'info',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
  'pntext',
  'listtext',
  'nonshppict',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'datastore',
  'xmlnstbl',
  'rsidtbl',
  'generator',
  'xmlopen',
  'xmlclose',
  'bkmkstart',
  'bkmkend',
  'annotation',
  'atnid',
  'atnauthor',
  'atndate',
  'atnref',
  'atrfstart',
  'atrfend',
  'object',
  'objdata',
  'shpinst',
  'shprslt',
  'sp',
  'sn',
  'sv',
  'template',
  'revtbl',
  'filetbl',
  'pgdsctbl',
  'mmathPr',
  'defchp',
  'defpap',
  'wgrffmtfilter',
  'fonttbl_ignored',
  'userprops',
  'docvar',
  'protusertbl',
  'ftnsep',
  'ftnsepc',
  'aftnsep',
  'aftnsepc',
  'pn_text',
  'fldtype',
  'listpicture',
  'blipuid',
  'passwordhash',
  'panose',
  'falt',
  'fname',
  'mhtmltag',
  'htmltag',
  'nonesttables',
]);

/* -------------------------------------------------------------- reader */

class RtfReader {
  private stack: GroupState[] = [];
  private st: GroupState = { dest: 'body', fmt: {}, uc: 1, font: 0, para: newPara(), skipNextGroup: false, field: false, deleted: false };
  private codepage = 'windows-1252';
  private defaultFont = 0;
  private fonts = new Map<number, Font>();
  private styles = new Map<number, string>();
  /** Character formatting each paragraph style applies (repeated inline by RTF writers). */
  private styleFmt = new Map<number, Fmt>();
  private lists = new Map<number, ListDef>(); // by listid
  private overrides = new Map<number, number>(); // ls -> listid
  private ucSkip = 0;
  private hexBuf: number[] = [];

  readonly blocks: Block[] = [];
  private spans: Span[] = [];
  private textBuf = '';
  private textFmt: Fmt = {};
  /** Tables in progress, outermost first (index = nesting level - 1). */
  private tables: TableBuilder[] = [];
  // Destination buffers
  private destText = '';
  private fontDraft: Partial<Font> & { num?: number } = {};
  private styleDraft: { num?: number; isPara: boolean; fmt?: Fmt } = { isPara: true };
  private listDraft: { id?: number; levels: Array<{ nfc: number; start: number }>; level?: { nfc: number; start: number } } = { levels: [] };
  private overrideDraft: { listid?: number; ls?: number } = {};
  private fieldInst = '';
  private fieldStack: Array<{ href?: string; code?: string; result?: string; passthrough?: boolean; startBlock?: number }> = [];
  private note: { text: string; depth: number } | null = null;
  private pict: { hex: string[]; type: string; w?: number; h?: number; wg?: number; hg?: number } | null = null;

  constructor(private readonly data: Uint8Array) {}

  run(): void {
    for (const tok of tokenize(this.data)) {
      if (tok.t !== 'hex') this.flushHex();
      switch (tok.t) {
        case 'open':
          this.stack.push(this.st);
          this.st = { ...this.st, fmt: { ...this.st.fmt }, para: { ...this.st.para }, skipNextGroup: false, field: false };
          if (this.stack[this.stack.length - 1]!.skipNextGroup) {
            this.stack[this.stack.length - 1]!.skipNextGroup = false;
            this.st.dest = 'skip';
          }
          break;
        case 'close':
          this.endGroup();
          break;
        case 'word':
          this.word(tok.word, tok.param);
          break;
        case 'sym':
          this.symbol(tok.ch);
          break;
        case 'hex':
          if (this.ucSkip > 0) {
            this.ucSkip--;
            break;
          }
          this.hexBuf.push(tok.byte);
          break;
        case 'text':
          this.textBytes(tok.bytes);
          break;
        case 'bin':
          if (this.pict) this.pict.hex.push(Array.from(tok.bytes, (b) => b.toString(16).padStart(2, '0')).join(''));
          break;
      }
    }
    this.flushHex();
    this.endParagraph(false);
    this.endTable();
  }

  /* ----------------------------------------------------- text output */

  private encodingForFont(): string {
    const f = this.fonts.get(this.st.font);
    if (f && CHARSET_CODEPAGE[f.charset]) return CHARSET_CODEPAGE[f.charset]!;
    return this.codepage;
  }

  private isSymbolFont(): boolean {
    const f = this.fonts.get(this.st.font);
    return !!f && (f.charset === 2 || /^(symbol|wingdings)/i.test(f.name));
  }

  private flushHex(): void {
    if (!this.hexBuf.length) return;
    const bytes = this.hexBuf;
    this.hexBuf = [];
    if (this.isSymbolFont()) this.emitText(bytes.map((b) => SYMBOL_CHARS[b] ?? String.fromCharCode(b)).join(''));
    else this.emitText(decode(bytes, this.encodingForFont()));
  }

  private textBytes(bytes: number[]): void {
    let out = bytes;
    if (this.ucSkip > 0) {
      const skip = Math.min(this.ucSkip, out.length);
      this.ucSkip -= skip;
      out = out.slice(skip);
    }
    if (!out.length) return;
    // Plain ASCII is the common case; high bytes are in the document's code page.
    if (out.every((b) => b < 0x80)) this.emitText(String.fromCharCode(...out));
    else this.emitText(decode(out, this.encodingForFont()));
  }

  private emitText(s: string): void {
    if (!s) return;
    const d = this.st.dest;
    if (d === 'skip' || this.st.deleted) return;
    if (d === 'fldinst') {
      this.fieldInst += s;
      return;
    }
    if (d === 'fonttbl') {
      for (const ch of s) {
        if (ch === ';') this.finishFont();
        else this.destText += ch;
      }
      return;
    }
    if (d === 'stylesheet' || d === 'listname' || d === 'leveltext' || d === 'levelnumbers') {
      this.destText += s;
      return;
    }
    if (d === 'pict') {
      this.pict?.hex.push(s.replace(/[^0-9a-fA-F]/g, ''));
      return;
    }
    if (d === 'footnote') {
      if (this.note) this.note.text += s;
      return;
    }
    if (d !== 'body' && d !== 'fldrslt') return;
    const field = this.collectingField();
    if (field) {
      field.result += s;
      return;
    }
    const fmt = this.currentFmt();
    if (this.textBuf && !sameFmt(fmt, this.textFmt)) this.flushText();
    if (!this.textBuf) this.textFmt = fmt;
    this.textBuf += s;
  }

  /** The innermost non-link field whose result is being collected, if any. */
  private collectingField(): { code?: string; result?: string; passthrough?: boolean; startBlock?: number } | undefined {
    if (this.st.dest !== 'fldrslt' && !this.stack.some((g) => g.dest === 'fldrslt')) return undefined;
    const top = this.fieldStack[this.fieldStack.length - 1];
    return top && top.result !== undefined && !top.passthrough ? top : undefined;
  }

  private currentFmt(): Fmt {
    const f: Fmt = { ...this.st.fmt };
    const href = [...this.fieldStack].reverse().find((x) => x.href)?.href;
    if (href && (this.st.dest === 'fldrslt' || this.stack.some((g) => g.dest === 'fldrslt'))) f.href = href;
    const font = this.fonts.get(this.st.font);
    if (font && (font.family === 'fmodern' || /courier|consolas|mono|menlo/i.test(font.name))) f.code = true;
    for (const k of Object.keys(f) as Array<keyof Fmt>) if (f[k] === false || f[k] === undefined) delete f[k];
    return f;
  }

  private flushText(): void {
    if (!this.textBuf) return;
    this.spans.push({ text: this.textBuf, fmt: this.textFmt });
    this.textBuf = '';
  }

  private emitObject(obj: InlineObject): void {
    if (this.st.dest !== 'body' && this.st.dest !== 'fldrslt') return;
    this.flushText();
    this.spans.push({ text: OBJ_CHAR, fmt: this.currentFmt(), obj });
  }

  /* --------------------------------------------------- paragraphs */

  private paraProps(p: ParaState): ParaProps {
    const props: ParaProps = { role: 'p' };
    const name = this.styles.get(p.style);
    const r = name ? roleFromName(name) : undefined;
    if (r) {
      props.role = r.role;
      if (r.level) props.level = r.level;
      props.styleName = name;
    } else if (p.outline !== null && p.outline >= 0 && p.outline < 9) {
      props.role = 'h';
      props.level = p.outline + 1;
    }
    if (p.align) props.align = p.align;
    const list = this.listInfo(p);
    if (list) props.list = list;
    return props;
  }

  private listInfo(p: ParaState): ListInfo | undefined {
    if (p.ls > 0) {
      const id = this.overrides.get(p.ls) ?? p.ls;
      const def = this.lists.get(id);
      const lvl = Math.max(0, Math.min(8, p.ilvl));
      const levels = def?.levels ?? [];
      const at = (l: number) => levels[l] ?? { nfc: 0, start: 1 };
      const formats = Array.from({ length: lvl + 1 }, (_, l) => NFC_FORMAT[at(l).nfc] ?? 'decimal');
      const starts = Array.from({ length: lvl + 1 }, (_, l) => at(l).start);
      const own = at(lvl).nfc;
      return { ordered: own !== 23 && own !== 255, level: lvl, key: `rtf-ls${p.ls}`, formats, starts, template: own === 23 ? '•' : undefined };
    }
    if (p.pnKind) return { ordered: p.pnKind === 'number', level: Math.max(0, p.pnLevel - 1), key: `rtf-pn${p.pnKind}` };
    return undefined;
  }

  /** Ends the current paragraph (at \par, \cell or end of input). */
  private endParagraph(force: boolean, para: ParaState = this.st.para): void {
    this.flushText();
    const inherited = this.styleFmt.get(para.style);
    if (inherited) {
      // Formatting that only repeats the paragraph style is not direct formatting.
      for (const sp of this.spans) {
        if (sp.fmt === undefined) continue;
        const f = { ...sp.fmt };
        if (inherited.b && f.b) delete f.b;
        if (inherited.i && f.i) delete f.i;
        if (inherited.u && f.u) delete f.u;
        if (inherited.s && f.s) delete f.s;
        sp.fmt = f;
      }
    }
    const spans = normalizeSpans(this.spans);
    this.spans = [];
    if (!force && !spans.length) return;
    const block: ParaBlock = { id: newId('p'), type: 'p', props: this.paraProps(para), spans };
    const depth = para.intbl ? Math.max(1, para.itap) : 0;
    this.closeTablesDeeperThan(depth);
    if (depth) {
      this.tableAt(depth).cellBlocks.push(block);
      return;
    }
    this.blocks.push(block);
  }

  private level(): number {
    const p = this.st.para;
    return p.intbl ? Math.max(1, p.itap) : 0;
  }

  /** The table builder at a nesting level, creating it (and any missing parents). */
  private tableAt(depth: number): TableBuilder {
    while (this.tables.length < depth) this.tables.push(newTable());
    return this.tables[depth - 1]!;
  }

  /** Finishes nested tables below `depth`; each lands in its parent's current cell (or the body). */
  private closeTablesDeeperThan(depth: number): void {
    while (this.tables.length > depth) {
      const t = this.tables.pop()!;
      if (t.rowCells.length || t.cellBlocks.length) this.finishRow(t);
      if (!t.rows.length) continue;
      const block: Block = { id: newId('t'), type: 'table', rows: t.rows };
      if (this.tables.length) this.tables[this.tables.length - 1]!.cellBlocks.push(block);
      else this.blocks.push(block);
    }
  }

  private endCell(depth: number): void {
    this.endParagraph(true, { ...this.st.para, intbl: true, itap: depth });
    this.closeTablesDeeperThan(depth);
    const t = this.tableAt(depth);
    const def = t.rowDef[t.rowCells.length] ?? {};
    const cell: TableCell = { blocks: t.cellBlocks };
    if (def.vmerge) cell.vmerge = def.vmerge;
    t.rowCells.push(cell);
    t.cellBlocks = [];
  }

  private endRow(depth: number): void {
    this.flushText();
    if (this.spans.length) this.endCell(depth);
    this.closeTablesDeeperThan(depth);
    this.finishRow(this.tableAt(depth));
  }

  private finishRow(t: TableBuilder): void {
    if (t.cellBlocks.length) {
      t.rowCells.push({ blocks: t.cellBlocks });
      t.cellBlocks = [];
    }
    // Horizontally merged cells fold into the first one.
    const cells: TableCell[] = [];
    t.rowCells.forEach((c, i) => {
      const def = t.rowDef[i] ?? {};
      if (def.hmerge === 'cont' && cells.length) cells[cells.length - 1]!.colspan = (cells[cells.length - 1]!.colspan ?? 1) + 1;
      else cells.push(c);
    });
    if (cells.length) t.rows.push({ id: newId('r'), cells, header: t.rowHeader || undefined });
    t.rowCells = [];
  }

  private endTable(): void {
    this.closeTablesDeeperThan(0);
  }

  /* ---------------------------------------------------- control words */

  private word(w: string, p: number | null): void {
    // Destinations.
    if (this.st.dest === 'skip') return;
    if (this.pendingIgnorable) {
      this.pendingIgnorable = false;
      if (!KNOWN_IGNORABLE.has(w)) {
        this.st.dest = 'skip';
        return;
      }
    }
    switch (w) {
      case 'rtf':
        return;
      case 'ansicpg':
        if (p) this.codepage = p === 10000 ? 'x-mac-roman' : p === 65001 ? 'utf-8' : `windows-${p}`;
        if (p === 932) this.codepage = 'shift_jis';
        if (p === 936) this.codepage = 'gbk';
        if (p === 949) this.codepage = 'euc-kr';
        if (p === 950) this.codepage = 'big5';
        return;
      case 'mac':
        this.codepage = 'x-mac-roman';
        return;
      case 'deff':
        this.defaultFont = p ?? 0;
        this.st.font = this.defaultFont;
        return;
      case 'fonttbl':
        this.st.dest = 'fonttbl';
        this.destText = '';
        this.fontDraft = {};
        return;
      case 'stylesheet':
        this.st.dest = 'stylesheet';
        this.destText = '';
        this.styleDraft = { isPara: true, num: 0 };
        return;
      case 'listtable':
        this.st.dest = 'listtable';
        return;
      case 'listoverridetable':
        this.st.dest = 'listoverridetable';
        return;
      case 'list':
        if (this.st.dest === 'listtable') {
          this.st.dest = 'list';
          this.listDraft = { levels: [] };
        }
        return;
      case 'listlevel':
        if (this.st.dest === 'list') {
          this.st.dest = 'listlevel';
          this.listDraft.level = { nfc: 0, start: 1 };
        }
        return;
      case 'levelnfc':
      case 'levelnfcn':
        if (this.listDraft.level && p !== null) this.listDraft.level.nfc = p;
        return;
      case 'levelstartat':
        if (this.listDraft.level && p !== null) this.listDraft.level.start = p;
        return;
      case 'leveltext':
      case 'levelnumbers':
        this.st.dest = w;
        return;
      case 'listname':
        this.st.dest = 'listname';
        return;
      case 'listid':
        if (this.st.dest === 'list') this.listDraft.id = p ?? 0;
        else if (this.st.dest === 'listoverride') this.overrideDraft.listid = p ?? 0;
        return;
      case 'listoverride':
        if (this.st.dest === 'listoverridetable') {
          this.st.dest = 'listoverride';
          this.overrideDraft = {};
        }
        return;
      case 'ls':
        if (this.st.dest === 'listoverride') this.overrideDraft.ls = p ?? 0;
        else this.st.para.ls = p ?? 0;
        return;
      case 'ilvl':
        this.st.para.ilvl = p ?? 0;
        return;
      case 'field':
        this.fieldStack.push({});
        this.st.field = true;
        return;
      case 'fldinst':
        this.st.dest = 'fldinst';
        this.fieldInst = '';
        return;
      case 'fldrslt':
        this.st.dest = 'fldrslt';
        return;
      case 'footnote':
        if (this.st.dest === 'body' || this.st.dest === 'fldrslt') {
          this.flushText();
          this.note = { text: '', depth: this.stack.length };
          this.st.dest = 'footnote';
        } else {
          this.st.dest = 'skip';
        }
        return;
      case 'chftn':
        return;
      case 'pict':
        if (this.st.dest === 'body' || this.st.dest === 'fldrslt') {
          this.pict = { hex: [], type: '' };
          this.st.dest = 'pict';
        } else this.st.dest = 'skip';
        return;
      case 'pngblip':
      case 'jpegblip':
      case 'emfblip':
      case 'wmetafile':
      case 'macpict':
      case 'dibitmap':
      case 'wbitmap':
        if (this.pict) this.pict.type = w;
        return;
      case 'picw':
        if (this.pict) this.pict.w = p ?? undefined;
        return;
      case 'pich':
        if (this.pict) this.pict.h = p ?? undefined;
        return;
      case 'picwgoal':
        if (this.pict) this.pict.wg = p ?? undefined;
        return;
      case 'pichgoal':
        if (this.pict) this.pict.hg = p ?? undefined;
        return;
      case 'shppict':
        return;
      case 'upr':
        this.st.skipNextGroup = true;
        return;
      case 'ud':
        return;
      case 'pn':
        this.st.dest = 'pn';
        return;
      case 'pnlvlblt':
        this.st.para.pnKind = 'bullet';
        this.st.para.pnLevel = 1;
        this.propagatePn();
        return;
      case 'pnlvlbody':
        this.st.para.pnKind = 'number';
        this.st.para.pnLevel = 1;
        this.propagatePn();
        return;
      case 'pnlvl':
        this.st.para.pnKind = 'number';
        this.st.para.pnLevel = p ?? 1;
        this.propagatePn();
        return;
    }
    if (SKIP_DESTINATIONS.has(w)) {
      this.st.dest = 'skip';
      return;
    }
    // In the font table and style sheet, collect definitions.
    if (this.st.dest === 'fonttbl') {
      if (w === 'f') this.fontDraft = { num: p ?? 0 };
      else if (/^f(nil|roman|swiss|modern|script|decor|tech|bidi)$/.test(w)) this.fontDraft.family = w;
      else if (w === 'fcharset') this.fontDraft.charset = p ?? 0;
      return;
    }
    if (this.st.dest === 'stylesheet') {
      if (w === 's') this.styleDraft = { num: p ?? 0, isPara: true, fmt: this.styleDraft.fmt };
      else if (w === 'cs' || w === 'ds' || w === 'ts' || w === 'tsrowd') this.styleDraft = { num: p ?? 0, isPara: false };
      else if (FMT_WORDS.has(w)) {
        const f = (this.styleDraft.fmt ??= {});
        const on = p === null || p !== 0;
        if (w === 'b') f.b = on;
        else if (w === 'i') f.i = on;
        else if (w === 'strike') f.s = on;
        else if (w === 'ulnone') f.u = false;
        else f.u = on;
      }
      return;
    }
    if (this.st.dest !== 'body' && this.st.dest !== 'fldrslt' && this.st.dest !== 'footnote') return;
    this.bodyWord(w, p);
  }

  private propagatePn(): void {
    // \pn lives in its own group; copy the list kind to the enclosing paragraph state.
    const parent = this.stack[this.stack.length - 1];
    if (parent) {
      parent.para.pnKind = this.st.para.pnKind;
      parent.para.pnLevel = this.st.para.pnLevel;
    }
  }

  private pendingIgnorable = false;

  private bodyWord(w: string, p: number | null): void {
    const on = p === null || p !== 0;
    const f = this.st.fmt;
    const inNote = this.st.dest === 'footnote';
    switch (w) {
      case 'par': {
        if (inNote) {
          if (this.note && this.note.text && !this.note.text.endsWith(' ')) this.note.text += ' ';
          return;
        }
        const field = this.collectingField();
        if (field) {
          // A field spanning paragraphs (a table of contents): show its result as ordinary text.
          const text = field.result ?? '';
          field.passthrough = true;
          // Tables of contents and indexes become one block, like Word's own.
          if (INDEX_FIELDS[field.code ?? ''] && !this.tables.length) field.startBlock = this.blocks.length;
          this.emitText(text);
        }
        this.endParagraph(true);
        return;
      }
      case 'sect':
      case 'sectd':
        return;
      case 'line':
        this.emitText('\n');
        return;
      case 'tab':
        this.emitText('\t');
        return;
      case 'page':
        if (!inNote) this.emitObject({ kind: 'pagebreak', key: 'page', label: 'Page break' });
        return;
      case 'emdash':
        this.emitText('—');
        return;
      case 'endash':
        this.emitText('–');
        return;
      case 'emspace':
        this.emitText('\u2003');
        return;
      case 'enspace':
        this.emitText('\u2002');
        return;
      case 'qmspace':
        this.emitText('\u2005');
        return;
      case 'bullet':
        this.emitText('•');
        return;
      case 'lquote':
        this.emitText('‘');
        return;
      case 'rquote':
        this.emitText('’');
        return;
      case 'ldblquote':
        this.emitText('“');
        return;
      case 'rdblquote':
        this.emitText('”');
        return;
      case 'zwj':
        this.emitText('\u200d');
        return;
      case 'zwnj':
        this.emitText('\u200c');
        return;
      case 'u': {
        let code = p ?? 0;
        if (code < 0) code += 65536;
        this.flushHex();
        this.emitText(String.fromCharCode(code));
        this.ucSkip = this.st.uc;
        return;
      }
      case 'uc':
        this.st.uc = p ?? 1;
        return;
      // Character formatting.
      case 'plain':
        this.st.fmt = {};
        this.st.font = this.defaultFont;
        this.st.deleted = false;
        return;
      case 'deleted':
        this.st.deleted = on;
        return;
      case 'b':
        f.b = on;
        return;
      case 'i':
        f.i = on;
        return;
      case 'ul':
      case 'uld':
      case 'uldash':
      case 'uldashd':
      case 'uldashdd':
      case 'uldb':
      case 'ulth':
      case 'ulw':
      case 'ulwave':
      case 'ulhwave':
      case 'ululdbwave':
        f.u = on;
        return;
      case 'ulnone':
        f.u = false;
        return;
      case 'strike':
      case 'striked':
        f.s = on;
        return;
      case 'super':
        f.sup = true;
        f.sub = false;
        return;
      case 'sub':
        f.sub = true;
        f.sup = false;
        return;
      case 'nosupersub':
        f.sup = false;
        f.sub = false;
        return;
      case 'highlight':
        if (p) f.hl = 'yellow';
        else delete f.hl;
        return;
      case 'f':
        this.st.font = p ?? 0;
        return;
      // Paragraph formatting.
      case 'pard':
        this.st.para = { ...newPara(), itap: 0 };
        return;
      case 's':
        this.st.para.style = p ?? 0;
        return;
      case 'ql':
        delete this.st.para.align;
        return;
      case 'qc':
        this.st.para.align = 'center';
        return;
      case 'qr':
        this.st.para.align = 'right';
        return;
      case 'qj':
      case 'qd':
        this.st.para.align = 'justify';
        return;
      case 'outlinelevel':
        this.st.para.outline = p;
        return;
      case 'intbl':
        this.st.para.intbl = true;
        return;
      case 'itap':
        this.st.para.itap = p ?? 0;
        if ((p ?? 0) > 0) this.st.para.intbl = true;
        return;
      // Tables.
      case 'trowd': {
        const t = this.tableAt(Math.max(1, this.level()));
        t.rowDef = [];
        t.cellDef = {};
        t.rowHeader = false;
        return;
      }
      case 'trhdr':
        this.tableAt(Math.max(1, this.level())).rowHeader = true;
        return;
      case 'clvmgf':
        this.tableAt(Math.max(1, this.level())).cellDef.vmerge = 'restart';
        return;
      case 'clvmrg':
        this.tableAt(Math.max(1, this.level())).cellDef.vmerge = 'continue';
        return;
      case 'clmgf':
        this.tableAt(Math.max(1, this.level())).cellDef.hmerge = 'first';
        return;
      case 'clmrg':
        this.tableAt(Math.max(1, this.level())).cellDef.hmerge = 'cont';
        return;
      case 'cellx': {
        const t = this.tableAt(Math.max(1, this.level()));
        t.rowDef.push(t.cellDef);
        t.cellDef = {};
        return;
      }
      case 'cell':
        this.endCell(1);
        return;
      case 'row':
        this.endRow(1);
        return;
      case 'nestcell':
        this.endCell(Math.max(2, this.level()));
        return;
      case 'nestrow':
        this.endRow(Math.max(2, this.level()));
        return;
    }
  }

  private symbol(ch: string): void {
    if (this.st.dest === 'skip') return;
    switch (ch) {
      case '*':
        this.pendingIgnorable = true;
        return;
      case '\\':
      case '{':
      case '}':
        this.emitText(ch);
        return;
      case '~':
        this.emitText('\u00a0');
        return;
      case '-':
        this.emitText('\u00ad');
        return;
      case '_':
        this.emitText('‑');
        return;
      case '\t':
        this.emitText('\t');
        return;
    }
  }

  private endGroup(): void {
    const leaving = this.st;
    const d = leaving.dest;
    const parent = this.stack.pop();
    if (!parent) return;
    // Finish whatever the closing group defined.
    if (d === 'fonttbl' && this.destText.trim()) this.finishFont();
    if (d === 'stylesheet' && this.styleDraft.num !== undefined) {
      const name = this.destText.replace(/;.*$/s, '').trim();
      if (name && this.styleDraft.isPara) {
        this.styles.set(this.styleDraft.num, name);
        if (this.styleDraft.fmt) this.styleFmt.set(this.styleDraft.num, this.styleDraft.fmt);
      }
      this.destText = '';
      this.styleDraft = { isPara: true, num: 0 };
    }
    if (d === 'listlevel' && parent.dest === 'list' && this.listDraft.level) {
      this.listDraft.levels.push(this.listDraft.level);
      this.listDraft.level = undefined;
    }
    if (d === 'list' && parent.dest === 'listtable') {
      if (this.listDraft.id !== undefined) this.lists.set(this.listDraft.id, { levels: this.listDraft.levels });
    }
    if (d === 'listoverride' && parent.dest === 'listoverridetable') {
      if (this.overrideDraft.ls !== undefined && this.overrideDraft.listid !== undefined) this.overrides.set(this.overrideDraft.ls, this.overrideDraft.listid);
    }
    if (d === 'fldinst' && parent.dest !== 'fldinst') {
      const m = /HYPERLINK\s+(?:\\l\s+)?"([^"]*)"/i.exec(this.fieldInst) ?? /HYPERLINK\s+(\S+)/i.exec(this.fieldInst);
      const top = this.fieldStack[this.fieldStack.length - 1];
      if (m && top) top.href = /\\l\s+"/i.test(this.fieldInst) ? '#' + m[1] : m[1];
      else if (top) {
        top.code = this.fieldInst.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
        top.result = '';
      }
    }
    if (leaving.field) {
      this.flushText();
      const f = this.fieldStack.pop();
      if (f && f.result !== undefined && !f.passthrough) {
        this.st = parent;
        const text = f.result;
        this.emitObject({ kind: 'field', key: fieldKey(f.code ?? '', text), label: f.code ? `Field: ${f.code}` : 'Field', text });
        return;
      }
      if (f?.passthrough && f.startBlock !== undefined && !this.tables.length) {
        if (this.spans.length) this.endParagraph(true);
        const inner = this.blocks.splice(f.startBlock);
        this.blocks.push({ id: newId('o'), type: 'opaque', label: INDEX_FIELDS[f.code ?? '']!, blocks: inner });
      }
    }
    if (d === 'footnote' && parent.dest !== 'footnote' && this.note) {
      const text = this.note.text.replace(/\s+/g, ' ').trim();
      this.note = null;
      this.st = parent;
      this.emitObject({ kind: 'footnote', key: `footnote:${text}`, label: `Footnote: ${text}`, note: text });
      return;
    }
    if (d === 'pict' && parent.dest !== 'pict' && this.pict) {
      const pict = this.pict;
      this.pict = null;
      this.st = parent;
      this.emitPicture(pict);
      return;
    }
    // Text after the group is compared against the restored formatting in emitText.
    this.st = parent;
  }

  private finishFont(): void {
    if (this.fontDraft.num !== undefined) {
      this.fonts.set(this.fontDraft.num, {
        family: this.fontDraft.family ?? 'fnil',
        charset: this.fontDraft.charset ?? 0,
        name: this.destText.trim(),
      });
    }
    this.destText = '';
    this.fontDraft = {};
  }

  private emitPicture(p: { hex: string[]; type: string; w?: number; h?: number; wg?: number; hg?: number }): void {
    const hex = p.hex.join('');
    const mime = p.type === 'pngblip' ? 'image/png' : p.type === 'jpegblip' ? 'image/jpeg' : undefined;
    const width = p.wg ? Math.round(p.wg / 15) : p.w;
    const height = p.hg ? Math.round(p.hg / 15) : p.h;
    if (!mime || hex.length < 16) {
      this.emitObject({ kind: 'image', key: `img:rtf:${hex.length}:${hex.slice(0, 64)}`, label: 'Image', width, height });
      return;
    }
    const data = new Uint8Array(hex.length >> 1);
    for (let i = 0; i < data.length; i++) data[i] = parseInt(hex.substr(i * 2, 2), 16);
    let src: string | undefined;
    try {
      src = URL.createObjectURL(new Blob([data], { type: mime }));
    } catch {
      src = undefined;
    }
    this.emitObject({ kind: 'image', key: `img:${hashBytes(data)}`, label: 'Image', src, width, height, data, mime });
  }
}

/** Ignorable destinations we understand (anything else after \* is skipped). */
/** Fields whose result is a whole table of contents or index. */
const INDEX_FIELDS: Record<string, string> = { TOC: 'Table of contents', INDEX: 'Index', BIBLIOGRAPHY: 'Bibliography' };

const KNOWN_IGNORABLE = new Set(['listtable', 'listoverridetable', 'fldinst', 'shppict', 'ud', 'pn', 'footnote', 'nesttableprops']);

export function readRtf(data: Uint8Array, name: string): Doc {
  const head = String.fromCharCode(...data.subarray(0, 8));
  if (!head.startsWith('{\\rtf')) throw new Error('This is not a Rich Text (RTF) file.');
  const r = new RtfReader(data);
  r.run();
  return { id: newId('d'), name, kind: 'rtf', blocks: r.blocks, version: 0, ext: 'rtf', formatLabel: 'RTF' };
}
