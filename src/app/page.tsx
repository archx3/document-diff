import Link from 'next/link';
import type { ReactNode } from 'react';
import { ComparisonPreview } from '../components/comparison-preview';
import type { IconName } from '../components/icons';
import { Icon } from '../components/icons';
import { SiteFooter, SiteHeader } from '../components/site-header';
import site from '../components/site.module.css';
import { StartButton, StartDropzone } from '../components/start-dropzone';
import styles from './landing.module.css';

const FORMATS: Array<[string, string?]> = [
  ['Word', '.docx .doc'],
  ['Google Docs'],
  ['PDF', '.pdf'],
  ['OpenDocument', '.odt'],
  ['Rich Text', '.rtf'],
  ['EPUB', '.epub'],
  ['Web pages', '.html'],
  ['Markdown', '.md'],
  ['CSV', '.csv .tsv'],
  ['Text and code', '.txt .json …'],
];

const FEATURES: Array<{ icon: IconName; tone: string; title: string; text: string }> = [
  {
    icon: 'columns',
    tone: 'teal',
    title: 'Every change, marked',
    text: 'Paragraphs line up side by side. Words only in A are marked in red, words only in B in green, and formatting changes are flagged on their own.',
  },
  {
    icon: 'swap',
    tone: 'terra',
    title: 'Copy changes across',
    text: 'Take a single word, a paragraph, a table row or everything at once, in either direction. Every copy can be undone.',
  },
  {
    icon: 'doc',
    tone: 'ink',
    title: 'Formatting stays put',
    text: 'Word and OpenDocument files keep their styles, headers, footers and page setup. Only the paragraphs you copy change.',
  },
  {
    icon: 'download',
    tone: 'amber',
    title: 'Save it your way',
    text: 'Export the result as Word, PDF, OpenDocument, RTF, a web page, Markdown or plain text, or copy it formatted into Google Docs.',
  },
  {
    icon: 'lock',
    tone: 'green',
    title: 'Private by design',
    text: 'Documents are read and written inside your browser tab. Nothing is uploaded, and there is no account to create.',
  },
  {
    icon: 'keyboard',
    tone: 'blue',
    title: 'Quick from the keyboard',
    text: 'Jump between changes with N and P, copy the current one with Alt and an arrow key, and undo with Ctrl+Z.',
  },
];

const STEPS: Array<[string, string]> = [
  ['Drop the first version', 'Drag a document onto this page, or choose one from your computer.'],
  ['Add the other version', 'Pick the draft to compare it with. Collate lines the two up and marks every change.'],
  ['Keep what you want', 'Copy edits across with a click, then save the merged document in its own format.'],
];

function Eyebrow({ children, tone }: { children: ReactNode; tone?: 'terra' }) {
  return (
    <p className={styles.eyebrow} data-tone={tone}>
      {children}
    </p>
  );
}

export default function Home() {
  return (
    <div className={site.page}>
      <SiteHeader>
        <nav className={site.nav} aria-label="Sections">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#formats">Formats</a>
        </nav>
        <div className={site.actions}>
          <Link href="/compare/sample/" className={`${site.pill} ${site.quiet} ${site.small} ${site.hideNarrow}`}>
            See a sample
          </Link>
          <Link href="/compare/new/" className={`${site.pill} ${site.primary} ${site.small}`}>
            Start comparing
            <Icon name="arrow" className={site.arrow} />
          </Link>
        </div>
      </SiteHeader>

      <main>
        <section className={styles.hero}>
          <p className={styles.badge}>
            <span className={styles.badgeNew}>
              <Icon name="bolt" size={12} />
              New
            </span>
            Save any document as a PDF
          </p>
          <h1 className={styles.title}>
            See every change,
            <br />
            <em>word by word.</em>
          </h1>
          <p className={styles.lead}>
            Collate lines up two versions of a document side by side, marks every edit down to the word, and lets you copy the changes you want from one version to the other.
            It all happens in your browser.
          </p>
          <div className={styles.start}>
            <StartDropzone />
          </div>
          <p className={styles.alt}>
            No file to hand?{' '}
            <Link href="/compare/sample/" className={site.textLink}>
              See a sample comparison
              <Icon name="arrow" className={site.arrow} />
            </Link>
          </p>
          <ul className={styles.assurances}>
            <li>No account</li>
            <li>Nothing uploaded</li>
            <li>Word, PDF, Google Docs and more</li>
          </ul>
        </section>

        <section className={styles.preview}>
          <ComparisonPreview />
        </section>

        <section id="formats" className={`${styles.band} ${styles.formats}`}>
          <p className={styles.formatsTitle}>Reads the files you already have</p>
          <ul className={styles.formatList}>
            {FORMATS.map(([name, ext]) => (
              <li key={name}>
                {name}
                {ext && <span>{ext}</span>}
              </li>
            ))}
          </ul>
        </section>

        <section id="features" className={styles.band}>
          <header className={styles.sectionHead}>
            <Eyebrow>What it does</Eyebrow>
            <h2 className={styles.h2}>Everything you need to reconcile two drafts</h2>
            <p className={styles.sectionLead}>For contracts, papers, briefs and manuscripts: anything that comes back with changes.</p>
          </header>
          <ul className={styles.features}>
            {FEATURES.map((f) => (
              <li key={f.title} className={styles.feature}>
                <span className={styles.featureIcon} data-tone={f.tone}>
                  <Icon name={f.icon} size={22} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="how" className={`${styles.band} ${styles.tinted}`}>
          <header className={styles.sectionHead}>
            <Eyebrow tone="terra">How it works</Eyebrow>
            <h2 className={styles.h2}>
              Two drafts in, <em>one clean copy out</em>
            </h2>
          </header>
          <ol className={styles.steps}>
            {STEPS.map(([title, text], i) => (
              <li key={title} className={styles.stepItem}>
                <span className={styles.stepNumber}>{String(i + 1).padStart(2, '0')}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
          <p className={styles.bandCta}>
            <Link href="/compare/new/" className={`${site.pill} ${site.primary}`}>
              Start a comparison
              <Icon name="arrow" className={site.arrow} />
            </Link>
          </p>
        </section>

        <section className={`${styles.band} ${styles.split}`}>
          <div className={styles.splitText}>
            <Eyebrow>Round trip</Eyebrow>
            <h2 className={styles.h2}>At home with Google Docs and Word</h2>
            <p>
              Download a Google Doc as Word or paste it straight in: headings, lists, tables, bold, italic and links come along. When you are done, upload the merged file to Drive,
              or paste the formatted text back over the original.
            </p>
            <ul className={styles.checks}>
              <li>
                <span className={styles.check}>
                  <Icon name="check" />
                </span>
                Word and OpenDocument files keep their own styles, headers, footers and page setup
              </li>
              <li>
                <span className={styles.check}>
                  <Icon name="check" />
                </span>
                Tracked changes are compared as if accepted, and kept as they are when you export
              </li>
              <li>
                <span className={styles.check}>
                  <Icon name="check" />
                </span>
                PDFs, EPUBs and old .doc files can be compared and copied from, then saved in another format
              </li>
            </ul>
          </div>
          <div className={styles.menu} aria-hidden="true">
            <p className={styles.menuTitle}>B: contract-v2.docx</p>
            <p className={styles.menuItem} data-on="">
              <Icon name="download" />
              <span>
                Word document <small>.docx</small>
                <em>Keeps the original styles, headers and layout</em>
              </span>
            </p>
            <p className={styles.menuItem}>
              <Icon name="copy" />
              <span>
                Copy formatted text
                <em>Paste into Google Docs or Word</em>
              </span>
            </p>
            <hr />
            <p className={styles.menuTitle}>Download as</p>
            {[
              ['PDF', 'pdf', 'For reading, printing and sharing'],
              ['OpenDocument text', 'odt', 'For LibreOffice and other office apps'],
              ['Rich Text', 'rtf', 'Opens in almost any word processor'],
              ['Web page', 'html'],
              ['Markdown', 'md'],
            ].map(([label, ext, hint]) => (
              <p key={ext} className={styles.menuItem}>
                <Icon name="doc" />
                <span>
                  {label} <small>.{ext}</small>
                  {hint && <em>{hint}</em>}
                </span>
              </p>
            ))}
          </div>
        </section>

        <section className={`${styles.band} ${styles.tinted} ${styles.privacy}`}>
          <span className={styles.privacyIcon}>
            <Icon name="lock" size={26} />
          </span>
          <h2 className={styles.h2}>Your documents never leave your browser</h2>
          <p className={styles.sectionLead}>
            Collate reads, compares and saves files inside the tab you are using. There is no server to upload to and no account to create, so private drafts stay private.
          </p>
        </section>

        <section className={styles.final}>
          <h2 className={styles.h2}>Ready when your next draft is.</h2>
          <p>Choose the first version and Collate will ask for the other. You will see every change in seconds.</p>
          <div className={styles.finalActions}>
            <StartButton className={`${site.pill} ${site.large} ${styles.finalPrimary}`}>
              <Icon name="upload" />
              Choose your first document
            </StartButton>
          </div>
          <p className={styles.finalLink}>
            <Link href="/compare/sample/">or see a sample comparison first</Link>
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
