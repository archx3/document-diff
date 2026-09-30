import type { Metadata } from 'next';
import Link from 'next/link';
import { GuidePage } from '../../../components/guide-page';
import type { Step } from '../../../components/replica/walkthrough';

export const metadata: Metadata = {
  title: 'Comparing documents',
  description: 'A step-by-step walkthrough of comparing two documents in Collate: reading the marks, copying changes, reviewing and exporting.',
};

const STEPS: Step[] = [
  {
    title: 'Two versions, side by side',
    focus: 'heads',
    body: (
      <>
        <p>
          The first version is <b>A</b>, on the left, and the other is <b>B</b>, on the right. Each column head gives the file’s name, its format and how many words it has.
        </p>
        <p>To change a document, use the menu on its head: load another file, paste from Google Docs or Word, or open one from a cloud drive.</p>
      </>
    ),
  },
  {
    title: 'Read the marks',
    focus: 'word',
    body: (
      <>
        <p>
          Words only in A are red, and words only in B are green. A blue bar down the side marks a changed paragraph. Where one document has a paragraph the other doesn’t, a line across the
          other marks where it would go (a hatched block, with connection bands off).
        </p>
        <p>Click a marked word to copy just that edit to the other side. Try it on the replica.</p>
      </>
    ),
  },
  {
    title: 'Step through the changes',
    focus: 'nav',
    body: (
      <p>
        The arrows go to the previous and next change, and the counter between the column heads says where you are. From the keyboard, <kbd>N</kbd> and <kbd>P</kbd> do the same.
      </p>
    ),
  },
  {
    title: 'Copy a change across',
    focus: 'copy',
    body: (
      <>
        <p>
          The arrows beside each change copy the whole of it across, however many paragraphs it runs to: » makes B read like A, « makes A read like B. A copied paragraph brings its
          formatting, links and pictures along.
        </p>
        <p>
          <kbd>Alt</kbd>+<kbd>→</kbd> and <kbd>Alt</kbd>+<kbd>←</kbd> copy the current change without the mouse.
        </p>
      </>
    ),
  },
  {
    title: 'Undo anything',
    focus: 'undo',
    body: (
      <p>
        Every copy can be undone and redone, with these buttons or <kbd>Ctrl</kbd>+<kbd>Z</kbd> and <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> (<kbd>⌘</kbd> on a Mac). Your
        comparison is also kept in this browser, so a reload carries on where you were.
      </p>
    ),
  },
  {
    title: 'Only the changes',
    focus: 'fold',
    body: (
      <p>
        <b>Changes only</b> (<kbd>C</kbd>) folds unchanged paragraphs away, so a long document shrinks to what differs. A line says how many paragraphs each fold hides.
      </p>
    ),
  },
  {
    title: 'Choose how to read it',
    focus: 'view',
    body: (
      <>
        <p>
          <b>Side by side</b> keeps each document in its own column. <b>Unified</b> (<kbd>V</kbd>) shows one column, with A’s version above B’s wherever they differ; on a phone it is the only view.
        </p>
        <p>
          Side by side, <b>connection bands</b> (<kbd>B</kbd>) join each change across the gutter while each document runs on unbroken; turn them off to line the paragraphs up in rows. A{' '}
          <b>minimap</b> (<kbd>M</kbd>) and <b>line numbers</b> (<kbd>L</kbd>) can go in the gutter too.
        </p>
      </>
    ),
  },
  {
    title: 'The list of changes',
    focus: 'list',
    body: (
      <p>
        The list (<kbd>S</kbd>) names every change with its words, and how many words are only in A (−) and only in B (+). Click one to go there. It can show only open or only flagged changes.
      </p>
    ),
  },
  {
    title: 'Accept or reject',
    focus: 'decide',
    body: (
      <>
        <p>
          Mark each change accepted or rejected, here or with <kbd>A</kbd> and <kbd>X</kbd>, which also move on to the next one.
        </p>
        <p>Changes that touch amounts, dates, obligations, parties or defined terms are flagged, so they are easy to find.</p>
      </>
    ),
  },
  {
    title: 'Leave notes',
    focus: 'review',
    body: (
      <p>
        <b>Review mode</b> (<kbd>R</kbd>) adds a margin for notes. Select text to highlight it or note on it, or mark a change <i>Looks right</i>, <i>Needs work</i> or <i>Idea</i>. Right-click
        anything marked for everything you can do with it.
      </p>
    ),
  },
  {
    title: 'Export the result',
    focus: 'export',
    body: (
      <>
        <p>
          <b>Export</b> on either column saves that document. A Word or OpenDocument file is saved in its own format, with only the copied paragraphs changed: its styles, headers, footers and page
          setup stay.
        </p>
        <p>Any document can also be saved as PDF, RTF, a web page, Markdown or text, or copied as formatted text to paste into Google Docs.</p>
      </>
    ),
  },
  {
    title: 'Share the review',
    focus: 'redline',
    body: (
      <>
        <p>
          <b>Redline</b> downloads B as a Word file with every change from A as a tracked change, and your notes as Word comments. It can be a PDF instead.
        </p>
        <p>
          <b>Share</b> saves both documents and the whole review in one <code>.collate</code> file, optionally with a password, for someone else to open in Collate.
        </p>
      </>
    ),
  },
];

export default function DocumentsGuide() {
  return (
    <GuidePage
      kind="text"
      href="/guides/documents/"
      title={
        <>
          Comparing <em>documents</em>
        </>
      }
      lead="From two drafts to one clean copy: how to read the comparison, copy the changes you want, review them and save the result. Every step works in the replica beside it."
      steps={STEPS}
      formats={[
        ['Word', '.docx .doc', 'Best for round trips: the original file is kept and only copied paragraphs change. Tracked changes are compared as if accepted.'],
        ['Google Docs', 'Paste or .docx', 'Download as Word, or copy everything in the doc and use Paste from Google Docs or Word.'],
        ['PDF', '.pdf', 'Paragraphs, headings, lists and tables are rebuilt from the page. A scan without text, or a password-protected PDF, cannot be read.'],
        ['OpenDocument', '.odt .fodt', 'Kept in its own format, like Word files.'],
        ['Rich Text, EPUB', '.rtf .epub', 'Read, compared and saved as another format. DRM-protected books cannot be read.'],
        ['Web pages, Markdown', '.html .mht .md', 'Headings, lists, tables and links come across.'],
        ['CSV and TSV', '.csv .tsv', 'Compared row by row as a table, and saved with the same separator.'],
        ['Text and code', '.txt .json .xml .yaml .py …', 'Compared line by line in a monospace font.'],
      ]}
      tips={[
        ['Mix formats freely', 'A Word draft can be compared with a PDF or a pasted Google Doc. The start page asks for matching formats; the workspace’s Replace menu takes anything.'],
        ['Many versions at once', 'Choose three or more drafts and they are ordered by name (v2 before v10). The version bar steps through them in pairs.'],
        ['What counts as a change', 'Compare options can ignore formatting, letter case, extra spaces or curly versus straight quotes, and mark changes by character instead of by word.'],
        ['Moved paragraphs', 'A paragraph that moved, unchanged or nearly so, shows as moved, with a link to where it went, rather than as removed and added.'],
      ]}
      sample={
        <>
          Want real files? The <Link href="/samples/#documents">document samples</Link> include the agreement as Word files, Word against PDF, a CSV price list and a JSON config.
        </>
      }
    />
  );
}
