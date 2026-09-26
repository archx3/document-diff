/**
 * File extensions, kept apart from the readers so that pages which only pick
 * files don't load them.
 */

/** Every extension the file picker offers (other files can still be dropped). */
export const ACCEPTED_EXTENSIONS = [
  'docx', 'docm', 'dotx', 'dotm', 'doc', 'dot', 'odt', 'ott', 'fodt', 'rtf', 'pdf', 'epub',
  'html', 'htm', 'xhtml', 'mht', 'mhtml', 'md', 'markdown', 'txt', 'csv', 'tsv', 'gdoc',
  'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'log', 'tex', 'bib', 'rst', 'adoc', 'org', 'srt', 'vtt', 'sql',
];

/** Lower-case extension of a file name, without the dot ('' when there is none). */
export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

/** A kind of file, by the extensions it goes by (the usual ones first). */
export interface FileFormat {
  /** What one file of this kind is called: "Word document". */
  name: string;
  /** And several: "Word documents". */
  many: string;
  exts: string[];
}

const FORMATS: FileFormat[] = [
  { name: 'Word document', many: 'Word documents', exts: ['docx', 'doc', 'docm', 'dotx', 'dotm', 'dot'] },
  { name: 'OpenDocument text', many: 'OpenDocument texts', exts: ['odt', 'fodt', 'ott'] },
  { name: 'Rich Text file', many: 'Rich Text files', exts: ['rtf'] },
  { name: 'PDF', many: 'PDFs', exts: ['pdf'] },
  { name: 'EPUB book', many: 'EPUB books', exts: ['epub'] },
  { name: 'web page', many: 'web pages', exts: ['html', 'htm', 'xhtml', 'mht', 'mhtml'] },
  { name: 'Markdown file', many: 'Markdown files', exts: ['md', 'markdown', 'mdown', 'mkd'] },
  { name: 'CSV file', many: 'CSV files', exts: ['csv', 'tsv', 'tab'] },
  { name: 'YAML file', many: 'YAML files', exts: ['yaml', 'yml'] },
  { name: 'text file', many: 'text files', exts: ['txt', 'text'] },
];

/** The kind of file a name points to, or undefined when it has no extension. */
export function fileFormat(name: string): FileFormat | undefined {
  const ext = extensionOf(name);
  if (!ext) return undefined;
  return FORMATS.find((f) => f.exts.includes(ext)) ?? { name: `.${ext} file`, many: `.${ext} files`, exts: [ext] };
}

/** "a Word document", "an EPUB book". */
export function withArticle(name: string): string {
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
}

/** The `accept` attribute of a file input limited to some extensions. */
export function acceptList(exts: readonly string[]): string {
  return exts.map((e) => `.${e}`).join(',');
}
