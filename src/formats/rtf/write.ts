import { computeListLabels } from '../../core/lists';
import type { Block, Doc, ParaBlock, Span, TableBlock } from '../../core/model';

/**
 * Writes a document as RTF. Headings and other roles use named styles (with
 * the formatting repeated inline for readers that ignore style sheets),
 * lists carry a plain-text marker as a fallback, and images are embedded.
 */

const STYLES: Array<{ key: string; num: number; def: string; name: string }> = [
  { key: 'p', num: 0, def: '\\sa160\\sl259\\slmult1 \\f0\\fs22', name: 'Normal' },
  { key: 'h1', num: 1, def: '\\sb360\\sa80\\keepn\\outlinelevel0 \\b\\fs32', name: 'heading 1' },
  { key: 'h2', num: 2, def: '\\sb240\\sa80\\keepn\\outlinelevel1 \\b\\fs28', name: 'heading 2' },
  { key: 'h3', num: 3, def: '\\sb240\\sa80\\keepn\\outlinelevel2 \\b\\fs26', name: 'heading 3' },
  { key: 'h4', num: 4, def: '\\sb200\\sa60\\keepn\\outlinelevel3 \\b\\i\\fs24', name: 'heading 4' },
  { key: 'h5', num: 5, def: '\\sb200\\sa60\\keepn\\outlinelevel4 \\b\\fs22', name: 'heading 5' },
  { key: 'h6', num: 6, def: '\\sb200\\sa60\\keepn\\outlinelevel5 \\i\\fs22', name: 'heading 6' },
  { key: 'title', num: 7, def: '\\sa80 \\fs56', name: 'Title' },
  { key: 'subtitle', num: 8, def: '\\sa160 \\cf2\\fs28', name: 'Subtitle' },
  { key: 'quote', num: 9, def: '\\li864\\ri864\\sb160\\sa160 \\i\\cf2', name: 'Quote' },
  { key: 'caption', num: 10, def: '\\sa200 \\i\\fs18', name: 'caption' },
  { key: 'code', num: 11, def: '\\sa0 \\f1\\fs20', name: 'HTML Preformatted' },
];

function styleFor(p: ParaBlock): (typeof STYLES)[number] {
  const r = p.props.role;
  const key = r === 'h' ? `h${Math.min(6, Math.max(1, p.props.level ?? 1))}` : r === 'toc' ? 'p' : r;
  return STYLES.find((s) => s.key === key) ?? STYLES[0]!;
}

/** Escapes text for RTF: control characters, non-ASCII as \uN with a "?" fallback. */
export function rtfEscape(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const code = text.charCodeAt(i);
    if (c === '\\' || c === '{' || c === '}') out += '\\' + c;
    else if (c === '\t') out += '\\tab ';
    else if (c === '\n') out += '\\line ';
    else if (code === 0xa0) out += '\\~';
    else if (code === 0xad) out += '\\-';
    else if (code === 0x2011) out += '\\_';
    else if (code < 0x20) continue;
    else if (code < 0x80) out += c;
    else out += `\\u${code > 32767 ? code - 65536 : code}?`;
  }
  return out;
}

function hex(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i < data.length; i++) {
    s += data[i]!.toString(16).padStart(2, '0');
    if (i % 64 === 63) s += '\n';
  }
  return s;
}

function spanRtf(s: Span): string {
  if (s.marker) return '';
  let inner: string;
  if (s.obj) {
    const o = s.obj;
    if (o.kind === 'image' && o.data && (o.mime === 'image/png' || o.mime === 'image/jpeg')) {
      const w = Math.round((o.width ?? 200) * 15);
      const h = Math.round((o.height ?? 150) * 15);
      inner = `{\\*\\shppict{\\pict${o.mime === 'image/png' ? '\\pngblip' : '\\jpegblip'}\\picwgoal${w}\\pichgoal${h}\n${hex(o.data)}}}`;
    } else if (o.kind === 'footnote' || o.kind === 'endnote') {
      const note = rtfEscape(o.note ?? o.label);
      inner = `{\\super\\chftn}{\\footnote${o.kind === 'endnote' ? '\\ftnalt' : ''}\\pard\\plain\\fs20{\\super\\chftn} ${note}}`;
    } else if (o.kind === 'pagebreak') {
      return '\\page ';
    } else if (o.kind === 'field' && /^[A-Z]+(\||$)/.test(o.key)) {
      const code = o.key.split('|')[0]!;
      inner = `{\\field{\\*\\fldinst ${code} }{\\fldrslt ${rtfEscape(o.text ?? '')}}}`;
    } else {
      inner = rtfEscape(o.text ?? (o.kind === 'image' ? `[${o.label}]` : ''));
    }
  } else {
    inner = rtfEscape(s.text);
  }
  if (!inner) return '';
  const f = s.fmt;
  let props = '';
  if (f.b) props += '\\b';
  if (f.i) props += '\\i';
  if (f.u && !f.href) props += '\\ul';
  if (f.s) props += '\\strike';
  if (f.sup) props += '\\super';
  if (f.sub) props += '\\sub';
  if (f.code) props += '\\f1';
  if (f.hl) props += '\\highlight3';
  let out = props ? `{${props} ${inner}}` : inner;
  if (f.href) out = `{\\field{\\*\\fldinst{HYPERLINK "${f.href.replace(/["\\{}]/g, '')}"}}{\\fldrslt{\\ul\\cf1 ${out}}}}`;
  return out;
}

interface ListRegistry {
  /** RTF list override number for each list key. */
  ls: Map<string, { ls: number; ordered: boolean }>;
}

function listKey(p: ParaBlock): string {
  const l = p.props.list!;
  return `${l.key ?? 'list'}/${l.ordered ? 'o' : 'u'}`;
}

function levelsRtf(ordered: boolean, formats: string[] | undefined, starts: number[] | undefined): string {
  const NFC: Record<string, number> = { decimal: 0, upperRoman: 1, lowerRoman: 2, upperLetter: 3, lowerLetter: 4, decimalZero: 22 };
  let out = '';
  for (let l = 0; l < 9; l++) {
    const ind = `\\fi-360\\li${720 * (l + 1)}`;
    if (ordered) {
      const nfc = NFC[formats?.[l] ?? ''] ?? [0, 4, 2][l % 3]!;
      out += `{\\listlevel\\levelnfc${nfc}\\levelnfcn${nfc}\\leveljc0\\leveljcn0\\levelfollow0\\levelstartat${starts?.[l] ?? 1}{\\leveltext\\'02\\'0${l}.;}{\\levelnumbers\\'01;}${ind}}`;
    } else {
      const glyph = ['\\u8226 ?', '\\u9702 ?', '\\u9642 ?'][l % 3];
      out += `{\\listlevel\\levelnfc23\\levelnfcn23\\leveljc0\\leveljcn0\\levelfollow0\\levelstartat1{\\leveltext\\'01${glyph};}{\\levelnumbers;}${ind}}`;
    }
  }
  return out;
}

/** Field codes that rebuild a table of contents or index in Word. */
const INDEX_CODES: Record<string, string> = { 'Table of contents': 'TOC \\\\o "1-3" \\\\h \\\\z \\\\u', Index: 'INDEX', Bibliography: 'BIBLIOGRAPHY' };

export function docToRtf(doc: Doc): string {
  const labels = computeListLabels(doc.blocks);
  const reg: ListRegistry = { ls: new Map() };
  const listDefs: string[] = [];
  const overrides: string[] = [];
  const register = (p: ParaBlock) => {
    const key = listKey(p);
    let e = reg.ls.get(key);
    if (!e) {
      const n = reg.ls.size + 1;
      const list = p.props.list!;
      listDefs.push(`{\\list\\listtemplateid${1000 + n}\\listhybrid${levelsRtf(list.ordered, list.formats, list.starts)}{\\listname ;}\\listid${100 + n}}`);
      overrides.push(`{\\listoverride\\listid${100 + n}\\listoverridecount0\\ls${n}}`);
      e = { ls: n, ordered: list.ordered };
      reg.ls.set(key, e);
    }
    return e;
  };

  const para = (p: ParaBlock, depth: number): string => {
    const st = styleFor(p);
    let pard = `\\pard\\plain\\s${st.num}${depth ? `\\intbl\\itap${depth}` : ''} ${st.def}`;
    if (p.props.align) pard += p.props.align === 'center' ? '\\qc' : p.props.align === 'right' ? '\\qr' : '\\qj';
    let marker = '';
    if (p.props.list) {
      const e = register(p);
      const lvl = p.props.list.level;
      pard += `\\ls${e.ls}\\ilvl${lvl}\\fi-360\\li${720 * (lvl + 1)}`;
      marker = `{\\listtext\\pard\\plain ${rtfEscape(labels.get(p) ?? '\u2022')}\\tab}`;
    }
    return `${pard} ${marker}${p.spans.map(spanRtf).join('')}`;
  };

  const rowDef = (r: TableBlock['rows'][number], unit: number): string => {
    let def = `\\trowd\\trgaph108\\trleft0${r.header ? '\\trhdr' : ''}`;
    let x = 0;
    for (const c of r.cells) {
      x += unit * (c.colspan ?? 1);
      const merge = c.vmerge === 'restart' ? '\\clvmgf' : c.vmerge === 'continue' ? '\\clvmrg' : '';
      def += `${merge}\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10\\cellx${x}`;
    }
    return def;
  };

  /** A table at nesting depth `depth` (1 = in the body). Nested tables use \\itap and \\nestcell. */
  const table = (t: TableBlock, depth: number): string => {
    const cols = Math.max(1, ...t.rows.map((r) => r.cells.reduce((n, c) => n + (c.colspan ?? 1), 0)));
    const unit = Math.floor((depth === 1 ? 9360 : 4680) / cols);
    const cellEnd = depth === 1 ? '\\cell' : '\\nestcell';
    let out = '';
    for (const r of t.rows) {
      const def = rowDef(r, unit);
      if (depth === 1) out += def + '\n';
      for (const c of r.cells) {
        const blocks = c.blocks.filter((b) => b.type === 'p' || b.type === 'table' || b.type === 'opaque');
        blocks.forEach((b, i) => {
          const last = i === blocks.length - 1;
          if (b.type === 'p') out += para(b, depth) + (last ? cellEnd : '\\par') + '\n';
          else if (b.type === 'table') {
            out += table(b, depth + 1);
            if (last) out += `\\pard\\plain\\intbl\\itap${depth} ${cellEnd}\n`;
          } else if (b.type === 'opaque') {
            for (const x of b.blocks) if (x.type === 'p') out += para(x, depth) + '\\par\n';
            if (last) out += `\\pard\\plain\\intbl\\itap${depth} ${cellEnd}\n`;
          }
        });
        if (!blocks.length) out += `\\pard\\plain\\intbl\\itap${depth} ${cellEnd}\n`;
      }
      out += depth === 1 ? `${def}\\row\n` : `{\\*\\nesttableprops${def}\\nestrow}{\\nonesttables\\par}\n`;
    }
    return out;
  };

  let body = '';
  const walk = (blocks: readonly Block[]) => {
    for (const b of blocks) {
      if (b.type === 'p') body += para(b, 0) + '\\par\n';
      else if (b.type === 'table') body += table(b, 1);
      else if (b.type === 'opaque') {
        const code = INDEX_CODES[b.label];
        if (code) body += `{\\field{\\*\\fldinst ${code} }{\\fldrslt `;
        walk(b.blocks);
        if (code) body += '}}\n';
      }
    }
  };
  walk(doc.blocks);

  const stylesheet = STYLES.map((s) => `{${s.num ? `\\s${s.num}` : ''}${s.def}\\sbasedon0\\snext0 ${s.name};}`).join('\n');
  return (
    `{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1\\deflang1033\n` +
    `{\\fonttbl{\\f0\\fswiss\\fcharset0 Calibri;}{\\f1\\fmodern\\fcharset0 Courier New;}}\n` +
    `{\\colortbl;\\red5\\green99\\blue193;\\red89\\green89\\blue89;\\red255\\green255\\blue0;}\n` +
    `{\\stylesheet\n${stylesheet}\n{\\*\\cs20\\ul\\cf1 Hyperlink;}}\n` +
    (listDefs.length ? `{\\*\\listtable\n${listDefs.join('\n')}}\n{\\*\\listoverridetable${overrides.join('')}}\n` : '') +
    `\\viewkind4\n${body}}\n`
  );
}
