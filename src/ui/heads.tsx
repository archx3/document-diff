import type { Ref } from 'react';
import { Ico } from '../components/icons';
import type { Comparison } from '../core/compare';
import type { Doc } from '../core/model';
import { Counter } from './counter';
import type { Side } from './util';
import { kindOf, pairKind } from '../media/kinds';
import { useFacts } from './facts';
import { SIDE_NAME, kindLabel, plural } from './util';

export type DocMenu = 'load' | 'export';

interface HeadsProps {
  a: Doc;
  b: Doc;
  edits: Readonly<Record<Side, number>>;
  /** For the counter between the heads. */
  cmp: Comparison;
  current: number;
  /** The document menu that is open, as "load-a" and so on. */
  open: string | null;
  onMenu(menu: DocMenu, side: Side, anchor: HTMLElement): void;
  ref?: Ref<HTMLDivElement>;
}

/**
 * The documents' names above their columns, with buttons to replace and
 * export each, and between them, above the ruler, which change is current.
 */
export function ColumnHeads({ a, b, edits, cmp, current, open, onMenu, ref }: HeadsProps) {
  return (
    <div className="colheads" id="colheads" ref={ref}>
      <div className="colhead a">
        <Slot side="a" doc={a} edits={edits.a} open={open} onMenu={onMenu} />
      </div>
      <div className="colhead gut">
        {/* Changes are counted in text; pictures and recordings say what changed in their toolbar. */}
        {pairKind(a, b) === 'text' && <Counter cmp={cmp} current={current} id="counter" />}
      </div>
      <div className="colhead b">
        <Slot side="b" doc={b} edits={edits.b} open={open} onMenu={onMenu} />
      </div>
    </div>
  );
}

function Slot({ side, doc, edits, open, onMenu }: { side: Side; doc: Doc; edits: number; open: string | null; onMenu: HeadsProps['onMenu'] }) {
  const facts = useFacts(doc);
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
          <span className="badge" data-kind={kindOf(doc)}>
            {kindLabel(doc)}
          </span>
          {facts.map((f, i) => (
            <span key={i} data-fact={i}>
              {f}
            </span>
          ))}
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
