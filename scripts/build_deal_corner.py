"""
Builds the expert photos for the Deal Corner Experts page (/deal-corner/) and prints each bionote
as plain text, ready to be condensed into deal-corner/experts.js.

Run:  python scripts/build_deal_corner.py ["path\\to\\Deal Corner_RP Bio and Photo"]

The source folder (photos and .docx bionotes, one folder per track) stays outside the repo. Only the
square 640 px photos are written, to public/deal-corner/experts/<slug>.jpg. Two bionotes carry their
photo inside the .docx, so the photo is taken from word/media.

To add an expert: add a line to EXPERTS, run this, then add the entry to deal-corner/experts.js.
"""
import io
import os
import re
import sys
import zipfile
from xml.etree import ElementTree

from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'deal-corner', 'experts')
DEFAULT_SRC = os.path.join(os.path.expanduser('~'), 'Downloads',
                           'Deal Corner_RP Bio and Photo-20261112T081552Z-1-001', 'Deal Corner_RP Bio and Photo')
SIZE = 640

# slug, photo (a file, or 'docx:' to take it from the bionote), bionote, crop.
# crop = (centre x, centre y, side) as fractions of the photo: side is of the shorter edge.
EXPERTS = [
    ('arceu-honculada', r'CEFMU\Arceu James Honculada\IMG_0296.JPG',
     r'CEFMU\Arceu James Honculada\Bionote.docx', (0.5, 0.36, 0.9)),
    ('abby-roberts', r'CEFMU\Abby Roberts\AR Photo.jpeg',
     r'CEFMU\Abby Roberts\Bionote_Abby Roberts.docx', (0.49, 0.48, 0.78)),
    # Her photo has a round frame; the page's round crop stays inside it.
    ('amina-moni', r'CEFMU\Amina Moni\Photo-Amina-Plan International ARO.png',
     r'CEFMU\Amina Moni\Short Bio-Amina 2026.docx', (0.5, 0.4, 0.7)),
    ('erickson-name', r'CEFMU\Eric Name\Erick Name.png',
     r'CEFMU\Eric Name\EBN_bionote.pdf', (0.53, 0.32, 0.7)),
    ('maria-stella-echano', r'Climate Justice\Picture_TelayEchano_2025.jpg',
     r'Climate Justice\Short Bio_Deal Corner_Maria Stella Echano.docx', (0.52, 0.4, 0.85)),
    ('eva-notte', r'Child Labour\Eva Notte\EN white background.jpg',
     r'Child Labour\Eva Notte', (0.5, 0.4, 0.9)),
    ('marielle-chico', r'Child Labour\Marielle Chico\ChicoM_Full_Left.jpg',
     r'Child Labour\Marielle Chico\Marielle Chico bio note.docx', (0.5, 0.166, 0.35)),
    ('bess-herbert', 'docx:', r'Corporal Punishment\Bess Herbert\Bess Herbert short bio 2027.docx', (0.48, 0.28, 0.5)),
    ('sabine-rakotomalala', r'Corporal Punishment\Sabine Rakotomalala\Bio Picture_light.jpg',
     r'Corporal Punishment\Sabine Rakotomalala\Bio Sabine Rakotomalala (short).docx', (0.5, 0.4, 0.95)),
    ('itsaraporn-daoram', r'OCSEA\Itsaraporn (A) Daoram\Profile Picture of A (002).jpg',
     r'OCSEA\Itsaraporn (A) Daoram\Short Bio of Itsaraporn.docx', (0.5, 0.4, 0.95)),
    ('ha-ryong-jung', r'OCSEA\Mr. Ha Ryong Jung (Michael)\Photo_Jung.jpg',
     r'OCSEA\Mr. Ha Ryong Jung (Michael)\Bio.docx', (0.5, 0.38, 0.9)),
    # Not the .crdownload.jpg in the packs: that download stops at her nose. The .png she sent
    # separately isn't in the newer pack, so her existing photo is kept when it's missing.
    ('vanessa-bautista', r'OCSEA\Vanessa Bautista\Vanessa Bautista Photo.png',
     r'OCSEA\Vanessa Bautista\Bio_Vanessa Bautista.docx', (0.51, 0.45, 0.88)),
    ('mary-grace-blando', 'docx:', r'Child Protection (CANE+D)\MGZB_Bionote 2024.docx', (0.51, 0.21, 0.45)),
]

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
CONTACT = re.compile(r'[\w.+-]+@[\w-]+\.[\w.]+|(?:\+?\d[\d\s()-]{8,}\d)')


def find_docx(src, path):
    """A bionote path may name its folder only (Eva's filename has an accent that varies by tool)."""
    full = os.path.join(src, path)
    if os.path.isdir(full):
        docs = [f for f in os.listdir(full) if f.lower().endswith('.docx')]
        if len(docs) != 1:
            sys.exit(f'expected one .docx in {full}, found {docs}')
        full = os.path.join(full, docs[0])
    return full


def pdf_text(path):
    from pypdf import PdfReader
    text = ' '.join(page.extract_text() or '' for page in PdfReader(path).pages)
    # pypdf splits some words at line ends ("syst ems"); paragraphs aren't recoverable, so return one.
    return [re.sub(r'\s+', ' ', text).strip()]


def docx_text(path):
    if path.lower().endswith('.pdf'):
        return pdf_text(path)
    with zipfile.ZipFile(path) as z:
        root = ElementTree.fromstring(z.read('word/document.xml'))
    paras = []
    for p in root.iter(W + 'p'):
        text = ''.join(t.text or '' for t in p.iter(W + 't')).strip()
        if text:
            paras.append(text)
    return paras


def docx_photo(path):
    """The largest image in the document: the portrait, not a logo or a divider."""
    with zipfile.ZipFile(path) as z:
        media = [n for n in z.namelist() if n.startswith('word/media/')]
        if not media:
            sys.exit(f'no image inside {path}')
        name = max(media, key=lambda n: z.getinfo(n).file_size)
        return Image.open(io.BytesIO(z.read(name)))


def square(img, crop):
    cx, cy, side = crop
    w, h = img.size
    s = int(min(w, h) * side)
    left = min(max(0, int(cx * w - s / 2)), w - s)
    top = min(max(0, int(cy * h - s / 2)), h - s)
    return img.crop((left, top, left + s, top + s)).resize((SIZE, SIZE), Image.LANCZOS)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    if not os.path.isdir(src):
        sys.exit(f'source folder not found: {src}')
    os.makedirs(OUT, exist_ok=True)

    for slug, photo, bio, crop in EXPERTS:
        doc = find_docx(src, bio)
        out = os.path.join(OUT, f'{slug}.jpg')
        if photo is None:
            note = 'no photo yet'
        elif photo != 'docx:' and not os.path.exists(os.path.join(src, photo)):
            note = 'photo not in this pack, existing one kept' if os.path.exists(out) else 'PHOTO MISSING'
        else:
            img = docx_photo(doc) if photo == 'docx:' else Image.open(os.path.join(src, photo))
            img = ImageOps.exif_transpose(img)
            if img.mode in ('RGBA', 'LA', 'P'):
                img = img.convert('RGBA')
                flat = Image.new('RGB', img.size, (255, 255, 255))
                flat.paste(img, mask=img.split()[-1])
                img = flat
            img = square(img.convert('RGB'), crop)
            img.save(out, 'JPEG', quality=82, optimize=True, progressive=True)
            note = f'{os.path.getsize(out) // 1024} KB photo'

        paras = docx_text(doc)
        print(f'\n=== {slug}  ({note})')
        for p in paras:
            print('  ' + p)
        found = sorted({m.strip() for p in paras for m in CONTACT.findall(p)})
        if found:
            print(f'  !! contact details in this bionote, do not publish: {found}')


if __name__ == '__main__':
    main()
