import type { Metadata } from 'next';
import Link from 'next/link';
import { Contact, LegalPage } from '../../components/legal-page';

export const metadata: Metadata = {
  title: 'Terms of use',
  description: 'The terms for using Collate, the in-browser document, image and audio comparison tool.',
};

export default function TermsPage() {
  return (
    <LegalPage
      href="/terms/"
      title="Terms of use"
      lead="The ground rules for using Collate. They are short, because Collate never holds your files."
      summary={[
        'Collate is free to use, and you keep every right in the files you compare.',
        'Check important results yourself: Collate is a tool, not legal or professional advice.',
        'It is provided as is, without warranties, as far as the law allows.',
      ]}
      sections={[
        {
          id: 'agreement',
          title: 'Using Collate',
          body: (
            <p>
              By using the Collate website or app (“Collate”) you agree to these terms. If you don’t agree, please don’t use it. These terms work together with the{' '}
              <Link href="/privacy/">privacy policy</Link> and the <Link href="/cookies/">cookies and storage</Link> page.
            </p>
          ),
        },
        {
          id: 'service',
          title: 'What Collate is',
          body: (
            <p>
              Collate compares two versions of a document, image or recording and helps you copy changes between them. It runs in your browser: your files are processed on your device and are not
              uploaded to us. Features may be added, changed or removed over time, and the site may occasionally be unavailable.
            </p>
          ),
        },
        {
          id: 'content',
          title: 'Your files',
          body: (
            <>
              <p>You keep all rights in the files you open and the files you save. We claim none, and as your files never reach us, we can’t use them.</p>
              <p>
                You are responsible for having the right to open, compare and share the files you use, and for keeping your own copies. Collate stores your work only in your browser, which can be
                cleared; don’t rely on it as your only copy.
              </p>
            </>
          ),
        },
        {
          id: 'use',
          title: 'Acceptable use',
          body: (
            <>
              <p>Please don’t:</p>
              <ul>
                <li>use Collate to break the law or anyone’s rights, including copyright and confidentiality;</li>
                <li>try to disrupt, overload or attack the site or the services it relies on;</li>
                <li>pass Collate off as your own product, or use its name or look in a way that suggests we endorse something we don’t.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'results',
          title: 'Check what matters',
          body: (
            <>
              <p>
                Collate works hard to find every change, but no comparison is perfect. Some formats (PDF in particular) have to be reconstructed, some content isn’t compared (such as headers, footers
                and comments), and options you choose can hide differences.
              </p>
              <p>
                <strong>Before you sign, file, publish or rely on a document, check it yourself.</strong> Flags on amounts, dates, obligations and similar changes are aids, not legal, financial or
                professional advice, and neither is any summary or suggestion from Claude.
              </p>
            </>
          ),
        },
        {
          id: 'third-parties',
          title: 'Other services',
          body: (
            <p>
              Some optional features use other services: cloud drives (Google Drive, OneDrive, Dropbox), Google Docs, the jsDelivr and Hugging Face download networks, and Claude. Using them is also
              subject to their own terms. We aren’t responsible for those services.
            </p>
          ),
        },
        {
          id: 'open-source',
          title: 'Open-source software',
          body: (
            <p>
              Collate is built with open-source software, used under its own licenses. The <Link href="/licenses/">open-source licenses</Link> page lists it. Nothing in these terms limits your rights
              under those licenses.
            </p>
          ),
        },
        {
          id: 'warranty',
          title: 'No warranty',
          body: (
            <p>
              Collate is provided “as is” and “as available”, without warranties of any kind, whether express or implied, including fitness for a particular purpose, accuracy and non-infringement, to
              the fullest extent the law allows.
            </p>
          ),
        },
        {
          id: 'liability',
          title: 'Limitation of liability',
          body: (
            <p>
              To the fullest extent the law allows, we are not liable for any indirect, incidental or consequential loss, or for lost data, profits or opportunities, arising from your use of Collate
              or your reliance on its results. Nothing in these terms excludes liability that cannot be excluded by law, and if you use Collate as a consumer, your statutory rights are not affected.
            </p>
          ),
        },
        {
          id: 'changes',
          title: 'Changes to these terms',
          body: <p>We may update these terms. The new version will be posted here with a new date at the top, and using Collate after that means you accept it.</p>,
        },
        {
          id: 'contact',
          title: 'Contact',
          body: (
            <p>
              Questions about these terms can be raised through <Contact />.
            </p>
          ),
        },
      ]}
    />
  );
}
