// pdfmake's Node build ships without type declarations; the tests only use a small part of it.
declare module 'pdfmake' {
  const pdfmake: {
    virtualfs: { writeFileSync(name: string, data: Uint8Array): void };
    addFonts(fonts: Record<string, Record<string, string>>): void;
    createPdf(def: Record<string, unknown>): { getBuffer(): Promise<Uint8Array> };
  };
  export default pdfmake;
}
