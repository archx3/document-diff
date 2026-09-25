"""Generate .docx test fixtures with python-docx (and LibreOffice when available).

Run: python3 scripts/make_fixtures.py
Writes to tests/fixtures/.
"""
import base64
import os
import shutil
import subprocess
import tempfile

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures')
os.makedirs(OUT, exist_ok=True)

# 2x2 PNGs (red and blue)
RED_PNG = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==')
BLUE_PNG = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNkYPjPwMDAxMDAwMDAAAAOAgECqz+vFwAAAABJRU5ErkJggg==')


def add_hyperlink(paragraph, url, text, bold=False):
    part = paragraph.part
    r_id = part.relate_to(url, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', is_external=True)
    hyperlink = OxmlElement('w:hyperlink')
    hyperlink.set(qn('r:id'), r_id)
    new_run = OxmlElement('w:r')
    rPr = OxmlElement('w:rPr')
    style = OxmlElement('w:rStyle')
    style.set(qn('w:val'), 'Hyperlink')
    rPr.append(style)
    if bold:
        rPr.append(OxmlElement('w:b'))
    new_run.append(rPr)
    t = OxmlElement('w:t')
    t.text = text
    t.set(qn('xml:space'), 'preserve')
    new_run.append(t)
    hyperlink.append(new_run)
    paragraph._p.append(hyperlink)


def add_bookmark(paragraph, name, bid):
    start = OxmlElement('w:bookmarkStart')
    start.set(qn('w:id'), str(bid))
    start.set(qn('w:name'), name)
    end = OxmlElement('w:bookmarkEnd')
    end.set(qn('w:id'), str(bid))
    paragraph._p.insert(1, start)
    paragraph._p.append(end)


def add_field(paragraph, instr, result):
    def run_with(child):
        r = OxmlElement('w:r')
        r.append(child)
        paragraph._p.append(r)
    b = OxmlElement('w:fldChar'); b.set(qn('w:fldCharType'), 'begin'); run_with(b)
    i = OxmlElement('w:instrText'); i.set(qn('xml:space'), 'preserve'); i.text = instr; run_with(i)
    s = OxmlElement('w:fldChar'); s.set(qn('w:fldCharType'), 'separate'); run_with(s)
    t = OxmlElement('w:t'); t.text = result; run_with(t)
    e = OxmlElement('w:fldChar'); e.set(qn('w:fldCharType'), 'end'); run_with(e)


def contract(version):
    v2 = version == 2
    doc = Document()
    doc.core_properties.title = 'Services Agreement'
    doc.add_heading('Services Agreement', level=0)
    p = doc.add_paragraph('This Services Agreement is made between ')
    p.add_run('Northwind Studio').bold = True
    p.add_run(' ("Contractor") and ')
    p.add_run('Harbor & Pine LLC').bold = True
    p.add_run(' ("Client").')

    h = doc.add_heading('1. Scope of work', level=1)
    add_bookmark(h, '_Toc_scope', 1)
    doc.add_paragraph(
        'The Contractor will design and build a marketing website with up to '
        + ('eight' if v2 else 'six') + ' pages, a blog and a contact form.')
    doc.add_paragraph('Deliverables include:')
    for item in (['Visual design for desktop and mobile', 'Content management training', 'Launch support for 30 days']
                 if not v2 else ['Visual design for desktop, tablet and mobile', 'Content management training',
                                 'Accessibility review', 'Launch support for 30 days']):
        doc.add_paragraph(item, style='List Bullet')

    doc.add_heading('2. Schedule', level=1)
    doc.add_paragraph('Work begins on the Effective Date and follows these milestones:')
    for item in ['Discovery workshop', 'Design approval', 'Launch']:
        doc.add_paragraph(item, style='List Number')

    doc.add_heading('3. Fees and payment', level=1)
    p = doc.add_paragraph('The Client will pay the fees below. Invoices are due ')
    r = p.add_run('within 15 days' if v2 else 'within 30 days')
    r.bold = True
    p.add_run(' of receipt.')
    table = doc.add_table(rows=1, cols=2)
    table.style = 'Table Grid'
    table.rows[0].cells[0].text = 'Milestone'
    table.rows[0].cells[1].text = 'Fee'
    rows = [('Discovery', '$3,000'), ('Design', '$4,500' if v2 else '$4,000'), ('Build', '$9,000')]
    if v2:
        rows.append(('Accessibility review', '$1,200'))
    for a, b in rows:
        cells = table.add_row().cells
        cells[0].text = a
        cells[1].text = b

    if not v2:
        doc.add_paragraph('Late payments accrue interest at 1.5% per month.')

    doc.add_heading('4. Intellectual property', level=1)
    p = doc.add_paragraph('On full payment, the Client owns the final deliverables. See ')
    add_hyperlink(p, 'https://example.com/terms' if not v2 else 'https://example.com/terms-2025', 'our standard terms')
    p.add_run('.')

    p = doc.add_paragraph('Logo: ')
    img = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
    img.write(BLUE_PNG if v2 else RED_PNG)
    img.close()
    p.add_run().add_picture(img.name, width=Inches(0.5))
    os.unlink(img.name)

    p = doc.add_paragraph('Printed on page ')
    add_field(p, ' PAGE ', '2')
    p.add_run('.')

    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    doc.add_heading('5. Signatures', level=1)
    p = doc.add_paragraph('Signed for the Client')
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER if v2 else WD_ALIGN_PARAGRAPH.LEFT
    doc.add_paragraph('Signed for the Contractor')
    if v2:
        sec = doc.add_section(WD_SECTION.NEW_PAGE)
        doc.add_paragraph('Appendix A: Accessibility checklist')
    return doc


def save(doc, name):
    path = os.path.join(OUT, name)
    doc.save(path)
    print('wrote', path)
    return path


a = save(contract(1), 'contract-v1.docx')
b = save(contract(2), 'contract-v2.docx')

# A document with comments and a footnote-like structure is covered by the unit tests' XML builders.
if shutil.which('soffice'):
    tmp = tempfile.mkdtemp()
    for src, name in ((a, 'contract-v1-lo.docx'), (b, 'contract-v2-lo.docx')):
        # Round-trip through LibreOffice to get a differently structured but equivalent file.
        subprocess.run(['soffice', '--headless', '--convert-to', 'odt', '--outdir', tmp, src], check=True,
                       capture_output=True)
        odt = os.path.join(tmp, os.path.basename(src).replace('.docx', '.odt'))
        subprocess.run(['soffice', '--headless', '--convert-to', 'docx:MS Word 2007 XML', '--outdir', tmp, odt],
                       check=True, capture_output=True)
        shutil.copy(os.path.join(tmp, os.path.basename(src)), os.path.join(OUT, name))
        print('wrote', os.path.join(OUT, name))


# ---------------------------------------------------------------------------
# A document exercising harder Word features: comments, footnotes, bookmarks,
# section breaks, a content control, tracked changes, a TOC field spanning
# paragraphs, a nested table and a custom paragraph style.

import copy

from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.opc.packuri import PackURI
from docx.opc.part import Part
from docx.oxml import parse_xml
from docx.enum.style import WD_STYLE_TYPE

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NSDECL = f'xmlns:w="{W}"'


def add_footnotes(doc, text):
    xml = (
        f'<w:footnotes {NSDECL}>'
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>'
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
        '<w:footnote w:id="1"><w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>'
        f'<w:r><w:t xml:space="preserve"> {text}</w:t></w:r></w:p></w:footnote>'
        '</w:footnotes>'
    )
    part = Part(PackURI('/word/footnotes.xml'),
                'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
                xml.encode('utf-8'), doc.part.package)
    doc.part.relate_to(part, RT.FOOTNOTES)


def footnote_ref(paragraph):
    paragraph._p.append(parse_xml(
        f'<w:r {NSDECL}><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r>'))


def toc(doc, entries):
    body = doc.element.body
    paras = []
    for i, (title, page) in enumerate(entries):
        begin = ('<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>'
                 '<w:r><w:fldChar w:fldCharType="separate"/></w:r>') if i == 0 else ''
        end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>' if i == len(entries) - 1 else ''
        paras.append(f'<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>{begin}<w:r><w:t>{title}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>{page}</w:t></w:r>{end}</w:p>')
    sdt = parse_xml(
        f'<w:sdt {NSDECL}><w:sdtPr><w:id w:val="-1512335"/><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr>'
        f'<w:sdtContent><w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>Contents</w:t></w:r></w:p>{"".join(paras)}</w:sdtContent></w:sdt>')
    body.insert(len(body) - 1, sdt)


def content_control(doc, lines):
    body = doc.element.body
    from xml.sax.saxutils import escape
    ps = ''.join(f'<w:p><w:r><w:t xml:space="preserve">{escape(l)}</w:t></w:r></w:p>' for l in lines)
    sdt = parse_xml(f'<w:sdt {NSDECL}><w:sdtPr><w:alias w:val="Client details"/><w:tag w:val="client"/><w:id w:val="731025"/></w:sdtPr><w:sdtContent>{ps}</w:sdtContent></w:sdt>')
    body.insert(len(body) - 1, sdt)


def tracked(paragraph, keep, inserted, deleted):
    paragraph._p.append(parse_xml(f'<w:r {NSDECL}><w:t xml:space="preserve">{keep}</w:t></w:r>'))
    paragraph._p.append(parse_xml(
        f'<w:ins {NSDECL} w:id="101" w:author="Reviewer" w:date="2026-05-01T10:00:00Z"><w:r><w:t xml:space="preserve">{inserted}</w:t></w:r></w:ins>'))
    paragraph._p.append(parse_xml(
        f'<w:del {NSDECL} w:id="102" w:author="Reviewer" w:date="2026-05-01T10:00:00Z"><w:r><w:delText xml:space="preserve">{deleted}</w:delText></w:r></w:del>'))


def complex_doc(version):
    v2 = version == 2
    doc = Document()
    toc(doc, [('1. Parties', '1'), ('2. Rates', '1'), ('3. Signatures' if not v2 else '3. Signing', '2')])
    doc.add_heading('Master Consulting Agreement', level=0)
    h = doc.add_heading('1. Parties', level=1)
    add_bookmark(h, '_Toc100000001', 10)
    content_control(doc, ['Harbor & Pine LLC', '12 Quay Street, Portland' if not v2 else '14 Quay Street, Portland'])
    p = doc.add_paragraph('The consultant is ')
    r = p.add_run('Northwind Studio')
    r.bold = True
    p.add_run('.')
    doc.add_comment([r], text='Confirm the legal name', author='Sam Rivera', initials='SR')

    if not v2:
        clause = doc.styles.add_style('Clause', WD_STYLE_TYPE.PARAGRAPH)
        clause.base_style = doc.styles['Normal']
        clause.paragraph_format.left_indent = Inches(0.4)
        clause.font.italic = True
        doc.add_paragraph('Each party acts as an independent contractor.', style='Clause')

    h = doc.add_heading('2. Rates', level=1)
    add_bookmark(h, '_Toc100000002', 11)
    p = doc.add_paragraph('Work is billed at $150 per hour' if not v2 else 'Work is billed at $165 per hour')
    footnote_ref(p)
    p.add_run('.')
    add_footnotes(doc, 'Rates are reviewed each January.' if not v2 else 'Rates are reviewed each April.')

    p = doc.add_paragraph()
    tracked(p, 'Expenses are reimbursed ', 'within 30 days ' if v2 else 'monthly ', 'at cost ')

    outer = doc.add_table(rows=1, cols=2)
    outer.style = 'Table Grid'
    outer.rows[0].cells[0].text = 'Rate card'
    inner = outer.rows[0].cells[1].add_table(rows=2, cols=2)
    inner.rows[0].cells[0].text = 'Senior'
    inner.rows[0].cells[1].text = '$150' if not v2 else '$165'
    inner.rows[1].cells[0].text = 'Junior'
    inner.rows[1].cells[1].text = '$95'

    doc.add_section(WD_SECTION.NEW_PAGE)
    h = doc.add_heading('3. Signatures' if not v2 else '3. Signing', level=1)
    add_bookmark(h, '_Toc100000003', 12)
    p = doc.add_paragraph('Signed on behalf of each party by an authorized representative.')
    if v2:
        doc.add_paragraph('Electronic signatures are binding.')
    return doc


save(complex_doc(1), 'complex-v1.docx')
save(complex_doc(2), 'complex-v2.docx')
