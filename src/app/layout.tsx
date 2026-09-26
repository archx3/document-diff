import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, Source_Serif_4 } from 'next/font/google';
import type { ReactNode } from 'react';
import '../styles.css';
import { THEME_SCRIPT } from '../ui/theme';

// The variables are read by the font tokens in styles.css.
const sans = IBM_Plex_Sans({ subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600'], variable: '--font-plex-sans' });
const mono = IBM_Plex_Mono({ subsets: ['latin', 'latin-ext'], weight: ['400', '500'], variable: '--font-plex-mono' });
const serif = Source_Serif_4({ subsets: ['latin', 'latin-ext'], style: ['normal', 'italic'], axes: ['opsz'], variable: '--font-source-serif' });

export const metadata: Metadata = {
  title: { default: 'Collate: compare two documents side by side', template: '%s · Collate' },
  description:
    'Compare two versions of a document side by side and copy changes between them: Word, Google Docs, PDF, OpenDocument, RTF, EPUB, Markdown, CSV and text. Runs entirely in your browser.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // The browser's own bars take SettleMe's peach shell (or its dark counterpart).
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fef1ee' },
    { media: '(prefers-color-scheme: dark)', color: '#0b232b' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The head script sets data-theme on <html> before React hydrates it.
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        {/* The theme the reader chose, applied before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
