import { useMemo } from 'react';
import type { Ref } from 'react';
import { Ico } from '../components/icons';
import type { Doc } from '../core/model';
import { isBlank, wordCount } from '../core/model';
import type { Side } from './util';
import { SIDE_NAME, kindLabel, plural } from './util';

export type DocMenu = 'load' | 'export';

interface HeadsProps {
  a: Doc;
  b: Doc;
  edits: Readonly<Record<Side, number>>;
  /** The document menu that is open, as "load-a" and so on. */
  open: string | null;
  onMenu(menu: DocMenu, side: Side, anchor: HTMLElement): void;
  ref?: Ref<HTMLDivElement>;
}

/** The documents' names above their columns, with buttons to replace and export each. */
export function ColumnHeads({ a, b, edits, open, onMenu, ref }: HeadsProps) {
  return (
    <div className="colheads" id="colheads" ref={ref}>
      <div className="colhead a">
        <Slot side="a" doc={a} edits={edits.a} open={open} onMenu={onMenu} />
      </div>
      <div className="colhead gut" aria-hidden="true" />
      <div className="colhead b">
        <Slot side="b" doc={b} edits={edits.b} open={open} onMenu={onMenu} />
      </div>
    </div>
  );
}

function Slot({ side, doc, edits, open, onMenu }: { side: Side; doc: Doc; edits: number; open: string | null; onMenu: HeadsProps['onMenu'] }) {
  const words = useMemo(() => wordCount(doc), [doc]);
  const paras = useMemo(() => doc.blocks.filter((b) => b.type !== 'marker' && !isBlank(b)).length, [doc]);
  const name = SIDE_NAME[side];
  return (
    <div className="slot" data-side={side}>
      <span className="siglum" aria-hidden="true">
        {name}
      </span>
      <div className="slot-main">
        <div className="slot-name" title={doc.name}>
          {doc.name}
        </div>
        <div className="slot-meta">
          <span className="badge">{kindLabel(doc)}</span>
          <span>{plural(words, 'word')}</span>
          <span>{paras.toLocaleString()} ¶</span>
          {edits > 0 && <span className="edited">{plural(edits, 'edit')} applied</span>}
        </div>
      </div>
      <div className="slot-actions">
        <button
          type="button"
          className="btn sm"
          data-menu="load"
          data-side={side}
          aria-haspopup="true"
          aria-expanded={open === `load-${side}` || undefined}
          title={`Load a different document as ${name}`}
          onClick={(e) => onMenu('load', side, e.currentTarget)}
        >
          <Ico name="open" />
          <span>Replace</span>
        </button>
        <button
          type="button"
          className={`btn sm${edits ? ' primary' : ''}`}
          data-menu="export"
          data-side={side}
          aria-haspopup="true"
          aria-expanded={open === `export-${side}` || undefined}
          title={`Download or copy ${name}`}
          onClick={(e) => onMenu('export', side, e.currentTarget)}
        >
          <Ico name="download" />
          <span>Export</span>
        </button>
      </div>
    </div>
  );
}
