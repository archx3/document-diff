import type { NextConfig } from 'next';

// GitHub Pages serves the site from /<repository>/; the Pages workflow passes that path in.
const basePath = process.env.PAGES_BASE_PATH || undefined;

const config: NextConfig = {
  // A static site: documents are read, compared and written entirely in the browser.
  output: 'export',
  // Every page is a folder with an index.html, which any static host serves.
  trailingSlash: true,
  basePath,
  env: {
    // For links built outside React (the workspace's app bar).
    NEXT_PUBLIC_BASE_PATH: basePath ?? '',
  },
};

export default config;
