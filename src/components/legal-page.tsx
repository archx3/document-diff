import Link from 'next/link';
import type { ReactNode } from 'react';
import content from './content.module.css';
import { SitePage } from './site-header';

/** When the legal pages last changed, as shown on each. */
export const LEGAL_UPDATED = '29 September 2026';

/** Where to raise a question about the legal pages: set here, used on every page. */
export const CONTACT = { label: 'the project’s issue tracker', href: 'https://github.com/archx3/document-diff/issues' };

export function Contact() {
  return (
    <a href={CONTACT.href} rel="noopener noreferrer" target="_blank">
      {CONTACT.label}
    </a>
  );
}

const PAGES: Array<[string, string]> = [
  ['/privacy/', 'Privacy'],
  ['/terms/', 'Terms of use'],
  ['/cookies/', 'Cookies and storage'],
  ['/accessibility/', 'Accessibility'],
  ['/licenses/', 'Open-source licenses'],
];

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

/** A legal page: its title, a short summary, then its sections with a contents list beside them. */
export function LegalPage({ href, title, lead, summary, sections }: { href: string; title: string; lead: string; summary?: ReactNode[]; sections: LegalSection[] }) {
  return (
    <SitePage current={href}>
      <section className={content.hero} style={{ paddingBottom: 36 }}>
        <p className={content.eyebrow}>Legal</p>
        <h1 className={content.title}>{title}</h1>
        <p className={content.lead}>{lead}</p>
        <p className={content.updated}>Last updated {LEGAL_UPDATED}</p>
      </section>
      <div className={content.legal}>
        <nav className={content.toc} aria-label="On this page">
          <p>On this page</p>
          {sections.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.title}
            </a>
          ))}
          <div className={content.legalOthers}>
            {PAGES.filter(([h]) => h !== href).map(([h, label]) => (
              <Link key={h} href={h}>
                {label}
              </Link>
            ))}
          </div>
        </nav>
        <article className={content.prose}>
          {summary && (
            <div className={content.summaryBox}>
              <p>In short</p>
              <ul>
                {summary.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {sections.map((s) => (
            <section key={s.id} aria-labelledby={s.id}>
              <h2 id={s.id}>{s.title}</h2>
              {s.body}
            </section>
          ))}
        </article>
      </div>
    </SitePage>
  );
}
