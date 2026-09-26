// pdf.js ships no type declarations for its worker module; only its handler is used.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
