import { computeListLabels } from '../../core/lists';
import type { Block, Doc, ParaBlock, Span, TableBlock } from '../../core/model';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function base64(data: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) bin += String.fromCharCode(...data.subarray(i, i + chunk));
  return btoa(bin);
}

export function imageDataUrl(span: Span): string | undefined {
  const o = span.obj;
  if (!o) return undefined;
  if (o.data && o.mime && /^image\/(png|jpeg|gif|bmp|webp|svg\+xml)$/.test(o.mime)) return `data:${o.mime};base64,${base64(o.data)}`;
  if (o.src && !o.src.startsWith('blob:')) return o.src;
  return undefined;
}

function spanHtml(s: Span): string {
  if (s.marker) return '';
  let inner: string;
  if (s.obj) {
    const o = s.obj;
    switch (o.kind) {
      case 'image': {
        const src = imageDataUrl(s);
        if (!src) return `[${escapeHtml(o.label)}]`;
        const size = `${o.width ? ` width="${o.width}"` : ''}${o.height ? ` height="${o.height}"` : ''}`;
        inner = `<img src="${escapeHtml(src)}" alt="${escapeHtml(o.label === 'Image' ? '' : o.label)}"${size}>`;
        break;
      }
      case 'footnote':
      case 'endnote':
        inner = `<sup title="${escapeHtml(o.note ?? o.label)}">*</sup>`;
        break;
      case 'pagebreak':
        return '';
      default:
        inner = escapeHtml(o.text ?? '');
    }
  } else {
    inner = escapeHtml(s.text)
      // Keep runs of spaces (HTML would collapse them).
      .replace(/ {2,}/g, (m) => ' ' + '&nbsp;'.repeat(m.length - 1))
      .replace(/\n/g, '<br>')
      .replace(/\t/g, '<span style="white-space:pre">\t</span>');
  }
  const f = s.fmt;
  if (f.code) inner = `<code>${inner}</code>`;
  if (f.sup) inner = `<sup>${inner}</sup>`;
  if (f.sub) inner = `<sub>${inner}</sub>`;
  if (f.s) inner = `<s>${inner}</s>`;
  if (f.u && !f.href) inner = `<u>${inner}</u>`;
  if (f.i) inner = `<em>${inner}</em>`;
  if (f.b) inner = `<strong>${inner}</strong>`;
  if (f.hl) inner = `<mark>${inner}</mark>`;
  if (f.href) inner = `<a href="${escapeHtml(f.href)}">${inner}</a>`;
  return inner;
}

export function spansHtml(spans: readonly Span[]): string {
  return spans.map(spanHtml).join('');
}

function paraOpen(p: ParaBlock): [string, string] {
  const style = p.props.align ? ` style="text-align:${p.props.align}"` : '';
  switch (p.props.role) {
    case 'h': {
      const n = Math.min(6, Math.max(1, p.props.level ?? 1));
      return [`<h${n}${style}>`, `</h${n}>`];
    }
    case 'title':
      return [`<p class="MsoTitle" style="font-size:26pt;margin:0 0 6pt${p.props.align ? `;text-align:${p.props.align}` : ''}">`, '</p>'];
    case 'subtitle':
      return [`<p class="MsoSubtitle" style="font-size:15pt;color:#595959${p.props.align ? `;text-align:${p.props.align}` : ''}">`, '</p>'];
    case 'quote':
      return [`<blockquote${style}>`, '</blockquote>'];
    case 'code':
      return ['<pre>', '</pre>'];
    case 'caption':
      return [`<p class="MsoCaption"${style}><em>`, '</em></p>'];
    default:
      return [`<p${style}>`, '</p>'];
  }
}

function tableHtml(t: TableBlock, blocksHtml: (b: readonly Block[]) => string): string {
  // Starting grid column of each cell, to turn vertical merges into rowspans.
  const starts = t.rows.map((r) => {
    let c = 0;
    return r.cells.map((cell) => {
      const s = c;
      c += cell.colspan ?? 1;
      return s;
    });
  });
  let out = '<table border="1" cellpadding="6" style="border-collapse:collapse">';
  t.rows.forEach((row, ri) => {
    out += '<tr>';
    row.cells.forEach((cell, ci) => {
      if (cell.vmerge === 'continue') return;
      let rowspan = 1;
      if (cell.vmerge === 'restart') {
        for (let k = ri + 1; k < t.rows.length; k++) {
          const idx = starts[k]!.indexOf(starts[ri]![ci]!);
          if (idx >= 0 && t.rows[k]!.cells[idx]!.vmerge === 'continue') rowspan++;
          else break;
        }
      }
      const tag = cell.header || row.header ? 'th' : 'td';
      const attrs = `${(cell.colspan ?? 1) > 1 ? ` colspan="${cell.colspan}"` : ''}${rowspan > 1 ? ` rowspan="${rowspan}"` : ''}`;
      out += `<${tag}${attrs}>${blocksHtml(cell.blocks)}</${tag}>`;
    });
    out += '</tr>';
  });
  return out + '</table>';
}

/** Semantic HTML for blocks (nested lists, tables, formatting). */
export function blocksToHtml(blocks: readonly Block[], labels = computeListLabels(blocks)): string {
  let out = '';
  const stack: Array<{ tag: 'ul' | 'ol'; level: number; liOpen: boolean }> = [];
  const closeTop = () => {
    const top = stack.pop()!;
    if (top.liOpen) out += '</li>';
    out += `</${top.tag}>`;
  };
  const closeAll = () => {
    while (stack.length) closeTop();
  };
  for (const b of blocks) {
    if (b.type === 'marker') continue;
    if (b.type === 'p' && b.props.list) {
      const L = b.props.list.level;
      const tag = b.props.list.ordered ? 'ol' : 'ul';
      while (stack.length && stack[stack.length - 1]!.level > L) closeTop();
      let top = stack[stack.length - 1];
      if (top && top.level === L && top.tag !== tag) {
        closeTop();
        top = stack[stack.length - 1];
      }
      if (top && top.level === L) {
        if (top.liOpen) out += '</li>';
      } else {
        const label = labels.get(b);
        const start = tag === 'ol' && label && /^\d+/.test(label) ? parseInt(label, 10) : 1;
        out += start > 1 ? `<ol start="${start}">` : `<${tag}>`;
        stack.push({ tag, level: L, liOpen: false });
        top = stack[stack.length - 1]!;
      }
      const [open, close] = paraOpen(b);
      const inner = spansHtml(b.spans);
      out += b.props.role === 'p' ? `<li>${inner}` : `<li>${open}${inner}${close}`;
      top.liOpen = true;
      continue;
    }
    closeAll();
    if (b.type === 'p') {
      const [open, close] = paraOpen(b);
      const inner = spansHtml(b.spans);
      out += open + (inner || '<br>') + close;
    } else if (b.type === 'table') {
      out += tableHtml(b, (x) => blocksToHtml(x));
    } else if (b.type === 'opaque') {
      out += blocksToHtml(b.blocks);
    }
  }
  closeAll();
  return out;
}

export function docToHtml(doc: Doc): string {
  const title = escapeHtml(doc.name.replace(/\.[^.]+$/, ''));
  return (
    `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
    `<style>body{font:16px/1.55 Georgia,'Times New Roman',serif;max-width:46rem;margin:3rem auto;padding:0 1rem;color:#1c1c1c}` +
    `table{border-collapse:collapse;margin:1rem 0}td,th{border:1px solid #999;padding:4px 8px;vertical-align:top}` +
    `blockquote{margin:1rem 2rem;font-style:italic}img{max-width:100%}</style></head><body>\n` +
    blocksToHtml(doc.blocks) +
    '\n</body></html>\n'
  );
}

/* --------------------------------------------------------------- text */

export function docToText(doc: Doc): string {
  const labels = computeListLabels(doc.blocks);
  const lines: string[] = [];
  const walk = (blocks: readonly Block[], indent: string) => {
    for (const b of blocks) {
      if (b.type === 'p') {
        const text = b.spans.map((s) => (s.marker ? '' : s.obj ? (s.obj.kind === 'image' ? `[${s.obj.label}]` : (s.obj.text ?? '')) : s.text)).join('');
        const list = b.props.list;
        const prefix = list ? '    '.repeat(list.level) + (labels.get(b) ?? '-') + ' ' : '';
        lines.push(indent + prefix + text);
      } else if (b.type === 'table') {
        for (const r of b.rows) lines.push(indent + r.cells.map((c) => c.blocks.map((x) => (x.type === 'p' ? x.spans.map((s) => s.obj?.text ?? s.text).join('') : '')).join(' ')).join('\t'));
      } else if (b.type === 'opaque') {
        walk(b.blocks, indent);
      }
    }
  };
  walk(doc.blocks, '');
  return lines.join('\n') + '\n';
}

/* ----------------------------------------------------------- markdown */

function mdEscape(s: string): string {
  return s.replace(/([\\`*_[\]<>|])/g, '\\$1');
}

function spanMd(s: Span): string {
  if (s.marker) return '';
  if (s.obj) {
    if (s.obj.kind === 'image') {
      const src = imageDataUrl(s);
      return src ? `![${mdEscape(s.obj.label === 'Image' ? '' : s.obj.label)}](${src})` : `[${mdEscape(s.obj.label)}]`;
    }
    if (s.obj.kind === 'footnote' || s.obj.kind === 'endnote') return s.obj.note ? `^[${mdEscape(s.obj.note)}]` : '';
    return mdEscape(s.obj.text ?? '');
  }
  if (!s.text) return '';
  // Keep surrounding spaces outside emphasis markers.
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s.text)!;
  let inner = mdEscape(m[2]!).replace(/\n/g, '  \n');
  if (!inner) return s.text.replace(/\n/g, '  \n');
  const f = s.fmt;
  if (f.code) inner = '`' + m[2]!.replace(/`/g, 'ˋ') + '`';
  if (f.sup) inner = `<sup>${inner}</sup>`;
  if (f.sub) inner = `<sub>${inner}</sub>`;
  if (f.u && !f.href) inner = `<u>${inner}</u>`;
  if (f.s) inner = `~~${inner}~~`;
  if (f.i) inner = `*${inner}*`;
  if (f.b) inner = `**${inner}**`;
  if (f.href) inner = `[${inner}](${f.href.replace(/\)/g, '%29').replace(/ /g, '%20')})`;
  return m[1] + inner + m[3];
}

export function docToMarkdown(doc: Doc): string {
  const labels = computeListLabels(doc.blocks);
  const out: string[] = [];
  let prevList = false;
  const cellText = (blocks: readonly Block[]) =>
    blocks
      .map((b) => (b.type === 'p' ? b.spans.map(spanMd).join('') : ''))
      .join('<br>')
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ');
  const walk = (blocks: readonly Block[]) => {
    for (const b of blocks) {
      if (b.type === 'marker') continue;
      if (b.type === 'opaque') {
        walk(b.blocks);
        continue;
      }
      if (b.type === 'table') {
        if (!b.rows.length) continue;
        const width = Math.max(...b.rows.map((r) => r.cells.length));
        const row = (cells: string[]) => `| ${[...cells, ...Array(width - cells.length).fill('')].join(' | ')} |`;
        const lines = [row(b.rows[0]!.cells.map((c) => cellText(c.blocks))), row(Array(width).fill('---'))];
        for (const r of b.rows.slice(1)) lines.push(row(r.cells.map((c) => (c.vmerge === 'continue' ? '' : cellText(c.blocks)))));
        out.push(lines.join('\n'));
        prevList = false;
        continue;
      }
      const text = b.spans.map(spanMd).join('').trim();
      const list = b.props.list;
      if (list) {
        const label = labels.get(b) ?? '-';
        const marker = list.ordered ? (/^\d+/.test(label) ? `${parseInt(label, 10)}.` : '1.') : '-';
        const line = '   '.repeat(list.level) + marker + ' ' + text;
        if (prevList) out[out.length - 1] += '\n' + line;
        else out.push(line);
        prevList = true;
        continue;
      }
      prevList = false;
      if (!text) continue;
      switch (b.props.role) {
        case 'h':
          out.push('#'.repeat(Math.min(6, b.props.level ?? 1)) + ' ' + text);
          break;
        case 'title':
          out.push('# ' + text);
          break;
        case 'subtitle':
          out.push('*' + text + '*');
          break;
        case 'quote':
          out.push(text.split('\n').map((l) => '> ' + l).join('\n'));
          break;
        case 'code':
          out.push('```\n' + b.spans.map((s) => s.obj?.text ?? s.text).join('') + '\n```');
          break;
        default:
          out.push(/^(#{1,6}\s|[-+*]\s|\d+[.)]\s|>)/.test(text) ? '\\' + text : text);
      }
    }
  };
  walk(doc.blocks);
  return out.join('\n\n') + '\n';
}
