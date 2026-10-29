#!/usr/bin/env python3
"""Independently verify INVEOS's narrow deterministic report PDF profile.

This is not a general PDF validator. It rejects features outside the first-party
profile and verifies that every visible text stream exactly represents the
embedded redacted semantic model.
"""
import argparse, hashlib, json, re, sys
from pathlib import Path

PROFILE={"format":"inveos_report_pdf_v1","pdfVersion":"1.4","page":[612,792],"font":"Helvetica","encoding":"WinAnsiEncoding","fontSize":10,"leading":12,"margin":[48,32],"maxVisibleLines":48000}
CP1252={0x20AC:0x80,0x201A:0x82,0x0192:0x83,0x201E:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,0x02C6:0x88,0x2030:0x89,0x0160:0x8A,0x2039:0x8B,0x0152:0x8C,0x017D:0x8E,0x2018:0x91,0x2019:0x92,0x201C:0x93,0x201D:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02DC:0x98,0x2122:0x99,0x0161:0x9A,0x203A:0x9B,0x0153:0x9C,0x017E:0x9E,0x0178:0x9F}
HEX64=re.compile(r'^[a-f0-9]{64}$')
MAX_PDF_BYTES=33554432

class VerificationError(ValueError):pass
def sha(value):return hashlib.sha256(value).hexdigest()
def unique_object(pairs):
    result={}
    for key,value in pairs:
        if key in result:raise VerificationError('Duplicate JSON key')
        result[key]=value
    return result
def winansi(text):
    out=bytearray()
    for char in text:
        point=ord(char)
        if point==9:out.append(0x20)
        elif 0x20<=point<=0x7E or 0xA0<=point<=0xFF:out.append(point)
        elif point in CP1252:out.append(CP1252[point])
        else:raise VerificationError('Unsupported PDF character')
    return bytes(out)
def header(raw,name):
    match=re.search(rb'^%INVEOS-'+name.encode()+rb' ([a-f0-9]{64})$',raw,re.M)
    if not match:raise VerificationError('Missing profile fingerprint header')
    return match.group(1).decode()
def canonical_pdf(model_bytes,model,source,redaction,model_digest):
    lines=model['visibleLines'];pages=[lines[index:index+58] for index in range(0,len(lines),58)] or [[]]
    font_number=3+2*len(pages);model_number=font_number+1
    objects=[f'<< /Type /Catalog /Pages 2 0 R /INVEOSModel {model_number} 0 R >>'.encode(),f"<< /Type /Pages /Kids [{' '.join(f'{3+i*2} 0 R' for i in range(len(pages)))}] /Count {len(pages)} >>".encode()]
    for index,page in enumerate(pages):
        page_object=3+index*2;content_object=page_object+1
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {font_number} 0 R >> >> /Contents {content_object} 0 R >>'.encode())
        commands=b'BT /F1 10 Tf 48 760 Td 12 TL\n'+b'\n'.join(b'<'+winansi(line).hex().upper().encode()+b'> Tj T*' for line in page)+b'\nET\n'
        objects.append(f'<< /Length {len(commands)} >>\nstream\n'.encode()+commands+b'endstream')
    objects.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    encoded=model_bytes.hex().upper().encode()+b'>';objects.append(f'<< /Length {len(encoded)} /Filter /ASCIIHexDecode >>\nstream\n'.encode()+encoded+b'\nendstream')
    raw=bytearray(f'%PDF-1.4\n%INVEOS-PROFILE inveos_report_pdf_v1\n%INVEOS-SOURCE-SHA256 {source}\n%INVEOS-REDACTION-SHA256 {redaction}\n%INVEOS-MODEL-SHA256 {model_digest}\n'.encode());offsets=[]
    for number,body in enumerate(objects,1):offsets.append(len(raw));raw.extend(f'{number} 0 obj\n'.encode()+body+b'\nendobj\n')
    xref=len(raw);raw.extend(f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode());raw.extend(b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets));raw.extend(f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode());return bytes(raw)
def verify(raw,expected_pdf=None,expected_report=None):
    if not 1<=len(raw)<=MAX_PDF_BYTES or not raw.startswith(b'%PDF-1.4\n') or not raw.endswith(b'%%EOF\n'):raise VerificationError('Invalid PDF envelope')
    if any(token in raw for token in (b'/Annots',b'/JavaScript',b'/OpenAction',b'/EmbeddedFiles',b'/Filespec')):raise VerificationError('Forbidden active or attached content')
    pdf_digest=sha(raw)
    if expected_pdf and pdf_digest!=expected_pdf:raise VerificationError('PDF fingerprint mismatch')
    source=header(raw,'SOURCE-SHA256');redaction=header(raw,'REDACTION-SHA256');model_digest=header(raw,'MODEL-SHA256')
    if expected_report and source!=expected_report:raise VerificationError('Source report fingerprint mismatch')
    profile_match=re.search(rb'^%INVEOS-PROFILE ([a-z0-9_]+)$',raw,re.M)
    if not profile_match or profile_match.group(1)!=b'inveos_report_pdf_v1':raise VerificationError('Unexpected PDF profile')
    models=re.findall(rb'/Filter /ASCIIHexDecode >>\nstream\n([0-9A-F]+)>\nendstream',raw)
    if len(models)!=1:raise VerificationError('Expected one semantic model stream')
    try:model_bytes=bytes.fromhex(models[0].decode());model=json.loads(model_bytes,object_pairs_hook=unique_object)
    except (ValueError,UnicodeError,RecursionError) as error:raise VerificationError('Invalid semantic model') from error
    if not isinstance(model,dict):raise VerificationError('Invalid semantic model object')
    if sha(model_bytes)!=model_digest or set(model)!={'format','profile','profileDigest','sourceReportSha256','redaction','visibleLines','pageCount'}:raise VerificationError('Semantic model fingerprint or shape mismatch')
    profile_digest=sha(json.dumps(PROFILE,separators=(',',':')).encode())
    if model['format']!='inveos_report_pdf_model_v1' or model['profile']!='inveos_report_pdf_v1' or model['profileDigest']!=profile_digest or model['sourceReportSha256']!=source:raise VerificationError('Semantic model profile/source mismatch')
    red=model['redaction']
    if not isinstance(red,dict) or set(red)!={'digest','count','reason'} or red.get('digest')!=redaction or not HEX64.fullmatch(redaction) or not isinstance(red.get('count'),int) or red['count']<0 or not isinstance(red.get('reason'),str) or (red['count']==0 and red['reason']) or (red['count']>0 and not 10<=len(red['reason'])<=500):raise VerificationError('Invalid redaction metadata')
    if type(red['count']) is not int:raise VerificationError('Redaction count must be an integer')
    lines=model['visibleLines'];pages=model['pageCount']
    if type(pages) is not int:raise VerificationError('Page count must be an integer')
    if not isinstance(lines,list) or len(lines)>PROFILE['maxVisibleLines'] or not all(isinstance(line,str) for line in lines) or not isinstance(pages,int) or pages!=max(1,(len(lines)+57)//58):raise VerificationError('Invalid visible line model')
    expected=[]
    for index in range(0,len(lines),58):
        page=lines[index:index+58]
        expected.append(b'BT /F1 10 Tf 48 760 Td 12 TL\n'+b'\n'.join(b'<'+winansi(line).hex().upper().encode()+b'> Tj T*' for line in page)+b'\nET\n')
    if not expected:expected=[b'BT /F1 10 Tf 48 760 Td 12 TL\n\nET\n']
    streams=re.findall(rb'<< /Length [0-9]+ >>\nstream\n(.*?)endstream',raw,re.S)
    if streams!=expected:raise VerificationError('Visible PDF streams do not match the semantic model')
    if raw!=canonical_pdf(model_bytes,model,source,redaction,model_digest):raise VerificationError('PDF structure is not the canonical profile encoding')
    return {'format':'inveos_report_pdf_verification_v1','pdfSha256':pdf_digest,'sourceReportSha256':source,'redactionSha256':redaction,'modelSha256':model_digest,'profileSha256':profile_digest,'pageCount':pages,'visibleLinesChecked':len(lines),'semanticStreamsMatched':True}
def read_pdf(path):
    # Bound allocation even when a file grows after opening; do not trust stat.
    with Path(path).open('rb') as stream:
        raw=stream.read(MAX_PDF_BYTES+1)
    if len(raw)>MAX_PDF_BYTES:raise VerificationError('PDF exceeds the byte limit')
    return raw

def main():
    parser=argparse.ArgumentParser();parser.add_argument('pdf');parser.add_argument('--expected-pdf-sha256');parser.add_argument('--expected-report-sha256');args=parser.parse_args()
    for value in (args.expected_pdf_sha256,args.expected_report_sha256):
        if value and not HEX64.fullmatch(value):parser.error('Expected fingerprints must be lowercase SHA-256 values')
    try:result=verify(read_pdf(args.pdf),args.expected_pdf_sha256,args.expected_report_sha256)
    except (OSError,VerificationError) as error:print(f'verification failed: {error}',file=sys.stderr);return 1
    print(json.dumps(result,separators=(',',':'),sort_keys=True));return 0
if __name__=='__main__':raise SystemExit(main())
