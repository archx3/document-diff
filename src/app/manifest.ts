import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Installing Collate as an app: it opens on the comparison page, works offline, and opens document files. */
export default function manifest(): MetadataRoute.Manifest {
  const m = {
    name: 'Collate: compare documents',
    short_name: 'Collate',
    description: 'Compare two versions of a document side by side and copy changes between them. Runs entirely on your device.',
    id: `${base}/compare/`,
    start_url: `${base}/compare/`,
    scope: `${base}/`,
    display: 'standalone',
    background_color: '#fef1ee',
    theme_color: '#16384b',
    icons: [
      { src: `${base}/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${base}/icon-512.png`, sizes: '512x512', type: 'image/png' },
      { src: `${base}/icon-512-maskable.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // "Open with Collate" for documents on the desktop (Chromium browsers).
    file_handlers: [
      {
        action: `${base}/compare/`,
        accept: {
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
          'application/msword': ['.doc'],
          'application/vnd.oasis.opendocument.text': ['.odt'],
          'application/rtf': ['.rtf'],
          'application/pdf': ['.pdf'],
          'application/epub+zip': ['.epub'],
          'text/markdown': ['.md'],
          'text/plain': ['.txt'],
          'text/html': ['.html', '.htm'],
          'text/csv': ['.csv'],
          'application/octet-stream': ['.collate'],
        },
      },
    ],
  };
  return m as MetadataRoute.Manifest;
}
