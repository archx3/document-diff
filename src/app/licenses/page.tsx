import type { Metadata } from 'next';
import content from '../../components/content.module.css';
import { LegalPage } from '../../components/legal-page';

export const metadata: Metadata = {
  title: 'Open-source licenses',
  description: 'The open-source software, fonts and models Collate is built with, and their licenses.',
};

const SOFTWARE: Array<[string, string, string, string]> = [
  ['Next.js', 'MIT', 'The site’s framework', 'https://github.com/vercel/next.js'],
  ['React', 'MIT', 'The user interface', 'https://github.com/facebook/react'],
  ['PDF.js (pdfjs-dist)', 'Apache-2.0', 'Reading PDFs', 'https://github.com/mozilla/pdf.js'],
  ['pdfmake', 'MIT', 'Saving PDFs', 'https://github.com/bpampuch/pdfmake'],
  ['fflate', 'MIT', 'Reading and writing Word, OpenDocument and EPUB packages', 'https://github.com/101arrowz/fflate'],
  ['nspell', 'MIT', 'Spelling checks', 'https://github.com/wooorm/nspell'],
  ['dictionary-en, dictionary-en-gb', 'MIT AND BSD', 'English dictionaries (from SCOWL)', 'https://github.com/wooorm/dictionaries'],
  ['Transformers.js (@huggingface/transformers)', 'Apache-2.0', 'Running the speech model', 'https://github.com/huggingface/transformers.js'],
  ['ONNX Runtime Web', 'MIT', 'The engine the speech model runs on', 'https://github.com/microsoft/onnxruntime'],
];

const ASSETS: Array<[string, string, string, string]> = [
  ['Whisper tiny (timestamped ONNX)', 'Apache-2.0', 'Speech recognition, by OpenAI, converted by the ONNX Community', 'https://huggingface.co/onnx-community/whisper-tiny_timestamped'],
  ['IBM Plex Sans and Mono', 'OFL-1.1', 'The interface fonts', 'https://github.com/IBM/plex'],
  ['Source Serif 4', 'OFL-1.1', 'The document font', 'https://github.com/adobe-fonts/source-serif'],
  ['Roboto', 'Apache-2.0', 'The font of saved PDFs', 'https://github.com/googlefonts/roboto'],
];

function Table({ rows }: { rows: Array<[string, string, string, string]> }) {
  return (
    <div className={content.tableWrap}>
      <table className={content.table}>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">License</th>
            <th scope="col">Used for</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, license, use, href]) => (
            <tr key={name}>
              <td>
                <a href={href} rel="noopener noreferrer" target="_blank">
                  {name}
                </a>
              </td>
              <td>
                <code>{license}</code>
              </td>
              <td>{use}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LicensesPage() {
  return (
    <LegalPage
      href="/licenses/"
      title="Open-source licenses"
      lead="Collate stands on the work of many open-source projects. Thank you to everyone who builds them."
      sections={[
        {
          id: 'software',
          title: 'Software',
          body: (
            <>
              <p>The main libraries Collate ships, with their licenses. Each library’s own dependencies are listed in its package, under their own licenses.</p>
              <Table rows={SOFTWARE} />
            </>
          ),
        },
        {
          id: 'models-fonts',
          title: 'Models and fonts',
          body: <Table rows={ASSETS} />,
        },
        {
          id: 'samples',
          title: 'Sample files',
          body: <p>The sample documents, pictures and recordings on the samples page were made for Collate, and may be used freely to try it out.</p>,
        },
        {
          id: 'texts',
          title: 'License texts',
          body: (
            <>
              <p>
                The full license texts are in each project’s repository, linked above, and in the packages the site is built from. The MIT, BSD, Apache 2.0 and SIL Open Font License 1.1 texts are also
                published by the Open Source Initiative at{' '}
                <a href="https://opensource.org/licenses" rel="noopener noreferrer" target="_blank">
                  opensource.org/licenses
                </a>
                .
              </p>
              <p>
                Apache-2.0 software is used unmodified. Where a project includes a NOTICE file, its notices are carried in the package it is distributed in.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
