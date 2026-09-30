import type { Metadata } from 'next';
import Link from 'next/link';
import content from '../../components/content.module.css';
import { Contact, LegalPage } from '../../components/legal-page';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'How Collate handles your documents and data: files are read in your browser and never uploaded.',
};

export default function PrivacyPage() {
  return (
    <LegalPage
      href="/privacy/"
      title="Privacy policy"
      lead="Collate is built so that your documents stay with you. This page explains what that means in practice."
      summary={[
        'Your files are read, compared and saved inside your browser tab. They are never uploaded to us.',
        'There are no accounts, no analytics and no advertising trackers.',
        'Your comparisons and settings are kept in your own browser, and you can clear them at any time.',
        'A few optional features fetch tools or talk to other services, only when you use them. They are listed below.',
      ]}
      sections={[
        {
          id: 'who',
          title: 'Who this covers',
          body: (
            <p>
              This policy covers the Collate website and app (“Collate”, “we”, “us”), including the installable version and the single-file version. It applies to everyone who uses them. Questions
              about it can be raised through <Contact />.
            </p>
          ),
        },
        {
          id: 'documents',
          title: 'Your documents',
          body: (
            <>
              <p>
                When you choose, drop or paste a document, image or recording, it is read by code running in your browser. Comparing, copying changes, reviewing and exporting all happen there too.{' '}
                <strong>The contents of your files are never sent to us</strong>, and we have no server that could receive them.
              </p>
              <p>
                The same is true of the <Link href="/samples/">samples</Link>: they are downloaded from this site like any other page, then read in your browser.
              </p>
            </>
          ),
        },
        {
          id: 'collect',
          title: 'What we collect',
          body: (
            <>
              <p>
                Nothing about you or your documents. Collate has no sign-up, no analytics, no advertising and no tracking pixels, and it sets no cookies (see{' '}
                <Link href="/cookies/">cookies and storage</Link>).
              </p>
              <p>
                Like any website, the service that hosts Collate’s pages may keep standard server logs, such as the IP address that asked for a page, the time and the browser’s user agent, to run and
                protect its service. Those logs are handled under the hosting provider’s own privacy policy. They never include your documents.
              </p>
            </>
          ),
        },
        {
          id: 'browser',
          title: 'What stays in your browser',
          body: (
            <>
              <p>So that a reload doesn’t lose your work, Collate keeps some things in your browser’s own storage, on your device:</p>
              <ul>
                <li>the current comparison: both documents, the changes you copied and your place in them;</li>
                <li>your notes, highlights, decisions and the name you put on your notes;</li>
                <li>your view settings, theme and words you added to the spelling dictionary;</li>
                <li>the site’s pages and tools, so it works offline once installed.</li>
              </ul>
              <p>
                We can’t see any of it. It stays until you clear it, and a private window forgets it when it closes. The <Link href="/cookies/">cookies and storage</Link> page lists every item and how
                to clear them.
              </p>
            </>
          ),
        },
        {
          id: 'leaves',
          title: 'When something leaves your browser',
          body: (
            <>
              <p>Some features need something from, or send something to, another service. Each happens only when you use that feature:</p>
              <div className={content.tableWrap}>
                <table className={content.table}>
                  <thead>
                    <tr>
                      <th scope="col">Feature</th>
                      <th scope="col">What happens</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Saving a PDF</td>
                      <td>The PDF maker (pdfmake) is downloaded from the jsDelivr CDN the first time. Only the library is downloaded; your document is not sent.</td>
                    </tr>
                    <tr>
                      <td>Opening a PDF (single-file version)</td>
                      <td>The PDF reader (pdf.js) is downloaded from jsDelivr the first time. The website serves its own copy instead.</td>
                    </tr>
                    <tr>
                      <td>Transcribing audio</td>
                      <td>The speech model runs on your device. If this site doesn’t serve the model itself, it is downloaded once from Hugging Face. Your recordings are not sent.</td>
                    </tr>
                    <tr>
                      <td>Google Drive, OneDrive, Dropbox</td>
                      <td>When you choose to open a file from a cloud drive, that service’s own sign-in and picker open, and the file comes from it straight to your browser. That service’s privacy policy applies.</td>
                    </tr>
                    <tr>
                      <td>Google Docs links</td>
                      <td>Collate gives you a download link that opens in Google Docs with your own Google sign-in.</td>
                    </tr>
                    <tr>
                      <td>Claude features</td>
                      <td>
                        Only when Collate runs inside the Claude app, and only when you ask: the paragraphs or changed words you ask about are sent to Claude on your own account, after the app asks your
                        permission.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>The PDF libraries from jsDelivr are checked against a known fingerprint (subresource integrity), so a tampered copy is refused.</p>
            </>
          ),
        },
        {
          id: 'sharing',
          title: 'Files you share',
          body: (
            <p>
              A redline, report or <code>.collate</code> review file you download is yours, and it contains whatever you put in it, including your notes and the name on them. Who you send it to is
              up to you. A <code>.collate</code> file can be locked with a password (AES-GCM encryption, with the key derived from your password); we can’t recover a forgotten password.
            </p>
          ),
        },
        {
          id: 'children',
          title: 'Children',
          body: <p>Collate is a general-purpose tool and isn’t aimed at children. Because it collects no personal data, it holds none about children either.</p>,
        },
        {
          id: 'rights',
          title: 'Your rights',
          body: (
            <p>
              Data protection laws such as the GDPR give you rights over personal data held about you. As we hold none, there is nothing for us to give you, correct or delete: everything Collate keeps
              is in your own browser, under your control. For data held by a cloud drive, hosting provider or Claude, contact that service.
            </p>
          ),
        },
        {
          id: 'changes',
          title: 'Changes to this policy',
          body: <p>If this policy changes, the new version will be posted here with a new date at the top. A change that collects more data would be explained on this page before it takes effect.</p>,
        },
        {
          id: 'contact',
          title: 'Contact',
          body: (
            <p>
              Questions about privacy can be raised through <Contact />. Please don’t include the contents of private documents.
            </p>
          ),
        },
      ]}
    />
  );
}
