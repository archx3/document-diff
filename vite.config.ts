import { defineConfig } from 'vitest/config';

// `vite build --mode single` keeps everything in one script (for the self-contained page);
// the normal build loads pdf.js only when a PDF is opened.
export default defineConfig(({ mode }) => ({
  // Relative asset URLs so the build works from any sub-path (GitHub Pages, file hosting).
  base: './',
  build: {
    target: 'es2022',
    sourcemap: mode !== 'single',
    // pdf.js is large but only loaded for PDFs.
    chunkSizeWarningLimit: 1400,
    rolldownOptions: mode === 'single' ? { output: { codeSplitting: false } } : undefined,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
  },
}));
