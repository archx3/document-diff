import type { Metadata } from 'next';
import Link from 'next/link';
import content from '../../components/content.module.css';
import type { IconName } from '../../components/icons';
import { Icon } from '../../components/icons';
import { SitePage } from '../../components/site-header';

export const metadata: Metadata = {
  title: 'Guides',
  description: 'Interactive walkthroughs for comparing documents, images and audio in Collate, and guides to Google Docs round trips, reviewing and versions.',
};

const WALKTHROUGHS: Array<{ href: string; icon: IconName; tone?: string; title: string; text: string; steps: string[] }> = [
  {
    href: '/guides/documents/',
    icon: 'doc',
    title: 'Comparing documents',
    text: 'Word, PDF, Google Docs, OpenDocument, CSV, code and more.',
    steps: ['Read the marks', 'Copy changes across', 'Accept, reject and note', 'Export or share a redline'],
  },
  {
    href: '/guides/images/',
    icon: 'image',
    tone: 'terra',
    title: 'Comparing images',
    text: 'PNG, JPEG, GIF, WebP, SVG and BMP.',
    steps: ['Side by side, swipe, onion skin, difference', 'Step through the changed areas', 'Set the sensitivity', 'Save the difference'],
  },
  {
    href: '/guides/audio/',
    icon: 'audio',
    tone: 'amber',
    title: 'Comparing audio',
    text: 'MP3, WAV, M4A, Ogg, FLAC and WebM.',
    steps: ['Tracks lined up in time', 'Waveform, spectrogram, loudness', 'A/B playback and looping', 'Compare transcripts'],
  },
];

const HOW_TO: Array<{ title: string; steps: string[] }> = [
  {
    title: 'Round trip with Google Docs',
    steps: [
      'In Google Docs, choose File › Download › Microsoft Word (.docx) for each version. Or select everything, copy, and use Replace › Paste from Google Docs or Word.',
      'Compare the two and copy the changes you want.',
      'Export › Download Word document, then in Google Docs use File › Open › Upload. Or Export › Copy formatted text and paste it over the original.',
    ],
  },
  {
    title: 'Send a redline to someone',
    steps: [
      'Load the original as A and the new draft as B.',
      'Turn on Review mode (R) to add notes, and accept or reject changes if you like.',
      'Click the redline button (the download arrow) in the toolbar: B downloads as a Word file with every change tracked and your notes as comments. Choose PDF for a read-only copy.',
    ],
  },
  {
    title: 'Hand over a review',
    steps: [
      'Click Share in the toolbar and add a password if the documents are private.',
      'Send the .collate file however you like.',
      'Whoever opens it in Collate sees both documents with your notes, highlights and decisions, and can carry on.',
    ],
  },
  {
    title: 'Compare many versions',
    steps: [
      'Choose three or more drafts at once, on the start page or with Replace.',
      'They are put in order by name (v2 before v10), and the last two are compared.',
      'The version bar steps through the pairs, and History across the versions shows one paragraph in every draft.',
    ],
  },
];

export default function GuidesPage() {
  return (
    <SitePage current="/guides/">
      <section className={content.hero}>
        <p className={content.eyebrow}>Guides</p>
        <h1 className={content.title}>
          Learn Collate <em>by trying it</em>
        </h1>
        <p className={content.lead}>
          Each walkthrough sits beside a working replica of the workspace. Read a step and its part lights up; click any part to find out what it does.
        </p>
      </section>

      <section className={content.band} aria-labelledby="walkthroughs">
        <header className={content.sectionHead}>
          <div>
            <h2 id="walkthroughs" className={content.h2}>
              Walkthroughs
            </h2>
            <p className={content.sectionLead}>One for each kind of file. The toolbar and the view change to suit what you are comparing.</p>
          </div>
        </header>
        <ul className={content.cards}>
          {WALKTHROUGHS.map((w) => (
            <li key={w.href}>
              <Link href={w.href} className={content.guideCard}>
                <span className={content.kindIcon} data-tone={w.tone}>
                  <Icon name={w.icon} size={22} />
                </span>
                <h3>{w.title}</h3>
                <p>{w.text}</p>
                <ol>
                  {w.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                <span className={content.more}>
                  Start the walkthrough <Icon name="arrow" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${content.band} ${content.tinted}`} aria-labelledby="how-to">
        <header className={content.sectionHead}>
          <div>
            <h2 id="how-to" className={content.h2}>
              How to…
            </h2>
            <p className={content.sectionLead}>Short recipes for the things people do most.</p>
          </div>
        </header>
        <ul className={content.cards}>
          {HOW_TO.map((h) => (
            <li key={h.title} className={content.guideCard}>
              <h3>{h.title}</h3>
              <ol>
                {h.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
        <div className={content.callout}>
          <Icon name="help" size={18} />
          <p>
            Looking for something specific? The <Link href="/help/">help page</Link> answers common questions and lists every keyboard shortcut. To try things out on real files, open one of the{' '}
            <Link href="/samples/">samples</Link>.
          </p>
        </div>
      </section>
    </SitePage>
  );
}
