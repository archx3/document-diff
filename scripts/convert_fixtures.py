"""Convert the .docx test fixtures to other formats with LibreOffice.

Run: python3 scripts/convert_fixtures.py   (needs `soffice` on the PATH)
Writes .odt, .fodt, .rtf, .doc and .epub files next to the .docx fixtures.
"""
import os
import shutil
import subprocess
import sys
import tempfile

FIXTURES = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures')

CONVERSIONS = [
    ('contract-v1.docx', 'odt'),
    ('contract-v2.docx', 'odt'),
    ('complex-v1.docx', 'odt'),
    ('complex-v2.docx', 'odt'),
    ('contract-v1.docx', 'fodt'),
    ('contract-v1.docx', 'rtf'),
    ('contract-v2.docx', 'rtf'),
    ('complex-v1.docx', 'rtf'),
    ('contract-v1.docx', 'doc:MS Word 97'),
    ('contract-v2.docx', 'doc:MS Word 97'),
    ('complex-v1.docx', 'doc:MS Word 97'),
    ('contract-v1.docx', 'epub'),
    ('contract-v2.docx', 'epub'),
    # Tagged PDFs carry headings, lists and tables; untagged ones only positioned text.
    ('contract-v1.docx', 'pdf:writer_pdf_Export:{"UseTaggedPDF":{"type":"boolean","value":"true"}}'),
    ('contract-v2.docx', 'pdf:writer_pdf_Export:{"UseTaggedPDF":{"type":"boolean","value":"true"}}'),
    ('complex-v1.docx', 'pdf:writer_pdf_Export:{"UseTaggedPDF":{"type":"boolean","value":"true"}}'),
    ('contract-v1.docx', 'pdf:writer_pdf_Export:{"UseTaggedPDF":{"type":"boolean","value":"false"}}', 'contract-v1-untagged.pdf'),
    ('contract-v2.docx', 'pdf:writer_pdf_Export:{"UseTaggedPDF":{"type":"boolean","value":"false"}}', 'contract-v2-untagged.pdf'),
    ('complex-v1.docx', 'pdf:writer_pdf_Export:{"UseTaggedPDF":{"type":"boolean","value":"false"}}', 'complex-v1-untagged.pdf'),
]


def main():
    if not shutil.which('soffice'):
        print('soffice not found; skipping conversions')
        return 1
    tmp = tempfile.mkdtemp()
    for src, fmt, *rest in CONVERSIONS:
        ext = fmt.split(':')[0]
        subprocess.run(['soffice', '--headless', '--convert-to', fmt, '--outdir', tmp, os.path.join(FIXTURES, src)],
                       check=True, capture_output=True)
        produced = src.replace('.docx', '.' + ext)
        name = rest[0] if rest else produced
        shutil.copy(os.path.join(tmp, produced), os.path.join(FIXTURES, name))
        print('wrote', os.path.join(FIXTURES, name))
    return 0


if __name__ == '__main__':
    sys.exit(main())
