import type { NextConfig } from 'next';

// Served from a sub-path (such as /collate/) when BASE_PATH says so.
const basePath = process.env.BASE_PATH || undefined;

const config: NextConfig = {
  // Pages are pre-rendered where they can be (documents are still read, compared and written in the
  // browser); the API routes (transcription) run on the server.
  // Every page's URL ends in a slash, as links and bookmarks already have them.
  trailingSlash: true,
  basePath,
  env: {
    // For links built outside React (the workspace's app bar).
    NEXT_PUBLIC_BASE_PATH: basePath ?? '',
  },
};

export default config;
