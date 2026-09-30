import { KindPicker } from '../components/kind-picker';
import type { MediaKind } from '../media/kinds';
import { MEDIA, kindOf } from '../media/kinds';
import type { CloudKind } from '../lib/cloud';
import { Ico } from '../components/icons';
import type { Doc } from '../core/model';
import { wordCount } from '../core/model';
import type { DocMenu } from './heads';
import type { Side } from './util';
import { SIDE_NAME, kindLabel, plural } from './util';

/** Ways to load a document: a file, a paste, a Google Docs link, a cloud drive's picker, or an earlier version of a Drive file. */
export type LoadKind = 'file' | 'paste' | 'gdoc' | CloudKind | 'drive-version';

interface EmptyProps {
  a: Doc | null;
  b: Doc | null;
  onLoad(kind: LoadKind, side: Side): void;
  onMenu(menu: DocMenu, side: Side, anchor: HTMLElement): void;
  onSamples(): void;
  /** What kind of file to choose. */
  media: MediaKind;
  onMedia(k: MediaKind): void;
}

/** Until both documents are in: a card for each, to drop a file on or choose one. */
export function EmptyState({ a, b, onLoad, onMenu, onSamples, media, onMedia }: EmptyProps) {
  return (
    <div className="empty" id="empty">
      <div className="empty-inner">
        <div className="empty-kinds">
          <KindPicker value={media} onChange={onMedia} />
        </div>
        <div className="empty-grid">
          <Card side="a" doc={a} media={media} onLoad={onLoad} onMenu={onMenu} />
          <Card side="b" doc={b} media={media} onLoad={onLoad} onMenu={onMenu} />
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

function Card({ side, doc, media, onLoad, onMenu }: { side: Side; doc: Doc | null; media: MediaKind; onLoad: EmptyProps['onLoad']; onMenu: EmptyProps['onMenu'] }) {
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
          <span className="badge">{kindLabel(doc)}</span> {kindOf(doc) === 'text' && plural(wordCount(doc), 'word')}
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
      <p>Drop {MEDIA[media].one} here, or</p>
      <div className="dc-actions">
        <button type="button" className="btn primary" data-load="file" data-side={side} onClick={() => onLoad('file', side)}>
          <Ico name="open" />
          <span>Choose file</span>
        </button>
        {media === 'text' && (
          <>
            <button type="button" className="btn" data-load="paste" data-side={side} onClick={() => onLoad('paste', side)}>
              <Ico name="paste" />
              <span>Paste text</span>
            </button>
            <button type="button" className="btn" data-load="gdoc" data-side={side} onClick={() => onLoad('gdoc', side)}>
              <Ico name="link" />
              <span>Google Doc</span>
            </button>
          </>
        )}
      </div>
      <p className="hint">{MEDIA[media].formats}</p>
    </section>
  );
}
