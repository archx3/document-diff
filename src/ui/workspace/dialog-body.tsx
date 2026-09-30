import type { ReactNode } from 'react';
import type { Doc } from '../../core/model';
import type { CompareOptions } from '../../core/tokens';
import type { DialogState } from '../dialogs';
import { GoogleDocDialog, HelpDialog, PasteDialog, RevisionsDialog, UnlockDialog } from '../dialogs';
import { PicturesDialog } from '../image/pictures-dialog';
import { HistoryDialog } from '../versions';
import type { Loading } from './use-loading';

interface DialogContext {
  a: Doc | null;
  b: Doc | null;
  opts: CompareOptions;
  setDialog(dialog: DialogState | null): void;
  loading: Pick<Loading, 'versions' | 'loadPasted' | 'startLoad' | 'loadRevision' | 'openReview'>;
}

/** What the dialog open over the workspace shows (the dialog itself is Dialog, in dialogs.tsx). */
export function dialogBody(dialog: DialogState, { a, b, opts, setDialog, loading }: DialogContext): ReactNode {
  switch (dialog.type) {
    case 'paste': {
      const { side } = dialog;
      return (
        <PasteDialog
          side={side}
          onPaste={(html, text) => {
            setDialog(null);
            loading.loadPasted(side, html, text);
          }}
        />
      );
    }
    case 'gdoc':
      return <GoogleDocDialog side={dialog.side} presetId={dialog.presetId} onLoad={loading.startLoad} />;
    case 'help':
      return <HelpDialog />;
    case 'history':
      return a && b ? <HistoryDialog versions={loading.versions} steps={dialog.steps} opts={opts} a={a} b={b} /> : null;
    case 'pictures':
      return <PicturesDialog a={dialog.a} b={dialog.b} />;
    case 'revisions': {
      const d = dialog;
      return <RevisionsDialog file={d.ref} onPick={(rev) => void loading.loadRevision(d.side, rev)} />;
    }
    case 'unlock': {
      const d = dialog;
      return <UnlockDialog key={d.error ?? ''} name={d.name} error={d.error} onUnlock={(pw) => void loading.openReview(d.name, d.bytes, pw)} />;
    }
  }
}
