import { defineConfig } from 'vite';

// SVG Studio is a self-contained single-page app in this folder. It shares the repository's toolchain
// (React, TypeScript, Vite) but not the Next.js site: build it with `npm run studio:build`.
export default defineConfig({
  root: 'svg-studio',
  // Relative URLs, so the build works from any path or from a file server.
  base: './',
  server: { port: 5180 },
  preview: { port: 5181 },
  build: { outDir: '../dist-studio', emptyOutDir: true, target: 'es2022', sourcemap: true },
});
