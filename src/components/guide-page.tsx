import Link from 'next/link';
import type { ReactNode } from 'react';
import content from './content.module.css';
import { Icon } from './icons';
import type { Step } from './replica/walkthrough';
import { Walkthrough } from './replica/walkthrough';
import { SitePage } from './site-header';
import site from './site.module.css';

const GUIDES: Array<[string, string]> = [
  ['/guides/documents/', 'Comparing documents'],
  ['/guides/images/', 'Comparing images'],
  ['/guides/audio/', 'Comparing audio'],
];

interface GuideProps {
  kind: 'text' | 'image' | 'audio';
  href: string;
  title: ReactNode;
  lead: string;
  steps: Step[];
  /** What files it takes, as rows of [format, extensions, notes]. */
  formats: Array<[string, string, string]>;
  tips: Array<[string, ReactNode]>;
  sample: ReactNode;
}

/** A walkthrough for one kind of file: the interactive tour, then its formats and tips. */
export function GuidePage({ kind, href, title, lead, steps, formats, tips, sample }: GuideProps) {
  return (
    <SitePage current="/guides/">
      <section className={content.hero}>
        <p className={content.eyebrow}>
          <Link href="/guides/">Guides</Link> · Walkthrough
        </p>
        <h1 className={content.title}>{title}</h1>
        <p className={content.lead}>{lead}</p>
      </section>

      <section className={content.band} aria-label="Walkthrough">
        <Walkthrough kind={kind} steps={steps} />
      </section>

      <section className={`${content.band} ${content.tinted}`} aria-labelledby="formats-title">
        <header className={content.sectionHead}>
          <div>
            <h2 id="formats-title" className={content.h2}>
              What it reads
            </h2>
          </div>
        </header>
        <div className={content.tableWrap}>
          <table className={content.table}>
            <thead>
              <tr>
                <th scope="col">Format</th>
                <th scope="col">Files</th>
                <th scope="col">Good to know</th>
              </tr>
            </thead>
            <tbody>
              {formats.map(([name, ext, note]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>
                    <code>{ext}</code>
                  </td>
                  <td>{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={content.band} aria-labelledby="tips-title">
        <header className={content.sectionHead}>
          <div>
            <h2 id="tips-title" className={content.h2}>
              Tips
            </h2>
          </div>
        </header>
        <ul className={content.tips}>
          {tips.map(([t, body]) => (
            <li key={t}>
              <b>{t}</b>
              {body}
            </li>
          ))}
        </ul>
        <div className={content.callout}>
          <Icon name="bulb" size={18} />
          <p>{sample}</p>
        </div>
      </section>

      <section className={`${content.band} ${content.tinted}`} aria-label="More guides">
        <div className={content.nextGuides}>
          {GUIDES.filter(([h]) => h !== href).map(([h, label]) => (
            <Link key={h} href={h} className={`${site.pill} ${site.secondary} ${site.small}`}>
              {label}
              <Icon name="arrow" className={site.arrow} />
            </Link>
          ))}
          <Link href="/help/" className={`${site.pill} ${site.quiet} ${site.small}`}>
            Help and shortcuts
          </Link>
        </div>
      </section>
    </SitePage>
  );
}
