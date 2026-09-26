import { Ico } from '../components/icons';
import type { Doc } from '../core/model';
import { wordCount } from '../core/model';
import type { DocMenu } from './heads';
import type { Side } from './util';
import { SIDE_NAME, kindLabel, plural } from './util';

export type LoadKind = 'file' | 'paste' | 'gdoc';

interface EmptyProps {
  a: Doc | null;
  b: Doc | null;
  onLoad(kind: LoadKind, side: Side): void;
  onMenu(menu: DocMenu, side: Side, anchor: HTMLElement): void;
  onSamples(): void;
}

/** Until both documents are in: a card for each, to drop a file on or choose one. */
export function EmptyState({ a, b, onLoad, onMenu, onSamples }: EmptyProps) {
  return (
    <div className="empty" id="empty">
      <div className="empty-inner">
        <div className="empty-grid">
          <Card side="a" doc={a} onLoad={onLoad} onMenu={onMenu} />
          <Card side="b" doc={b} onLoad={onLoad} onMenu={onMenu} />
        </div>
        <p className="privacy">Files are read in this browser tab. Nothing is uploaded.</p>
        <p className="hint center">
          Want to see how it works?{' '}
          <button type="button" className="linkbtn" data-cmd="samples" onClick={onSamples}>
            Load the sample drafts
          </button>
        </p>
      </div>
    </div>
  );
}

function Card({ side, doc, onLoad, onMenu }: { side: Side; doc: Doc | null; onLoad: EmptyProps['onLoad']; onMenu: EmptyProps['onMenu'] }) {
  const siglum = (
    <span className="siglum big" aria-hidden="true">
      {SIDE_NAME[side]}
    </span>
  );
  if (doc) {
    return (
      <section className="dropcard loaded" data-side={side}>
        {siglum}
        <h2>{doc.name}</h2>
        <p className="dc-meta">
          <span className="badge">{kindLabel(doc)}</span> {plural(wordCount(doc), 'word')}
        </p>
        <div className="dc-actions">
          <button type="button" className="btn" data-menu="load" data-side={side} onClick={(e) => onMenu('load', side, e.currentTarget)}>
            <Ico name="open" />
            <span>Replace</span>
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="dropcard" data-side={side}>
      {siglum}
      <h2>{side === 'a' ? 'First version' : 'Second version'}</h2>
      <p>Drop a document here, or</p>
      <div className="dc-actions">
        <button type="button" className="btn primary" data-load="file" data-side={side} onClick={() => onLoad('file', side)}>
          <Ico name="open" />
          <span>Choose file</span>
        </button>
        <button type="button" className="btn" data-load="paste" data-side={side} onClick={() => onLoad('paste', side)}>
          <Ico name="paste" />
          <span>Paste text</span>
        </button>
        <button type="button" className="btn" data-load="gdoc" data-side={side} onClick={() => onLoad('gdoc', side)}>
          <Ico name="link" />
          <span>Google Doc</span>
        </button>
      </div>
      <p className="hint">Word, Google Docs, PDF, OpenDocument, RTF, EPUB, HTML, Markdown, CSV or text</p>
    </section>
  );
}
