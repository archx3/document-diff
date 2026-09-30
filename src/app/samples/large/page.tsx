import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import content from '../../../components/content.module.css';
import { Icon } from '../../../components/icons';
import type { SampleFile } from '../../../components/open-sample';
import { OpenSample } from '../../../components/open-sample';
import { SitePage, asset } from '../../../components/site-header';
import type { LargeSample } from '../../../lib/large-samples';
import { LARGE_SAMPLES, largeSamplesOn, largeSize } from '../../../lib/large-samples';

// Which files there are is read when the page is asked for: they are made on this machine.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Large samples',
  description: 'Long documents and long recordings, for trying the app by hand at the sizes it is stress-tested at.',
  robots: { index: false, follow: false },
};

function mb(bytes: number): string {
  return bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;
}

// A file's URL keeps its extension last (the site's trailing slash is left off such URLs).
const served = (name: string): SampleFile => ({ name, path: `/api/large-samples/${encodeURIComponent(name)}` });

function Card({ s }: { s: LargeSample }) {
  const sizes = s.files.map(largeSize);
  const made = sizes.every((x) => x !== null);
  const files = [served(s.files[0]), served(s.files[1])] as const;
  return (
    <li className={content.card}>
      <div className={content.cardBody}>
        <h3>{s.title}</h3>
        <ul className={content.meta} aria-label="About these files">
          {sizes.map((b, i) => (
            <li key={i}>
              {i ? 'B' : 'A'} {b === null ? 'not made yet' : mb(b)}
            </li>
          ))}
        </ul>
        <p>{s.text}</p>
        <div className={content.cardActions}>
          {made ? <OpenSample files={files} /> : <code>npm run samples:large</code>}
          {made && (
            <span className={content.downloads}>
              {files.map((f) => (
                <a key={f.name} href={asset(f.path)} download={f.name} title={`Download ${f.name}`}>
                  <Icon name="download" size={13} />
                  {f.name}
                </a>
              ))}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

export default function LargeSamplesPage() {
  // Hundreds of megabytes that exist only where they were made: never on a built site unless asked for.
  if (!largeSamplesOn()) notFound();
  const none = LARGE_SAMPLES.every((s) => s.files.some((f) => largeSize(f) === null));
  return (
    <SitePage current="/samples/">
      <section className={content.hero}>
        <p className={content.eyebrow}>Samples · this machine only</p>
        <h1 className={content.title}>
          Large <em>samples</em>
        </h1>
        <p className={content.lead}>
          Long documents and long recordings, to try the app by hand at the sizes it is stress-tested at (docs/PERFORMANCE.md says what to expect). They are made on this machine, and
          only a development server, or one started with <code>LARGE_SAMPLES=1</code>, offers them.
        </p>
        {none && (
          <p className={content.lead}>
            None are made yet: run <code>npm run samples:large</code> (a few minutes, and about 1.5 GB; the speech needs a Mac’s <code>say</code>).
          </p>
        )}
      </section>

      <section id="documents" className={content.band} aria-labelledby="documents-title">
        <header className={content.sectionHead}>
          <div>
            <span className={content.kindIcon}>
              <Icon name="doc" size={22} />
            </span>
            <h2 id="documents-title" className={content.h2}>
              Documents
            </h2>
            <p className={content.sectionLead}>Two versions of a long contract. Step through the changes, turn the connection bands off and on, fold the rest away, and reload.</p>
          </div>
        </header>
        <ul className={content.cards}>
          {LARGE_SAMPLES.filter((s) => s.kind === 'text').map((s) => (
            <Card key={s.title} s={s} />
          ))}
        </ul>
      </section>

      <section id="audio" className={`${content.band} ${content.tinted}`} aria-labelledby="audio-title">
        <header className={content.sectionHead}>
          <div>
            <span className={content.kindIcon} data-tone="amber">
              <Icon name="audio" size={22} />
            </span>
            <h2 id="audio-title" className={content.h2}>
              Recordings
            </h2>
            <p className={content.sectionLead}>Two takes of a long talk. See how long they take to line up, step through the differences, and transcribe them.</p>
          </div>
        </header>
        <ul className={content.cards}>
          {LARGE_SAMPLES.filter((s) => s.kind === 'audio').map((s) => (
            <Card key={s.title} s={s} />
          ))}
        </ul>
      </section>

      <section className={content.band}>
        <div className={content.callout} style={{ marginTop: 0 }}>
          <Icon name="alert" size={18} />
          <p>
            Opening one reads both files into this browser, as files of your own would be read. The largest need a few gigabytes of memory, and a reload briefly needs twice that.
            The <Link href="/samples/">everyday samples</Link> are quicker.
          </p>
        </div>
      </section>
    </SitePage>
  );
}
