"""Independent standard-library replay of the fictional OCR lineage profile.

Checks stored bytes and mappings; does not run OCR or certify visual accuracy.
"""
import base64
import hashlib
import json
import math
import re
import struct
import zlib

if __package__:
    from .verify_report import InvalidReport, require, unique_object, reject_constant
else:
    from verify_report import InvalidReport, require, unique_object, reject_constant

PROFILE = '3eaf9e8346c3496729f98a2c846abc75d4afac066f3e8c3c9b4ada6acb323e76'
LOCK = 'bfcdba20feb42105845bbce39b243925dd12133e9358630ab1384125c84e1172'
HEADER = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def exact(value, keys):
    require(isinstance(value, dict) and set(value) == set(keys.split()), 'OCR record fields')


def blob(value, maximum):
    require(isinstance(value, str) and 0 < len(value) <= 4 * math.ceil(maximum / 3), 'OCR blob bound')
    try:
        raw = base64.b64decode(value, validate=True)
    except ValueError as exc:
        raise InvalidReport('Invalid OCR base64') from exc
    require(0 < len(raw) <= maximum and base64.b64encode(raw).decode() == value, 'OCR blob encoding')
    return raw


def png(raw, width, height):
    require(type(width) is int and type(height) is int and 0 < width <= 2048 and 0 < height <= 2048
            and width * height <= 2000000 and width % 2 == height % 2 == 0, 'OCR raster dimensions')
    require(raw.startswith(b'\x89PNG\r\n\x1a\n') and len(raw) >= 57, 'OCR PNG signature')
    offset, parts, header, ended = 8, [], False, False
    while offset < len(raw):
        require(not ended and offset + 12 <= len(raw), 'OCR PNG chunk bound')
        length = struct.unpack_from('>I', raw, offset)[0]
        end = offset + 12 + length
        require(end <= len(raw), 'OCR PNG chunk size')
        kind, data = raw[offset + 4:offset + 8], raw[offset + 8:end - 4]
        require(zlib.crc32(raw[offset + 4:end - 4]) == struct.unpack_from('>I', raw, end - 4)[0], 'OCR PNG CRC')
        if kind == b'IHDR':
            require(not header and offset == 8 and data == struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0), 'OCR PNG profile')
            header = True
        elif kind == b'IDAT':
            require(header and data, 'OCR PNG pixels')
            parts.append(data)
        elif kind == b'IEND':
            require(header and parts and not data and end == len(raw), 'OCR PNG end')
            ended = True
        else:
            raise InvalidReport('Unsupported OCR PNG chunk')
        offset = end
    require(ended, 'Truncated OCR PNG')
    stride = 3 * width + 1
    inflater = zlib.decompressobj()
    pixels = inflater.decompress(b''.join(parts), stride * height + 1)
    require(len(pixels) == stride * height and inflater.eof and not inflater.unused_data and not inflater.unconsumed_tail
            and all(pixels[y * stride] <= 4 for y in range(height)), 'OCR PNG pixel stream')


def ocr_derivative(raw, context, original):
    require(0 < len(raw) <= 1048576 and 0 < len(original) <= 65536 and original.startswith(b'%PDF-') and sha(original) == context['sourceDigest'], 'OCR original bound or digest')
    data = json.loads(raw.decode('utf-8'), object_pairs_hook=unique_object, parse_constant=reject_constant)
    exact(data, 'format originalSha256 runtimeImageId artifactLock pages')
    require(data['format'] == 'inveos_tesseract_pages_v1' and data['originalSha256'] == sha(original) and data['artifactLock'] == LOCK
            and isinstance(data['runtimeImageId'], str) and re.fullmatch(r'sha256:[0-9a-f]{64}', data['runtimeImageId']), 'OCR runtime identity')
    require(isinstance(data['pages'], list) and 1 <= len(data['pages']) <= 2, 'OCR page count')
    dimensions, references, artifacts, counts, texts, offset = [], [], [], [], [], 0
    for index, p in enumerate(data['pages']):
        exact(p, 'page width height pngBase64 tsvBase64')
        require(type(p['page']) is int and p['page'] == index + 1, 'OCR page identity')
        width, height = p['width'], p['height']
        image, tsv = blob(p['pngBase64'], 262144), blob(p['tsvBase64'], 131072)
        png(image, width, height)
        dimensions.append(dict(page=index + 1, width=width // 2, height=height // 2))
        image_digest, tsv_digest = sha(image), sha(tsv)
        artifacts.append(dict(page=index + 1, inputPngDigest=image_digest, rawTsvDigest=tsv_digest,
                              renderScale=2, pixelWidth=width, pixelHeight=height))
        value = tsv.decode('utf-8')
        require(value.endswith('\n') and '\r' not in value, 'OCR TSV line endings')
        lines = value[:-1].split('\n')
        require(lines.pop(0) == HEADER and len(lines) <= 5000, 'OCR TSV header or bound')
        count = 0
        for row_index, line in enumerate(lines):
            columns = line.split('\t')
            require(len(columns) == 12 and all(re.fullmatch(r'0|[1-9][0-9]*', v) for v in columns[:10]), 'OCR TSV columns')
            values = list(map(int, columns[:10]))
            require(all(v <= 9007199254740991 for v in values) and 1 <= values[0] <= 5 and values[1] == 1, 'OCR TSV hierarchy')
            x, y, w, h = values[6:10]
            require(x + w <= width and y + h <= height, 'OCR word bounds')
            if values[0] != 5:
                require(columns[10:] == ['-1', ''], 'OCR structural row')
                continue
            word = columns[11]
            require(re.fullmatch(r'[0-9]+(?:\.[0-9]+)?', columns[10]) and word and len(word.encode()) <= 500
                    and not re.search(r'[\s\x00-\x1f\x7f]', word) and w > 0 and h > 0 and len(references) < 1000, 'OCR word record')
            confidence = float(columns[10])
            require(math.isfinite(confidence) and 0 <= confidence <= 100, 'OCR confidence')
            if references:
                offset += 1
            start = offset
            offset += len(word.encode())
            references.append(dict(itemRef=f'#/texts/{len(references)}', page=index + 1,
                bbox=dict(l=x / 2, r=(x + w) / 2, b=(y + h) / 2, t=y / 2, origin='TOPLEFT'), startByte=start, endByte=offset,
                ocr=dict(tsvRow=row_index + 2, confidence=confidence, pixelBox=[x, y, x + w, y + h], inputPngDigest=image_digest, rawTsvDigest=tsv_digest)))
            texts.append(word)
            count += 1
        counts.append(count)
    missing = [i + 1 for i, count in enumerate(counts) if not count]
    return dict(format='inveos_ocr_document_v1', context=context, profileDigest=PROFILE, rawDigest=sha(raw), reviewState='unreviewed',
                offsetBasis='ocr_utf8_not_original_pdf', pages=dimensions, text='\n'.join(texts), references=references,
                coverage=dict(pageTextCounts=counts, pagesWithoutText=missing, disposition='needs_page_review' if missing else 'unreviewed_text', completeExtractionVerified=False),
                ocr=dict(runtimeImageId=data['runtimeImageId'], artifactLock=LOCK, artifacts=artifacts,
                         limitations=['ocr_may_be_wrong','reading_order_unreviewed','forms_omitted','annotations_omitted','visual_fidelity_unapproved']))
