#!/usr/bin/env python3
"""Independent verifier for INVEOS's narrow internal DOCX profile, not arbitrary Office files."""
import argparse
import base64
import binascii
import hashlib
import io
import json
import re
import struct
import sys
import zipfile
from pathlib import Path

MAX_BYTES = 33554432
PROFILE = {'format': 'inveos_report_docx_v1', 'encoding': 'UTF-8', 'zip': 'store', 'maxParagraphs': 48000, 'maxBytes': MAX_BYTES}
DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
NAMES = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'customXml/item1.xml']
CONTENT_TYPES = DECLARATION + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
RELATIONSHIPS = DECLARATION + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
DOCUMENT_RELATIONSHIPS = DECLARATION + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/></Relationships>'
MODEL_PREFIX = DECLARATION + '<inveos:model xmlns:inveos="urn:inveos:report-docx:v1" encoding="base64">'
MODEL_SUFFIX = '</inveos:model>'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fingerprint(value):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate model key')
        result[key] = value
    return result


def escape(value):
    require(isinstance(value, str), 'Non-text paragraph')
    for c in value:
        p = ord(c)
        require(not (p < 32 and p != 9 or 0xd800 <= p <= 0xdfff or p in (0xfffe, 0xffff)), 'Unsupported XML character')
    return value.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;').replace("'", '&apos;')


def package(parts):
    """Independently reconstruct each local header, directory entry and ZIP terminator."""
    local, directory = bytearray(), bytearray()
    for name, value in zip(NAMES, parts):
        name_bytes, data = name.encode('ascii'), value.encode('utf-8')
        crc, size, offset = binascii.crc32(data), len(data), len(local)
        local.extend(struct.pack('<I5H3I2H', 0x04034b50, 20, 0, 0, 0, 33, crc, size, size, len(name_bytes), 0))
        local.extend(name_bytes)
        local.extend(data)
        directory.extend(struct.pack('<I6H3I5H2I', 0x02014b50, 20, 20, 0, 0, 0, 33, crc, size, size, len(name_bytes), 0, 0, 0, 0, 0, offset))
        directory.extend(name_bytes)
    ending = struct.pack('<I4H2IH', 0x06054b50, 0, 0, 5, 5, len(directory), len(local), 0)
    return bytes(local + directory + ending)


def verify(data, expected_docx_sha256=None, expected_report_sha256=None):
    require(100 <= len(data) <= MAX_BYTES, 'DOCX byte limit')
    actual = digest(data)
    for expected in (expected_docx_sha256, expected_report_sha256):
        require(expected is None or fingerprint(expected), 'Invalid trusted fingerprint')
    require(expected_docx_sha256 is None or actual == expected_docx_sha256, 'DOCX fingerprint mismatch')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        require([entry.filename for entry in entries] == NAMES, 'Unexpected or duplicate package parts')
        require(all(entry.compress_type == zipfile.ZIP_STORED and not entry.flag_bits and entry.file_size == entry.compress_size for entry in entries), 'Unexpected ZIP encoding')
        require(sum(entry.file_size for entry in entries) <= MAX_BYTES, 'Expanded package limit')
        parts = [archive.read(name).decode('utf-8', 'strict') for name in NAMES]
    require(parts[0] == CONTENT_TYPES and parts[1] == RELATIONSHIPS and parts[3] == DOCUMENT_RELATIONSHIPS, 'Unexpected content types or relationships')
    metadata = parts[4]
    require(metadata.startswith(MODEL_PREFIX) and metadata.endswith(MODEL_SUFFIX), 'Invalid semantic part')
    raw = base64.b64decode(metadata[len(MODEL_PREFIX):-len(MODEL_SUFFIX)], validate=True)
    require(len(raw) <= 8 * 1024 * 1024, 'Model byte limit')
    model = json.loads(raw, object_pairs_hook=unique_pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Invalid JSON number')))
    require(isinstance(model, dict) and set(model) == {'format', 'profile', 'profileDigest', 'sourceReportSha256', 'redaction', 'paragraphs'}, 'Model shape')
    require(encoded(model) == raw, 'Non-canonical model bytes')
    require(model['profile'] in ['inveos_report_docx_v1', 'inveos_report_docx_v2'], 'Unknown profile')
    profile = {**PROFILE, 'format': model['profile']}
    notice = 'EDITABLE INTERNAL COPY — NOT A CLIENT RELEASE' if model['profile'] == 'inveos_report_docx_v1' else 'EDITABLE REPORT COPY — VERIFY DISCLOSURE APPROVAL SEPARATELY'
    require(model['format'] == 'inveos_report_docx_model_v1' and model['profileDigest'] == digest(encoded(profile)), 'Unknown profile')
    source = model['sourceReportSha256']
    require(fingerprint(source) and (expected_report_sha256 is None or source == expected_report_sha256), 'Source report fingerprint mismatch')
    redaction = model['redaction']
    require(isinstance(redaction, dict) and set(redaction) == {'digest', 'count', 'reason'}, 'Redaction shape')
    require(fingerprint(redaction['digest']) and type(redaction['count']) is int and 0 <= redaction['count'] <= 1000 and isinstance(redaction['reason'], str), 'Redaction fields')
    reason_length = len(redaction['reason'].encode('utf-16-le')) // 2
    require(10 <= reason_length <= 500 if redaction['count'] else redaction['reason'] == '', 'Redaction reason')
    paragraphs = model['paragraphs']
    require(isinstance(paragraphs, list) and 3 <= len(paragraphs) <= PROFILE['maxParagraphs'], 'Paragraph limit')
    require(paragraphs[:3] == [notice, 'Editing changes the file fingerprint. No review or release approval transfers to an edited copy.', 'Frozen report SHA-256: ' + source], 'Missing internal-copy notice')
    document = DECLARATION + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    for paragraph in paragraphs:
        text = escape(paragraph).replace('\t', '</w:t><w:tab/><w:t xml:space="preserve">')
        bold = '<w:b/>' if paragraph == notice or re.match(r'^(INVEOS INTERNAL REPORT|EDITABLE INTERNAL COPY|FINDING \d|DOCUMENT FINDING \d|TRANSCRIPT FINDING \d|WORKING CONTEXT|REPORT LIMITATIONS|ALLEGED EVENTS|TRANSCRIPT REASONING LINKS|DOCUMENT REASONING LINKS)', paragraph) else ''
        document += '<w:p><w:pPr><w:spacing w:after="80"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/>' + bold + '</w:rPr><w:t xml:space="preserve">' + text + '</w:t></w:r></w:p>'
    document += '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>'
    require(parts[2] == document, 'Visible document differs from the redacted semantic model')
    require(package(parts) == data, 'Non-canonical ZIP headers, extra bytes or metadata')
    return {'format': profile['format'], 'docxSha256': actual, 'sourceReportSha256': source, 'contentSha256': digest(raw), 'paragraphsMatched': True, 'paragraphCount': len(paragraphs), 'trustedDocxFingerprintMatched': expected_docx_sha256 is not None, 'limitation': 'Internal consistency only. This does not authenticate the source, current permission, human review, redaction completeness or legal admissibility. Editing invalidates the original fingerprint.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path', type=Path)
    parser.add_argument('--expected-docx-sha256')
    parser.add_argument('--expected-report-sha256')
    args = parser.parse_args()
    try:
        with args.path.open('rb') as stream:
            data = stream.read(MAX_BYTES + 1)
        print(json.dumps(verify(data, args.expected_docx_sha256, args.expected_report_sha256), ensure_ascii=False))
    except (ValueError, OSError, KeyError, TypeError, zipfile.BadZipFile, binascii.Error, UnicodeError, RecursionError) as error:
        print('Verification failed: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
