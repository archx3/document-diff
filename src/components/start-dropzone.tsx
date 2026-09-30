'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ACCEPTED_EXTENSIONS, acceptList } from '../formats/extensions';
import { handOffFiles } from '../lib/handoff';
import type { MediaKind } from '../media/kinds';
import { MEDIA, kindOfName } from '../media/kinds';
import { useFilePicker, usePageDrop } from './file-drop';
import { Icon } from './icons';
import { KindPicker, acceptFor } from './kind-picker';
import styles from './site.module.css';

const ACCEPT = acceptList(ACCEPTED_EXTENSIONS);
const NEXT_STEP = '/compare/new/';

/** Starts a comparison with the files picked here (one, or both versions): the next page asks for anything missing. */
function useStart() {
  const router = useRouter();
  const [opening, setOpening] = useState('');
  const start = (files: File[], kind?: MediaKind) => {
    handOffFiles(files, kind ?? kindOfName(files[0]!.name) ?? undefined);
    setOpening(files.length > 1 ? `${files[0]!.name} and ${files[1]!.name}` : files[0]!.name);
    router.push(NEXT_STEP);
  };
  return { opening, start };
}

/** The landing page's drop target: choose what is compared, then one file or both. Files dropped anywhere on the page land here. */
export function StartDropzone() {
  const { opening, start } = useStart();
  const [kind, setKind] = useState<MediaKind>('text');
  const dragging = usePageDrop((files) => start(files));
  const picker = useFilePicker((files) => start(files, kind), acceptFor(kind), true);
  const what = kind === 'text' ? 'document' : kind === 'image' ? 'image' : 'recording';
  return (
    <div className={styles.drop} data-hot={dragging || undefined}>
      <KindPicker value={kind} onChange={setKind} className={styles.kinds} />
      <h2 className={styles.dropTitle}>{opening ? `Opening “${opening}”…` : dragging ? 'Drop it to start' : `Drop your first ${what} here`}</h2>
      <p className={styles.dropText}>Choose one, then the version to compare it with — or both at once.</p>
      <button type="button" className={`${styles.pill} ${styles.primary} ${styles.large}`} onClick={picker.open} disabled={!!opening}>
        <Icon name="upload" />
        Choose one or two files
      </button>
      {picker.input}
      <p className={styles.hint}>{MEDIA[kind].formats}</p>
    </div>
  );
}

/** A button that starts a comparison from the file dialog. */
export function StartButton({ className, children }: { className?: string; children: ReactNode }) {
  const { opening, start } = useStart();
  const picker = useFilePicker((files) => start(files), ACCEPT, true);
  return (
    <>
      <button type="button" className={className} onClick={picker.open} disabled={!!opening}>
        {opening ? `Opening “${opening}”…` : children}
      </button>
      {picker.input}
    </>
  );
}
