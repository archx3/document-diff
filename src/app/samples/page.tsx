import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import content from '../../components/content.module.css';
import type { IconName } from '../../components/icons';
import { Icon } from '../../components/icons';
import type { SampleFile } from '../../components/open-sample';
import { OpenSample } from '../../components/open-sample';
import { Waveform, fakePeaks } from '../../components/replica/wave';
import { SitePage, asset } from '../../components/site-header';
import site from '../../components/site.module.css';
import { largeSamplesOn } from '../../lib/large-samples';

export const metadata: Metadata = {
  title: 'Samples',
  description: 'Sample documents, images and recordings to try Collate with: open a comparison in one click, or download the files and drop them in yourself.',
};

/** A sample file's size, read when the site is built. */
function size(path: string): string {
  const bytes = statSync(join(process.cwd(), 'public', path)).size;
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const file = (name: string): SampleFile => ({ name, path: `/samples/${name}` });

interface Sample {
  title: string;
  text: string;
  meta: string[];
  thumb: ReactNode;
  /** Two files to open, or a page that opens them itself. */
  files?: readonly [SampleFile, SampleFile];
  href?: string;
  /** Recordings get players, to hear them before comparing. */
  listen?: boolean;
}

function TextThumb({ a, b }: { a: ReactNode; b: ReactNode }) {
  return (
    <div className={content.thumb} aria-hidden="true">
      <div className={content.thumbSide}>
        <span className={content.siglum}>A</span>
        <div className={content.textThumb}>{a}</div>
      </div>
      <div className={content.thumbSide}>
        <span className={content.siglum}>B</span>
        <div className={content.textThumb}>{b}</div>
      </div>
    </div>
  );
}

function CodeThumb({ a, b }: { a: ReactNode; b: ReactNode }) {
  const mono = { fontFamily: 'var(--font-mono)', fontSize: 10, whiteSpace: 'pre' as const };
  return (
    <TextThumb a={<div style={mono}>{a}</div>} b={<div style={mono}>{b}</div>} />
  );
}

function PictureThumb({ a, b }: { a: string; b: string }) {
  return (
    <div className={content.thumb}>
      <div className={content.thumbSide}>
        <span className={content.siglum} aria-hidden="true">
          A
        </span>
        <img src={asset(`/samples/${a}`)} alt={`Version A: ${a}`} loading="lazy" />
      </div>
      <div className={content.thumbSide}>
        <span className={content.siglum} aria-hidden="true">
          B
        </span>
        <img src={asset(`/samples/${b}`)} alt={`Version B: ${b}`} loading="lazy" />
      </div>
    </div>
  );
}

function SoundThumb({ seed, a, b, length }: { seed: number; a: Array<[number, number]>; b: Array<[number, number]>; length: number }) {
  return (
    <div className={content.thumb} style={{ gridTemplateColumns: '1fr', gridTemplateRows: '1fr 1fr' }} aria-hidden="true">
      {([a, b] as const).map((spans, i) => (
        <div key={i} className={content.thumbSide} style={{ padding: '10px 14px 10px 36px' }}>
          <span className={content.siglum}>{i ? 'B' : 'A'}</span>
          <Waveform peaks={fakePeaks(seed + i, 120, length, spans)} color={i ? 'var(--b)' : 'var(--a)'} />
        </div>
      ))}
    </div>
  );
}

const DOCUMENTS: Sample[] = [
  {
    title: 'Website services agreement',
    text: 'Two drafts of a short contract, built into Collate. The quickest way to see word-level marks, copying changes across and the list of changes.',
    meta: ['Built in', '7 changes'],
    href: '/compare/sample/',
    thumb: (
      <TextThumb
        a={
          <>
            <b>Website Services Agreement</b>
            This agreement is made on <del>12</del> May 2026… up to <del>six</del> pages, a blog and a contact form.
          </>
        }
        b={
          <>
            <b>Website Services Agreement</b>
            This agreement is made on <ins>19</ins> May 2026… up to <ins>eight</ins> pages, a blog<ins>, a newsletter sign-up</ins> and a contact form.
          </>
        }
      />
    ),
  },
  {
    title: 'Services agreement, as Word files',
    text: 'Six pages become eight, invoices fall due in 15 days instead of 30, and an accessibility review arrives with its own fee. Export keeps Word’s styles and layout.',
    meta: ['.docx', 'Tables', 'Lists'],
    files: [file('contract-v1.docx'), file('contract-v2.docx')],
    thumb: (
      <TextThumb
        a={
          <>
            <b>3. Fees and payment</b>
            Invoices are due within <del>30</del> days of receipt. Design <del>$4,000</del>
          </>
        }
        b={
          <>
            <b>3. Fees and payment</b>
            Invoices are due within <ins>15</ins> days of receipt. Design <ins>$4,500</ins>
          </>
        }
      />
    ),
  },
  {
    title: 'Word against PDF',
    text: 'The first draft as a Word file, the second as a PDF. Collate rebuilds the PDF’s paragraphs, lists and table, then compares them with the Word file.',
    meta: ['.docx', '.pdf', 'Mixed formats'],
    files: [file('contract-v1.docx'), file('contract-v2.pdf')],
    thumb: (
      <TextThumb
        a={
          <>
            <b>1. Scope of work</b>
            Visual design for desktop and mobile
          </>
        }
        b={
          <>
            <b>1. Scope of work</b>
            Visual design for desktop<ins>, tablet</ins> and mobile
            <br />
            <ins>Accessibility review</ins>
          </>
        }
      />
    ),
  },
  {
    title: 'Price list',
    text: 'A CSV file compared row by row as a table: two prices rise, stock falls, one product is dropped and another added.',
    meta: ['.csv', 'Row by row'],
    files: [file('prices-v1.csv'), file('prices-v2.csv')],
    thumb: (
      <CodeThumb
        a={
          <>
            TEA-001,Breakfast,<del>8.50</del>
            {'\n'}TEA-002,Earl Grey,9.00{'\n'}
            <del>TEA-004,Rooibos,7.75</del>
            {'\n'}TEA-006,Chai,<del>9.50</del>
          </>
        }
        b={
          <>
            TEA-001,Breakfast,<ins>8.95</ins>
            {'\n'}TEA-002,Earl Grey,9.00{'\n'}TEA-006,Chai,<ins>9.95</ins>
            {'\n'}
            <ins>TEA-007,Lemon & ginger</ins>
          </>
        }
      />
    ),
  },
  {
    title: 'Shop settings',
    text: 'A JSON config file compared line by line in a monospace font: a new region, a lower shipping threshold, a new payment method and a longer cache.',
    meta: ['.json', 'Line by line'],
    files: [file('settings-v1.json'), file('settings-v2.json')],
    thumb: (
      <CodeThumb
        a={
          <>
            {'"region": "'}
            <del>eu-west</del>
            {'",\n"freeShippingOver": '}
            <del>50</del>
            {',\n"methods": ["card", "paypal"]'}
          </>
        }
        b={
          <>
            {'"region": "'}
            <ins>eu-central</ins>
            {'",\n"freeShippingOver": '}
            <ins>40</ins>
            {',\n"methods": ["card", "paypal"'}
            <ins>, "apple-pay"</ins>]
          </>
        }
      />
    ),
  },
];

const IMAGES: Sample[] = [
  {
    title: 'Sales chart',
    text: 'The last bar grows and a “Q4 target” label appears. Try swipe and onion skin, then step through the two changed areas.',
    meta: ['.png', '640 × 400 px'],
    files: [file('chart-v1.png'), file('chart-v2.png')],
    thumb: <PictureThumb a="chart-v1.png" b="chart-v2.png" />,
  },
  {
    title: 'Event poster',
    text: 'A new date, more stalls, a “Free entry” badge and a different sun. Small text changes show up well in the difference view.',
    meta: ['.svg', 'Vector'],
    files: [file('poster-v1.svg'), file('poster-v2.svg')],
    thumb: <PictureThumb a="poster-v1.svg" b="poster-v2.svg" />,
  },
];

const AUDIO: Sample[] = [
  {
    title: 'Spoken sentence, two takes',
    text: 'The second take runs two seconds longer. Collate lines the takes up in time first, so only what really differs is marked. Transcribe compares the words too.',
    meta: ['.wav', '5.6 s and 7.6 s', 'Speech'],
    files: [file('speech-v1.wav'), file('speech-v2.wav')],
    listen: true,
    thumb: (
      <SoundThumb
        seed={21}
        length={7.6}
        a={[
          [0.3, 1.4],
          [1.6, 3.1],
          [3.4, 4.6],
          [4.8, 5.4],
        ]}
        b={[
          [0.3, 1.4],
          [1.6, 3.1],
          [3.3, 4.5],
          [4.7, 5.9],
          [6.2, 7.3],
        ]}
      />
    ),
  },
  {
    title: 'WAV against M4A',
    text: 'The same two takes, the second saved as compressed M4A. Recordings in different formats compare just as well.',
    meta: ['.wav', '.m4a', 'Mixed formats'],
    files: [file('speech-v1.wav'), file('speech-v2.m4a')],
    listen: true,
    thumb: (
      <SoundThumb
        seed={33}
        length={7.6}
        a={[
          [0.3, 1.4],
          [1.6, 3.1],
          [3.4, 4.6],
          [4.8, 5.4],
        ]}
        b={[
          [0.3, 1.4],
          [1.6, 3.1],
          [3.3, 4.5],
          [4.7, 5.9],
          [6.2, 7.3],
        ]}
      />
    ),
  },
  {
    title: 'A short tune',
    text: 'Seven notes, then the same tune with the sixth note higher and a note added at the end. The spectrogram shows the changed pitch.',
    meta: ['.wav', 'Music'],
    files: [file('melody-v1.wav'), file('melody-v2.wav')],
    listen: true,
    thumb: (
      <SoundThumb
        seed={45}
        length={5.3}
        a={[0.25, 0.73, 1.21, 1.69, 2.17, 2.65].map((s) => [s, s + 0.42] as [number, number]).concat([[3.13, 3.97]])}
        b={[0.25, 0.73, 1.21, 1.69, 2.17, 2.65].map((s) => [s, s + 0.42] as [number, number]).concat([
          [3.13, 3.97],
          [4.03, 4.87],
        ])}
      />
    ),
  },
];

function Card({ s }: { s: Sample }) {
  return (
    <li className={content.card}>
      {s.thumb}
      <div className={content.cardBody}>
        <h3>{s.title}</h3>
        <ul className={content.meta} aria-label="About these files">
          {s.meta.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <p>{s.text}</p>
        {s.listen && s.files && (
          <div className={content.listen}>
            {s.files.map((f, i) => (
              <label key={f.name}>
                {i ? 'B' : 'A'}
                <audio controls preload="none" src={asset(f.path)} aria-label={`Listen to ${f.name}`} />
              </label>
            ))}
          </div>
        )}
        <div className={content.cardActions}>
          {s.href ? (
            <Link href={s.href} className={`${site.pill} ${site.primary} ${site.small}`}>
              Open the comparison
              <Icon name="arrow" className={site.arrow} />
            </Link>
          ) : (
            s.files && <OpenSample files={s.files} />
          )}
          {s.files && (
            <span className={content.downloads}>
              {s.files.map((f) => (
                <a key={f.name} href={asset(f.path)} download title={`Download ${f.name} (${size(f.path)})`}>
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

function Section({ id, icon, tone, title, lead, guide, samples, tinted }: { id: string; icon: IconName; tone?: string; title: string; lead: string; guide: string; samples: Sample[]; tinted?: boolean }) {
  return (
    <section id={id} className={`${content.band} ${tinted ? content.tinted : ''}`} aria-labelledby={`${id}-title`}>
      <header className={content.sectionHead}>
        <div>
          <span className={content.kindIcon} data-tone={tone}>
            <Icon name={icon} size={22} />
          </span>
          <h2 id={`${id}-title`} className={content.h2}>
            {title}
          </h2>
          <p className={content.sectionLead}>{lead}</p>
        </div>
        <Link href={guide} className={site.textLink}>
          Walkthrough
          <Icon name="arrow" className={site.arrow} />
        </Link>
      </header>
      <ul className={content.cards}>
        {samples.map((s) => (
          <Card key={s.title} s={s} />
        ))}
      </ul>
    </section>
  );
}

export default function SamplesPage() {
  return (
    <SitePage current="/samples/">
      <section className={content.hero}>
        <p className={content.eyebrow}>Samples</p>
        <h1 className={content.title}>
          Try it with <em>files we made for you</em>
        </h1>
        <p className={content.lead}>
          Documents, pictures and recordings, each in two versions. Open a comparison in one click, or download the files and drop them on the start page to try the whole flow.
        </p>
        <div className={content.heroActions}>
          <a href="#documents" className={`${site.pill} ${site.secondary} ${site.small}`}>
            <Icon name="doc" /> Documents
          </a>
          <a href="#images" className={`${site.pill} ${site.secondary} ${site.small}`}>
            <Icon name="image" /> Images
          </a>
          <a href="#audio" className={`${site.pill} ${site.secondary} ${site.small}`}>
            <Icon name="audio" /> Audio
          </a>
          {/* Made on this machine for testing by hand: offered in development only (or with LARGE_SAMPLES=1). */}
          {largeSamplesOn() && (
            <Link href="/samples/large/" className={`${site.pill} ${site.secondary} ${site.small}`}>
              <Icon name="bolt" /> Large samples
            </Link>
          )}
        </div>
      </section>

      <Section
        id="documents"
        icon="doc"
        title="Documents"
        lead="Word, PDF, CSV and code: paragraphs line up side by side and every changed word is marked."
        guide="/guides/documents/"
        samples={DOCUMENTS}
      />
      <Section
        id="images"
        icon="image"
        tone="terra"
        title="Images"
        lead="Pictures compared pixel by pixel, with the changed areas outlined."
        guide="/guides/images/"
        samples={IMAGES}
        tinted
      />
      <Section
        id="audio"
        icon="audio"
        tone="amber"
        title="Audio"
        lead="Recordings lined up in time, with every difference marked on both tracks. Listen to them here first."
        guide="/guides/audio/"
        samples={AUDIO}
      />

      <section className={`${content.band} ${content.tinted}`}>
        <div className={content.callout} style={{ marginTop: 0 }}>
          <Icon name="lock" size={18} />
          <p>
            The samples are ordinary files served with this site. Opening one reads it in your browser, exactly as a file of your own would be read, and nothing is sent anywhere.
            When you are ready, <Link href="/compare/new/">start a comparison with your own files</Link>.
          </p>
        </div>
      </section>
    </SitePage>
  );
}
