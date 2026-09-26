'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ACCEPTED_EXTENSIONS, acceptList } from '../formats/extensions';
import { handOffFiles } from '../lib/handoff';
import { useFilePicker, usePageDrop } from './file-drop';
import { Icon } from './icons';
import styles from './site.module.css';

const ACCEPT = acceptList(ACCEPTED_EXTENSIONS);
const NEXT_STEP = '/compare/new/';

/** Starts a comparison with the files picked here: the next page asks for the other version. */
function useStart() {
  const router = useRouter();
  const [opening, setOpening] = useState('');
  const start = (files: File[]) => {
    handOffFiles(files);
    setOpening(files[0]!.name);
    router.push(NEXT_STEP);
  };
  return { opening, start };
}

/** The landing page's drop target. Files dropped anywhere on the page land here. */
export function StartDropzone() {
  const { opening, start } = useStart();
  const dragging = usePageDrop(start);
  const picker = useFilePicker(start, ACCEPT);
  return (
    <div className={styles.drop} data-hot={dragging || undefined}>
      <span className={styles.siglum} aria-hidden="true">
        A
      </span>
      <h2 className={styles.dropTitle}>{opening ? `Opening “${opening}”…` : dragging ? 'Drop it to start' : 'Drop your first document here'}</h2>
      <p className={styles.dropText}>Then choose the version to compare it with.</p>
      <button type="button" className={`${styles.pill} ${styles.primary} ${styles.large}`} onClick={picker.open} disabled={!!opening}>
        <Icon name="upload" />
        Choose a file
      </button>
      {picker.input}
      <p className={styles.hint}>Word, Google Docs, PDF, OpenDocument, RTF, EPUB, HTML, Markdown, CSV or text</p>
    </div>
  );
}

/** A button that starts a comparison from the file dialog. */
export function StartButton({ className, children }: { className?: string; children: ReactNode }) {
  const { opening, start } = useStart();
  const picker = useFilePicker(start, ACCEPT);
  return (
    <>
      <button type="button" className={className} onClick={picker.open} disabled={!!opening}>
        {opening ? `Opening “${opening}”…` : children}
      </button>
      {picker.input}
    </>
  );
}
