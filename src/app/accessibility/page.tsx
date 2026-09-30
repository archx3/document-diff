import type { Metadata } from 'next';
import Link from 'next/link';
import { Contact, LegalPage } from '../../components/legal-page';

export const metadata: Metadata = {
  title: 'Accessibility',
  description: 'Collate’s accessibility statement: what we aim for, what works today, and known limitations.',
};

export default function AccessibilityPage() {
  return (
    <LegalPage
      href="/accessibility/"
      title="Accessibility statement"
      lead="We want everyone to be able to compare documents with Collate, whatever device or assistive technology they use."
      sections={[
        {
          id: 'aim',
          title: 'What we aim for',
          body: <p>We aim for Collate to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA. We haven’t had it independently audited yet, so this statement is our own assessment.</p>,
        },
        {
          id: 'works',
          title: 'What works today',
          body: (
            <ul>
              <li>
                <strong>Keyboard:</strong> the workspace’s tools are buttons and menus you can reach with the keyboard, and the main actions have shortcuts (see <Link href="/help/#shortcuts">keyboard shortcuts</Link>).
              </li>
              <li>
                <strong>Screen readers:</strong> buttons have names, the toolbar and menus use the matching roles, and the change counter and comparison results are announced as they change.
              </li>
              <li>
                <strong>Not colour alone:</strong> changes are marked with a bar and a position as well as colour, and the list of changes gives each change’s words and counts in text.
              </li>
              <li>
                <strong>Light, dark and low contrast:</strong> Collate follows your system theme or the one you pick, and a low contrast mode drops borders and lines.
              </li>
              <li>
                <strong>Zoom and small screens:</strong> the pages reflow on narrow screens and at high zoom; on a phone the workspace shows one column.
              </li>
              <li>
                <strong>Motion:</strong> the workspace and the guides respect your system’s reduce motion setting.
              </li>
            </ul>
          ),
        },
        {
          id: 'limits',
          title: 'Known limitations',
          body: (
            <ul>
              <li>Picture comparisons are visual. The changed areas are counted and can be stepped through, but what changed inside a picture isn’t described in words.</li>
              <li>Audio comparisons show the recordings as pictures; the transcript is the best way to follow them with a screen reader.</li>
              <li>The replicas in the guides are simplified pictures of the workspace. The step text next to them says the same thing in words.</li>
              <li>How accessible an exported PDF or document is depends partly on the original document’s structure.</li>
            </ul>
          ),
        },
        {
          id: 'feedback',
          title: 'Feedback',
          body: (
            <p>
              If something in Collate is hard to use with your setup, please tell us through <Contact />, with the page, your browser and any assistive technology you use. We read every report and
              try to fix problems quickly.
            </p>
          ),
        },
      ]}
    />
  );
}
