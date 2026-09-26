'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { Doc } from '../core/model';
import { ACCEPTED_EXTENSIONS, acceptList, extensionOf, fileFormat, withArticle } from '../formats/extensions';
import { handOffDocs, takeFiles } from '../lib/handoff';
import { useFilePicker, usePageDrop } from './file-drop';
import { Icon } from './icons';
import styles from './new-comparison.module.css';
import site from './site.module.css';

type Side = 'a' | 'b';

type Slot = { status: 'empty' } | { status: 'reading'; name: string } | { status: 'ready'; name: string; doc: Doc; words: number };

interface Problem {
  side: Side;
  message: string;
  /** The file was a shortcut to this Google Doc. */
  googleDocId?: string;
}

const ANY_FILE = acceptList(ACCEPTED_EXTENSIONS);
const WORKSPACE = '/compare/';

/** Reads a file into a document, or throws an error that says why it can't be compared. */
async function readDocument(file: File): Promise<{ doc: Doc; words: number }> {
  const [{ LoadError, loadFile }, { isBlank, wordCount }] = await Promise.all([import('../formats/load'), import('../core/model')]);
  const doc = await loadFile(file);
  if (!doc.blocks.some((b) => b.type !== 'marker' && !isBlank(b))) throw new LoadError(`"${file.name}" has no text to compare.`);
  return { doc, words: wordCount(doc) };
}

function upperFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Picks the two versions to compare, one after the other. The second must be
 * the same kind of file as the first. The landing page hands over the first.
 */
export function NewComparison() {
  const router = useRouter();
  const [a, setA] = useState<Slot>({ status: 'empty' });
  const [b, setB] = useState<Slot>({ status: 'empty' });
  const [problem, setProblem] = useState<Problem | null>(null);
  // Each side counts its reads, so a file picked while another is still being read wins.
  const reads = useRef({ a: 0, b: 0 });

  const format = a.status === 'ready' ? fileFormat(a.name) : undefined;
  const step = a.status === 'ready' ? 2 : 1;

  async function read(side: Side, file: File): Promise<Extract<Slot, { status: 'ready' }> | null> {
    const n = ++reads.current[side];
    const set = side === 'a' ? setA : setB;
    setProblem(null);
    set({ status: 'reading', name: file.name });
    try {
      const { doc, words } = await readDocument(file);
      if (reads.current[side] !== n) return null;
      const slot = { status: 'ready', name: file.name, doc, words } as const;
      set(slot);
      return slot;
    } catch (err) {
      if (reads.current[side] !== n) return null;
      console.error(err);
      set({ status: 'empty' });
      setProblem({ side, message: err instanceof Error ? err.message : String(err), googleDocId: (err as { googleDocId?: string }).googleDocId });
      return null;
    }
  }

  async function chooseFirst(files: File[]) {
    const [first, second] = files;
    if (!first) return;
    reads.current.b++;
    setB({ status: 'empty' });
    const slot = await read('a', first);
    // A second file dropped together with the first is taken as the other version.
    if (slot && second) await chooseOther([second], slot);
  }

  async function chooseOther(files: File[], first: Slot = a) {
    const file = files[0];
    if (!file || first.status !== 'ready') return;
    const want = fileFormat(first.name);
    if (want && !want.exts.includes(extensionOf(file.name))) {
      const got = fileFormat(file.name);
      setProblem({
        side: 'b',
        message: `“${file.name}” is ${got ? withArticle(got.name) : 'a file without an extension'}. Choose ${withArticle(want.name)} to compare with “${first.name}”.`,
      });
      return;
    }
    const slot = await read('b', file);
    if (!slot) return;
    handOffDocs(first.doc, slot.doc);
    router.push(WORKSPACE);
  }

  const dragging = usePageDrop((files) => void (a.status === 'ready' ? chooseOther(files) : chooseFirst(files)));
  const pickFirst = useFilePicker((files) => void chooseFirst(files), ANY_FILE);
  const pickOther = useFilePicker((files) => void chooseOther(files), format ? acceptList(format.exts) : ANY_FILE);

  // Files from the landing page are taken once: in development React runs this effect twice.
  const handed = useRef<File[] | null>(null);
  const start = useEffectEvent((files: File[]) => void chooseFirst(files));
  useEffect(() => {
    handed.current ??= takeFiles();
    if (handed.current.length) start(handed.current);
    router.prefetch(WORKSPACE);
  }, [router]);

  const onlyHint = format
    ? `${upperFirst(format.many)} only${format.exts.length > 1 ? ` (${format.exts.slice(0, 2).map((e) => `.${e}`).join(', ')})` : ''}`
    : 'Word, Google Docs, PDF, OpenDocument, RTF, EPUB, HTML, Markdown, CSV or text';

  return (
    <main className={styles.main}>
      <p className={styles.step}>
        <span className={styles.dots} aria-hidden="true">
          <span data-on="" />
          <span data-on={step === 2 ? '' : undefined} />
        </span>
        Step {step} of 2
      </p>
      <h1 className={styles.title}>{step === 1 ? 'Choose the first version' : 'Now choose the other version'}</h1>
      <p className={styles.lead}>
        {step === 1 ? (
          'Start with the document you have. Collate asks for the version to compare it with next.'
        ) : (
          <>
            Collate will line it up with <b>{a.status === 'ready' ? a.name : ''}</b> and mark every change.
          </>
        )}
      </p>

      <div className={styles.cards}>
        {a.status === 'ready' ? (
          <section className={`${styles.card} ${styles.chosen}`} aria-label="First version">
            <span className={site.siglum} aria-hidden="true">
              A
            </span>
            <h2 className={site.dropTitle}>{a.name}</h2>
            <p className={styles.meta}>
              <span className="badge">{format?.name ?? 'Document'}</span>
              <span>{a.words.toLocaleString()} words</span>
            </p>
            <button type="button" className={`${site.pill} ${site.secondary} ${site.small}`} onClick={pickFirst.open}>
              Choose a different file
            </button>
          </section>
        ) : (
          <section className={`${site.drop} ${styles.card}`} data-hot={(dragging && step === 1) || undefined} aria-label="First version" aria-busy={a.status === 'reading'}>
            <span className={site.siglum} aria-hidden="true">
              A
            </span>
            {a.status === 'reading' ? (
              <Reading name={a.name} />
            ) : (
              <>
                <h2 className={site.dropTitle}>The first version</h2>
                <p className={site.dropText}>Drop it anywhere on this page, or</p>
                <button type="button" className={`${site.pill} ${site.primary}`} onClick={pickFirst.open}>
                  <Icon name="upload" />
                  Choose a file
                </button>
                <p className={site.hint}>{onlyHint}</p>
              </>
            )}
          </section>
        )}

        <section
          className={`${site.drop} ${styles.card}`}
          data-hot={(dragging && step === 2) || undefined}
          data-waiting={step === 1 || undefined}
          aria-label="Other version"
          aria-busy={b.status !== 'empty'}
        >
          <span className={site.siglum} aria-hidden="true">
            B
          </span>
          {b.status === 'reading' ? (
            <Reading name={b.name} />
          ) : b.status === 'ready' ? (
            <>
              <h2 className={site.dropTitle}>{b.name}</h2>
              <p className={site.dropText}>Opening the comparison…</p>
            </>
          ) : step === 1 ? (
            <>
              <h2 className={site.dropTitle}>The other version</h2>
              <p className={site.dropText}>Choose the first version, then this one.</p>
            </>
          ) : (
            <>
              <h2 className={site.dropTitle}>The other version</h2>
              <p className={site.dropText}>Drop it anywhere on this page, or</p>
              <button type="button" className={`${site.pill} ${site.primary}`} onClick={pickOther.open}>
                <Icon name="upload" />
                Choose a file
              </button>
              <p className={site.hint}>{onlyHint}</p>
            </>
          )}
        </section>
      </div>
      {pickFirst.input}
      {pickOther.input}

      {problem && (
        <div className={styles.problem} role="alert">
          <Icon name="alert" size={18} />
          <p>
            {problem.message}
            {problem.googleDocId && (
              <>
                {' '}
                <a href={`https://docs.google.com/document/d/${encodeURIComponent(problem.googleDocId)}/export?format=docx`} target="_blank" rel="noopener noreferrer">
                  Download it as a Word document
                </a>
                , then choose that file.
              </>
            )}
          </p>
        </div>
      )}

      <p className={styles.privacy}>
        <Icon name="lock" />
        Files are read in this browser tab. Nothing is uploaded.
      </p>
    </main>
  );
}

function Reading({ name }: { name: string }) {
  return (
    <>
      <h2 className={site.dropTitle}>{name}</h2>
      <p className={`${site.dropText} ${styles.reading}`}>
        <span className={styles.spinner} aria-hidden="true" />
        Reading…
      </p>
    </>
  );
}
