import type { Metadata } from 'next';
import content from '../../components/content.module.css';
import { Contact, LegalPage } from '../../components/legal-page';

export const metadata: Metadata = {
  title: 'Cookies and storage',
  description: 'Collate sets no cookies. This page lists what it keeps in your browser’s own storage, and how to clear it.',
};

const ITEMS: Array<[string, string, string, string]> = [
  ['collate.theme', 'Local storage', 'The light or dark theme you picked. Removed when you go back to following your system.', 'Until cleared'],
  ['collate.prefs.v1', 'Local storage', 'View settings: side by side or unified, minimap, line numbers, connection bands and the like.', 'Until cleared'],
  ['collate.words.v1', 'Local storage', 'Words you added to the spelling dictionary.', 'Until cleared'],
  ['collate.author.v1', 'Local storage', 'The name you put on your notes.', 'Until cleared'],
  ['collate.tab', 'Session storage', 'An id for this tab, so a reload finds its own comparison.', 'Until the tab closes'],
  ['collate', 'IndexedDB', 'The comparison in each tab: the documents, the changes copied between them, your review and your place.', 'Until cleared'],
  ['collate-v2', 'Cache storage', 'The site’s pages and tools, kept by its service worker so Collate works offline.', 'Until cleared or updated'],
];

export default function CookiesPage() {
  return (
    <LegalPage
      href="/cookies/"
      title="Cookies and storage"
      lead="Collate sets no cookies. It does keep a few things in your browser so your work survives a reload."
      summary={[
        'No cookies, no tracking and no advertising.',
        'Everything listed here stays on your device. We can’t read it.',
        'You can clear it all from your browser’s site settings.',
      ]}
      sections={[
        {
          id: 'cookies',
          title: 'Cookies',
          body: (
            <>
              <p>Collate itself sets no cookies, so there is no cookie banner to accept.</p>
              <p>
                If you open a file from Google Drive, OneDrive or Dropbox, that service’s sign-in and picker may set their own cookies, under their own policies. Those are only set when you use a cloud
                drive.
              </p>
            </>
          ),
        },
        {
          id: 'storage',
          title: 'What is kept in your browser',
          body: (
            <>
              <p>These are strictly necessary for Collate to do what you ask, such as carrying on after a reload. None are used for tracking.</p>
              <div className={content.tableWrap}>
                <table className={content.table}>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Where</th>
                      <th scope="col">What for</th>
                      <th scope="col">How long</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ITEMS.map(([name, where, what, how]) => (
                      <tr key={name}>
                        <td>
                          <code>{name}</code>
                        </td>
                        <td>{where}</td>
                        <td>{what}</td>
                        <td>{how}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ),
        },
        {
          id: 'clear',
          title: 'Clearing it',
          body: (
            <>
              <p>To remove everything Collate keeps, clear this site’s data in your browser:</p>
              <ul>
                <li>
                  <strong>Chrome and Edge:</strong> click the icon left of the address, then <i>Site settings › Delete data</i>.
                </li>
                <li>
                  <strong>Firefox:</strong> click the padlock, then <i>Clear cookies and site data</i>.
                </li>
                <li>
                  <strong>Safari:</strong> <i>Settings › Privacy › Manage Website Data</i>, then remove this site.
                </li>
              </ul>
              <p>Your current comparison is lost when you do this, so save anything you need first. A private or incognito window keeps nothing after it closes.</p>
            </>
          ),
        },
        {
          id: 'contact',
          title: 'Contact',
          body: (
            <p>
              Questions can be raised through <Contact />.
            </p>
          ),
        },
      ]}
    />
  );
}
