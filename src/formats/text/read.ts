import type { Block, Doc, Fmt, ParaProps, Span, TableCell, TableRow } from '../../core/model';
import { OBJ_CHAR, newId, normalizeSpans } from '../../core/model';
import { readPlainText } from './plain';

/** Plain text: one paragraph per line. */
export function readText(text: string, name: string): Doc {
  return readPlainText(text, name, 'txt');
}

/* ----------------------------------------------------------- markdown */

function findClosing(s: string, from: number, delim: string): number {
  let i = from;
  while (i < s.length) {
    const j = s.indexOf(delim, i);
    if (j < 0) return -1;
    if (s[j - 1] === '\\') {
      i = j + 1;
      continue;
    }
    // Closing delimiter must follow non-whitespace.
    if (j > from && !/\s/.test(s[j - 1]!)) return j;
    i = j + 1;
  }
  return -1;
}

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~<>"']/;

export function parseMarkdownInline(s: string, fmt: Fmt = {}, out: Span[] = []): Span[] {
  let buf = '';
  const flush = () => {
    if (buf) out.push({ text: buf, fmt });
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    const rest = s.slice(i);
    if (c === '\\' && i + 1 < s.length) {
      if (s[i + 1] === '\n') {
        flush();
        out.push({ text: '\n', fmt });
        i += 2;
        continue;
      }
      if (ESCAPABLE.test(s[i + 1]!)) {
        buf += s[i + 1];
        i += 2;
        continue;
      }
    }
    if (c === '\n') {
      // A line ending in two spaces is a hard break; otherwise lines join with a space.
      if (buf.endsWith('  ')) {
        buf = buf.replace(/ +$/, '');
        flush();
        out.push({ text: '\n', fmt });
      } else {
        buf = buf.replace(/ +$/, '') + ' ';
      }
      i++;
      continue;
    }
    if (c === '`') {
      const m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest);
      if (m) {
        flush();
        out.push({ text: m[2]!.length > 2 && m[2]!.startsWith(' ') && m[2]!.endsWith(' ') ? m[2]!.slice(1, -1) : m[2]!, fmt: { ...fmt, code: true } });
        i += m[0].length;
        continue;
      }
    }
    if (c === '!' && s[i + 1] === '[') {
      const m = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/.exec(rest);
      if (m) {
        flush();
        out.push({ text: OBJ_CHAR, fmt, obj: { kind: 'image', key: 'img:' + m[2], label: m[1] || 'Image', src: m[2] } });
        i += m[0].length;
        continue;
      }
    }
    if (c === '[') {
      const m = /^\[((?:\\.|[^\]\\])*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/.exec(rest);
      if (m) {
        flush();
        parseMarkdownInline(m[1]!, { ...fmt, href: m[2] }, out);
        i += m[0].length;
        continue;
      }
    }
    if (c === '<') {
      const auto = /^<((?:https?|ftp):\/\/[^>\s]+|mailto:[^>\s]+)>/.exec(rest);
      if (auto) {
        flush();
        out.push({ text: auto[1]!.replace(/^mailto:/, ''), fmt: { ...fmt, href: auto[1] } });
        i += auto[0].length;
        continue;
      }
      if (/^<br\s*\/?>/i.test(rest)) {
        flush();
        out.push({ text: '\n', fmt });
        i += /^<br\s*\/?>/i.exec(rest)![0].length;
        continue;
      }
      const tag = /^<(sup|sub|u|ins|del|s|b|strong|i|em|mark)>([\s\S]*?)<\/\1>/i.exec(rest);
      if (tag) {
        flush();
        const t = tag[1]!.toLowerCase();
        const f: Fmt = { ...fmt };
        if (t === 'sup') f.sup = true;
        else if (t === 'sub') f.sub = true;
        else if (t === 'u' || t === 'ins') f.u = true;
        else if (t === 'del' || t === 's') f.s = true;
        else if (t === 'b' || t === 'strong') f.b = true;
        else if (t === 'i' || t === 'em') f.i = true;
        else f.hl = 'yellow';
        parseMarkdownInline(tag[2]!, f, out);
        i += tag[0].length;
        continue;
      }
    }
    if (c === '~' && s[i + 1] === '~') {
      const end = findClosing(s, i + 2, '~~');
      if (end > i + 2) {
        flush();
        parseMarkdownInline(s.slice(i + 2, end), { ...fmt, s: true }, out);
        i = end + 2;
        continue;
      }
    }
    if (c === '*' || c === '_') {
      const prev = s[i - 1] ?? ' ';
      const intraword = c === '_' && /[\p{L}\p{N}]/u.test(prev);
      const double = s[i + 1] === c;
      const d = double ? c + c : c;
      const after = s[i + d.length];
      if (!intraword && after && !/\s/.test(after)) {
        const end = findClosing(s, i + d.length, d);
        const nextAfter = end >= 0 ? (s[end + d.length] ?? ' ') : ' ';
        if (end > i + d.length && !(c === '_' && /[\p{L}\p{N}]/u.test(nextAfter))) {
          flush();
          parseMarkdownInline(s.slice(i + d.length, end), double ? { ...fmt, b: true } : { ...fmt, i: true }, out);
          i = end + d.length;
          continue;
        }
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ ]?(.*)$/;
const LIST = /^([ \t]*)([-+*]|\d{1,9}[.)])[ \t]+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && t[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (t[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += t[i];
  }
  cells.push(cur.trim());
  return cells;
}

function paraBlock(text: string, props: ParaProps): Block {
  return { id: newId('p'), type: 'p', props, spans: normalizeSpans(parseMarkdownInline(text.trim())) };
}

export function readMarkdown(md: string, name: string): Doc {
  const lines = md.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let listKey: string | null = null;
  const indentStack: number[] = [];
  let i = 0;
  const isBlockStart = (l: string) => FENCE.test(l) || ATX.test(l) || HR.test(l) || QUOTE.test(l) || LIST.test(l);

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${fence[1]![0]}{${fence[1]!.length},}\\s*$`).test(lines[i]!)) code.push(lines[i++]!);
      i++;
      blocks.push({ id: newId('p'), type: 'p', props: { role: 'code' }, spans: code.length ? [{ text: code.join('\n'), fmt: {} }] : [] });
      listKey = null;
      continue;
    }
    const atx = ATX.exec(line);
    if (atx) {
      blocks.push(paraBlock(atx[2] ?? '', { role: 'h', level: atx[1]!.length }));
      listKey = null;
      i++;
      continue;
    }
    if (HR.test(line)) {
      listKey = null;
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      let buf: string[] = [];
      const flush = () => {
        if (buf.length) blocks.push(paraBlock(buf.join('\n'), { role: 'quote' }));
        buf = [];
      };
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        const inner = QUOTE.exec(lines[i]!)![1]!;
        if (!inner.trim()) flush();
        else buf.push(inner);
        i++;
      }
      flush();
      listKey = null;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!) && lines[i + 1]!.includes('-')) {
      const rows: TableRow[] = [];
      const toRow = (l: string, header: boolean): TableRow => ({
        id: newId('r'),
        header: header || undefined,
        cells: splitRow(l).map((c): TableCell => ({ blocks: [paraBlock(c.replace(/<br\s*\/?>/gi, '\n'), { role: 'p' })], header: header || undefined })),
      });
      rows.push(toRow(line, true));
      i += 2;
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) rows.push(toRow(lines[i++]!, false));
      blocks.push({ id: newId('t'), type: 'table', rows });
      listKey = null;
      continue;
    }
    const li = LIST.exec(line);
    if (li) {
      const indent = li[1]!.replace(/\t/g, '    ').length;
      if (listKey === null) {
        listKey = newId('l');
        indentStack.length = 0;
      }
      while (indentStack.length && indentStack[indentStack.length - 1]! > indent) indentStack.pop();
      if (!indentStack.length || indentStack[indentStack.length - 1]! < indent) indentStack.push(indent);
      const level = indentStack.length - 1;
      const ordered = /\d/.test(li[2]!);
      const text = [li[3]!];
      i++;
      // Lazy continuation lines belong to the item.
      while (i < lines.length && lines[i]!.trim() && !isBlockStart(lines[i]!)) text.push(lines[i++]!.trim());
      const starts: number[] = [];
      if (ordered) starts[level] = parseInt(li[2]!, 10);
      blocks.push(paraBlock(text.join('\n'), { role: 'p', list: { ordered, level, key: listKey, starts } }));
      continue;
    }
    // Paragraph (possibly a setext heading).
    const text = [line];
    i++;
    while (i < lines.length && lines[i]!.trim() && !isBlockStart(lines[i]!)) {
      if (/^ {0,3}=+\s*$/.test(lines[i]!)) {
        blocks.push(paraBlock(text.join('\n'), { role: 'h', level: 1 }));
        text.length = 0;
        i++;
        break;
      }
      if (/^ {0,3}-+\s*$/.test(lines[i]!)) {
        blocks.push(paraBlock(text.join('\n'), { role: 'h', level: 2 }));
        text.length = 0;
        i++;
        break;
      }
      text.push(lines[i++]!);
    }
    if (text.length) blocks.push(paraBlock(text.join('\n'), { role: 'p' }));
    listKey = null;
  }
  return { id: newId('d'), name, kind: 'markdown', blocks, version: 0 };
}
