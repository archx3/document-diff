import type { Metadata } from 'next';
import Link from 'next/link';
import content from '../../components/content.module.css';
import type { Question } from '../../components/help-search';
import { HelpSearch } from '../../components/help-search';
import { Icon } from '../../components/icons';
import type { Shortcut } from '../../components/key-tester';
import { KeyTester } from '../../components/key-tester';
import type { Step } from '../../components/replica/walkthrough';
import { Walkthrough } from '../../components/replica/walkthrough';
import { SitePage } from '../../components/site-header';

export const metadata: Metadata = {
  title: 'Help',
  description: 'Answers to common questions about Collate, where to find each tool, and every keyboard shortcut.',
};

const GROUPS: Array<{ title: string; items: Question[] }> = [
  {
    title: 'Getting started',
    items: [
      {
        q: 'How do I compare two documents?',
        keys: 'start begin new load open choose files drop',
        a: (
          <>
            <p>
              Drop the first version on the <Link href="/">start page</Link>, or <Link href="/compare/new/">choose it</Link>, then choose the other version. You can also choose both at once. Collate
              opens them side by side with every change marked.
            </p>
            <p>
              The <Link href="/guides/documents/">documents walkthrough</Link> shows the rest.
            </p>
          </>
        ),
      },
      {
        q: 'Which files can I compare?',
        keys: 'formats types word docx pdf odt rtf epub html markdown csv txt json images png jpg audio mp3 wav',
        a: (
          <p>
            Documents (Word, Google Docs, PDF, OpenDocument, RTF, EPUB, web pages, Markdown, CSV and TSV, and text and code files), pictures (PNG, JPEG, GIF, WebP, SVG, BMP) and recordings (MP3,
            WAV, M4A/AAC, Ogg/Opus, FLAC, WebM). Choose what you are comparing first; the pickers then offer those files.
          </p>
        ),
      },
      {
        q: 'Can I compare a Word file with a PDF?',
        keys: 'mixed different formats',
        a: (
          <p>
            Yes. The start page asks for two files of the same kind, but in the workspace you can replace either side with any document, in any format. The{' '}
            <Link href="/samples/#documents">Word against PDF sample</Link> shows how it looks.
          </p>
        ),
      },
      {
        q: 'Do I need an account?',
        keys: 'sign up login register free',
        a: <p>No. There is no account and nothing to sign in to. Collate runs in your browser tab.</p>,
      },
      {
        q: 'Can I use it offline?',
        keys: 'install app pwa offline',
        a: (
          <p>
            Yes. Install it with your browser’s <i>Install</i> button and it keeps working without a connection once opened. Saving a PDF and transcribing audio need to download their tools the first
            time.
          </p>
        ),
      },
    ],
  },
  {
    title: 'Comparing and copying',
    items: [
      {
        q: 'What do the colours mean?',
        keys: 'red green blue marks highlight colors',
        a: (
          <p>
            Red words are only in A, green words only in B. A blue bar marks a changed paragraph, and a hatched block marks a paragraph only one side has. Formatting-only changes are flagged on their
            own.
          </p>
        ),
      },
      {
        q: 'How do I copy a change from one version to the other?',
        keys: 'merge apply use accept arrow',
        a: (
          <p>
            Use the arrows between the columns for a whole paragraph, click a marked word for just that edit, or press <kbd>Alt</kbd>+<kbd>→</kbd> or <kbd>Alt</kbd>+<kbd>←</kbd> for the current change.{' '}
            <i>Copy changes › Make B match A</i> copies everything. All of it can be undone.
          </p>
        ),
      },
      {
        q: 'Some changes aren’t real changes. Can I ignore them?',
        keys: 'ignore whitespace case quotes formatting options',
        a: <p>Yes. Compare options can ignore formatting, letter case, extra spaces, empty paragraphs, and curly versus straight quotes and dashes.</p>,
      },
      {
        q: 'Why does a moved paragraph show as moved?',
        keys: 'move moved reorder',
        a: <p>When a paragraph moved and its text is the same or nearly the same, Collate shows it as moved, with a link to where it went, instead of as removed in one place and added in another.</p>,
      },
      {
        q: 'Are headers, footers and comments compared?',
        keys: 'header footer comments tracked changes',
        a: <p>No, only the document body. Headers, footers and comments stay in the file when you export. Tracked changes are compared as if they were all accepted, and are kept as they are.</p>,
      },
    ],
  },
  {
    title: 'Saving and sharing',
    items: [
      {
        q: 'Will exporting keep my Word formatting?',
        keys: 'export save docx styles layout',
        a: <p>Yes. A document loaded from Word or OpenDocument is saved from the original file, with only the paragraphs you copied changed. Styles, headers, footers and page setup stay.</p>,
      },
      {
        q: 'How do I get the result back into Google Docs?',
        keys: 'google docs drive upload paste',
        a: (
          <p>
            Either <i>Export › Download Word document</i> and upload it in Google Docs with <i>File › Open › Upload</i>, or <i>Export › Copy formatted text</i> and paste over the original.
          </p>
        ),
      },
      {
        q: 'What is a redline?',
        keys: 'tracked changes track word redline comments',
        a: <p>A Word file of B with every change from A as a tracked change, and your notes as Word comments. Accept them all in Word to get B, reject them all to get A. It can be a PDF instead.</p>,
      },
      {
        q: 'How do I send my review to someone?',
        keys: 'share collate file password',
        a: (
          <p>
            <i>Share</i> saves both documents and the whole review in one <code>.collate</code> file, optionally locked with a password. Whoever opens it in Collate carries on where you left off.
          </p>
        ),
      },
    ],
  },
  {
    title: 'Troubleshooting',
    items: [
      {
        q: 'My PDF says it has no text to compare',
        keys: 'scan scanned image ocr pdf',
        a: <p>The PDF is probably a scan: pictures of pages, with no text inside. Run it through OCR (most scanner apps and Adobe Acrobat can), or compare the original document instead.</p>,
      },
      {
        q: 'A password-protected PDF or DRM-protected book won’t open',
        keys: 'password encrypted drm locked',
        a: <p>Collate can’t read those. Open the file in the app it came from, remove the protection if you are allowed to, and save a copy.</p>,
      },
      {
        q: 'Pages, WordPerfect or spreadsheet files won’t load',
        keys: 'pages wordperfect xlsx excel numbers',
        a: <p>They aren’t read. Save them as Word or PDF first. For spreadsheets, save each sheet as CSV to compare it row by row.</p>,
      },
      {
        q: 'Saving a PDF doesn’t work offline',
        keys: 'pdf export offline network',
        a: <p>The PDF maker is downloaded the first time a PDF is saved, so that first time needs a connection. After that it is kept by the browser. Only the tool is downloaded; your document never leaves.</p>,
      },
      {
        q: 'My comparison disappeared',
        keys: 'lost reload storage cleared private window',
        a: (
          <p>
            Comparisons are kept in this browser only. Clearing site data, using a private window or switching browser starts afresh. See <Link href="/cookies/">cookies and storage</Link>.
          </p>
        ),
      },
    ],
  },
];

const FINDER: Step[] = [
  { title: 'Where do I start a new comparison?', focus: 'appbar', body: <p>In the app bar at the top: New comparison starts again with two documents, and Swap A and B turns them around. Help (?) is there too.</p> },
  { title: 'How do I go to the next change?', focus: 'nav', body: <p>The arrows at the left of the toolbar, or <kbd>N</kbd> and <kbd>P</kbd>.</p> },
  { title: 'How do I hide what didn’t change?', focus: 'fold', body: <p>Changes only, or <kbd>C</kbd>.</p> },
  { title: 'How do I see one column?', focus: 'view', body: <p>Switch to Unified, or press <kbd>V</kbd>.</p> },
  { title: 'Where do I leave notes?', focus: 'review', body: <p>Turn on Review mode (<kbd>R</kbd>), then select text or right-click a change.</p> },
  { title: 'How do I undo a copy?', focus: 'undo', body: <p>Undo and redo, at the start of the toolbar’s Edit group, or <kbd>Ctrl</kbd>+<kbd>Z</kbd>.</p> },
  { title: 'How do I copy every change at once?', focus: 'copy-all', body: <p>Copy changes › Make B match A (or the other way round).</p> },
  { title: 'Where are the redline, report and share?', focus: 'redline', body: <p>At the end of the toolbar’s Edit group.</p> },
  { title: 'Where is the list of changes?', focus: 'list', body: <p>The last button in the toolbar, or <kbd>S</kbd>.</p> },
  { title: 'How do I save the merged document?', focus: 'export', body: <p>Export, on the head of the column you want to save.</p> },
];

const SHORTCUTS: Shortcut[] = [
  [['N', 'P'], 'Next / previous change', ['N', 'P', 'J', 'K']],
  [['Page Down', 'Page Up'], 'Next / previous page', ['PageDown', 'PageUp']],
  [['Alt', '→'], 'Use A’s version of the current change in B', ['Alt+ArrowRight']],
  [['Alt', '←'], 'Use B’s version of the current change in A', ['Alt+ArrowLeft']],
  [['Ctrl/⌘', 'Z'], 'Undo', ['Mod+Z']],
  [['Ctrl/⌘', 'Shift', 'Z'], 'Redo', ['Mod+Shift+Z']],
  [['A', 'X'], 'Accept / reject the current change and go to the next', ['A', 'X']],
  [['R'], 'Review mode', ['R']],
  [['G'], 'Spelling, grammar and contract checks', ['G']],
  [['C'], 'Changes only', ['C']],
  [['V'], 'Side by side / unified', ['V']],
  [['B'], 'Connection bands', ['B']],
  [['S'], 'List of changes', ['S']],
  [['M'], 'Minimap', ['M']],
  [['L'], 'Line numbers', ['L']],
  [['1', '–', '4'], 'Picture modes; 1–3 draw audio as waveform, spectrogram, loudness', ['1', '2', '3', '4']],
  [['?'], 'Help', ['?']],
];

export default function HelpPage() {
  return (
    <SitePage current="/help/">
      <section className={content.hero}>
        <p className={content.eyebrow}>Help</p>
        <h1 className={content.title}>
          How can we <em>help?</em>
        </h1>
        <p className={content.lead}>Answers to common questions, where to find each tool, and every keyboard shortcut.</p>
      </section>

      <section className={content.band} aria-label="Questions" style={{ paddingTop: 48 }}>
        <div style={{ maxWidth: 820, margin: '0 auto', textAlign: 'center' }}>
          <HelpSearch groups={GROUPS} />
        </div>
      </section>

      <section className={`${content.band} ${content.tinted} ${content.full}`} aria-labelledby="where">
        <header className={content.sectionHead}>
          <div>
            <h2 id="where" className={content.h2}>
              Where is it?
            </h2>
            <p className={content.sectionLead}>Pick a question to see the answer lit up on a replica of the workspace. The replica works, so you can try it straight away.</p>
          </div>
        </header>
        <Walkthrough kind="text" steps={FINDER} label="Question" wide />
      </section>

      <section id="shortcuts" className={content.band} aria-labelledby="keys">
        <header className={content.sectionHead}>
          <div>
            <h2 id="keys" className={content.h2}>
              Keyboard shortcuts
            </h2>
            <p className={content.sectionLead}>They work in the workspace whenever you aren’t typing in a box. Try them here first.</p>
          </div>
        </header>
        <KeyTester shortcuts={SHORTCUTS} />
      </section>

      <section className={`${content.band} ${content.tinted}`} aria-label="More help">
        <ul className={content.tips}>
          <li>
            <b>Walkthroughs</b>
            Step-by-step tours for <Link href="/guides/documents/">documents</Link>, <Link href="/guides/images/">images</Link> and <Link href="/guides/audio/">audio</Link>.
          </li>
          <li>
            <b>Samples</b>
            <Link href="/samples/">Files to practise on</Link>, in every kind Collate compares.
          </li>
          <li>
            <b>Privacy</b>
            Your files stay in your browser. <Link href="/privacy/">Read how</Link>.
          </li>
        </ul>
        <div className={content.callout}>
          <Icon name="keyboard" size={18} />
          <p>
            In the workspace, press <kbd>?</kbd> at any time for the shortcuts.
          </p>
        </div>
      </section>
    </SitePage>
  );
}
