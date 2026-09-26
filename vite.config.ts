import { defineConfig } from 'vitest/config';

// The site is built by Next.js. Vite runs the unit tests and builds the self-contained page
// (`vite build --mode single`, from index.html and src/main.ts), which keeps everything in one script.
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
