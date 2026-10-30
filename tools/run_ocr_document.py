"""First-party bounded runner. Imports native libraries only inside isolation."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
from bounded_process import run_bounded
from pdf_render_limits import render_size


def extract(original, profile_version=1):
    if type(profile_version) is not int or profile_version not in (1,2):
        raise ValueError('Unknown OCR profile version')
    maximum = 65536 if profile_version == 1 else 262144
    if not 0 < len(original) <= maximum or not original.startswith(b'%PDF-'):
        raise ValueError('Original exceeds the OCR profile')
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(original)
    try:
        if not 1 <= len(doc) <= 2:
            raise ValueError('OCR page bound')
        pages = []
        for index in range(len(doc)):
            page = doc[index]
            try:
                width, height = page.get_size()
                render_size(width, height, page.get_rotation(), page.get_mediabox(), page.get_cropbox())
                if width <= 0 or height <= 0 or width * 2 > 2048 or height * 2 > 2048 or width * height * 4 > 2000000 or width != int(width) or height != int(height):
                    raise ValueError('OCR raster dimensions')
                bitmap = page.render(scale=2, rotation=0, crop=(0,0,0,0), may_draw_forms=False, draw_annots=False)
                try:
                    image = bitmap.to_pil().convert('RGB')
                    try:
                        encoded = io.BytesIO()
                        image.save(encoded, format='PNG')
                        png = encoded.getvalue()
                        if len(png) > 262144 or (image.width, image.height) != (int(width * 2), int(height * 2)):
                            raise ValueError('OCR PNG bound')
                    finally:
                        image.close()
                finally:
                    bitmap.close()
                path = Path('/scratch/ocr-input.png')
                path.write_bytes(png)
                result = run_bounded(['tesseract', str(path), 'stdout', '-l', 'eng', '--dpi', '144', '--psm', '6', 'tsv'], timeout=30, max_output=131072)
                if result.returncode:
                    raise ValueError('OCR failed')
                pages.append(dict(page=index + 1, width=int(width * 2), height=int(height * 2),
                                  pngBase64=base64.b64encode(png).decode('ascii'), tsvBase64=base64.b64encode(result.stdout).decode('ascii')))
            finally:
                page.close()
        return dict(format='inveos_tesseract_pages_v1', originalSha256=hashlib.sha256(original).hexdigest(), pages=pages)
    finally:
        doc.close()


if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--profile-version',type=int,choices=(1,2),default=1)
    args=parser.parse_args()
    os.environ['OMP_THREAD_LIMIT']='1'
    os.environ['OMP_NUM_THREADS']='1'
    with Path('/original/input.pdf').open('rb') as stream:
        original = stream.read((65536 if args.profile_version == 1 else 262144)+1)
    output = json.dumps(extract(original,args.profile_version), separators=(',', ':'))
    if len(output.encode()) > 1000000:
        raise ValueError('OCR result size bound')
    print(output)
