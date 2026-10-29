"""First-party fictional adversity corpus; native imports occur only in isolation.

The worker extraction code is reused unchanged. Metrics describe this small
controlled English corpus, not representative scan accuracy or legal approval.
"""
import base64
import csv
import hashlib
import io
import json
import random
import re
import time
import sys
from pathlib import Path
from collections import Counter
from supplier_scan_fixture import PAGES, digital_supplier_pdf, package, scanned_supplier_pdf

CASES=('clean', 'small_type', 'low_resolution', 'skew_plus_2', 'skew_minus_2',
       'skew_plus_7', 'low_contrast', 'blur', 'jpeg_compression', 'speckles',
       'three_columns', 'blank')
TABLE=['FICTIONAL WORK RECORD', 'ITEM     MINUTES     QUANTITY',
       'ALPHA       15          30', 'BIRCH       25          40',
       'TOTAL       40          70']


def tokens(text):
    """Declared metric: uppercase ASCII letters/digits; punctuation is excluded."""
    if not isinstance(text,str) or len(text)>20000:
        raise ValueError('Metric text bound')
    words=re.findall(r'[A-Z0-9]+',text.upper())
    if len(words)>1000 or len(' '.join(words))>8000:
        raise ValueError('Metric token bound')
    return words


def distance(expected,actual):
    previous=list(range(len(actual)+1))
    for i,left in enumerate(expected,1):
        current=[i]
        for j,right in enumerate(actual,1):
            current.append(min(previous[j]+1,current[j-1]+1,previous[j-1]+(left!=right)))
        previous=current
    return previous[-1]


def measure(expected,actual):
    ref,seen=tokens(expected),tokens(actual)
    reference=' '.join(ref);observed=' '.join(seen)
    word_errors=distance(ref,seen);character_errors=distance(reference,observed)
    required=Counter(w for w in ref if w.isdigit());found=Counter(w for w in seen if w.isdigit())
    return {'referenceWords':len(ref),'observedWords':len(seen),'wordErrors':word_errors,
            'wordErrorRate':word_errors/max(1,len(ref)),
            'characterErrors':character_errors,'characterErrorRate':character_errors/max(1,len(reference)),
            'missingNumericTokens':dict(required-found),'unexpectedNumericTokens':dict(found-required),
            'normalisedExact':ref==seen,'normalisedText':observed}


def text_pdf(lines,font=14):
    objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
             b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>']
    # All strings are first-party constants. No supplied text or external font.
    stream=f'BT /F1 {font} Tf 48 720 Td 28 TL\n'.encode()+b'\n'.join(b'('+line.encode('ascii')+b') Tj T*' for line in lines)+b'\nET\n'
    objects.extend([f'<< /Length {len(stream)} >>\nstream\n'.encode()+stream+b'endstream',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'])
    return package(objects)


def source(case):
    if case not in CASES:raise ValueError('Unknown fictional corpus case')
    lines=[] if case=='blank' else TABLE if case=='three_columns' else PAGES[1]
    return text_pdf(lines,8 if case=='small_type' else 14) if case in ('blank','three_columns','small_type') else digital_supplier_pdf(1), '\n'.join(lines)


def scan(case):
    # This function is called only by the qualified, networkless container.
    import pypdfium2 as pdfium
    from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
    digital,expected=source(case)
    document=pdfium.PdfDocument(digital)
    try:
        page=document[0]
        try:
            bitmap=page.render(scale=2,may_draw_forms=False,draw_annots=False)
            try:image=bitmap.to_pil().convert('RGB')
            finally:bitmap.close()
        finally:page.close()
    finally:document.close()
    try:
        changed=None
        if case=='low_resolution':
            changed=image.resize((612,792),Image.Resampling.BILINEAR)
        elif case.startswith('skew_'):
            angle={'skew_plus_2':2,'skew_minus_2':-2,'skew_plus_7':7}[case]
            changed=image.rotate(angle,resample=Image.Resampling.BICUBIC,expand=False,fillcolor='white')
        elif case=='low_contrast':changed=ImageEnhance.Contrast(image).enhance(0.25)
        elif case=='blur':changed=image.filter(ImageFilter.GaussianBlur(1.0))
        elif case=='jpeg_compression':
            encoded=io.BytesIO();image.save(encoded,format='JPEG',quality=25,optimize=False)
            with Image.open(io.BytesIO(encoded.getvalue())) as decoded:changed=decoded.convert('RGB')
        elif case=='speckles':
            # Local fixed PRNG: no entropy, real image or outside corpus enters.
            rng=random.Random(1941);draw=ImageDraw.Draw(image)
            for _ in range(800):
                x=rng.randrange(image.width);y=rng.randrange(image.height)
                draw.rectangle((x,y,x+1,y+1),fill=(60,60,60))
        if changed is not None:image.close();image=changed
        original=scanned_supplier_pdf([(image.width,image.height,image.tobytes())])
        return original,expected,{'width':image.width,'height':image.height,'rgbSha256':hashlib.sha256(image.tobytes()).hexdigest(),'digitalSha256':hashlib.sha256(digital).hexdigest()}
    finally:image.close()


def observed_text(result):
    words=[]
    for page in result['pages']:
        data=base64.b64decode(page['tsvBase64'],validate=True).decode('utf8')
        for row in csv.DictReader(io.StringIO(data),delimiter='\t',quoting=csv.QUOTE_NONE):
            if row.get('level')=='5' and row.get('text','').strip():words.append(row['text'])
    return ' '.join(words)


def run():
    from run_ocr_document import extract
    cases=[]
    for name in CASES:
        print("Fictional OCR corpus case: "+name,file=sys.stderr,flush=True)
        original,expected,render=scan(name);attempts=[]
        for _ in range(2):
            started=time.monotonic()
            try:
                result=extract(original)
            except ValueError as error:
                if str(error) not in {'Original exceeds the OCR profile','OCR page bound','OCR raster dimensions','OCR PNG bound'}:
                    raise  # Process failures, malformed output and metric failures fail the experiment.
                # No OCR output is confirmed for a rejected input. This is
                # recorded as a rejection, never a successful accuracy score.
                attempts.append({'outcome':'rejected_without_confirmed_ocr_output',
                                 'elapsedSeconds':round(time.monotonic()-started,6),'reason':str(error)[:200]})
            else:
                if result['originalSha256']!=hashlib.sha256(original).hexdigest():raise RuntimeError('Original identity disagreement')
                text=observed_text(result)
                attempts.append({'outcome':'actual_ocr_output','elapsedSeconds':round(time.monotonic()-started,6),
                                 'rawSha256':hashlib.sha256(json.dumps(result,separators=(',',':')).encode()).hexdigest(),
                                 'tsvPages':[{'page':page['page'],'tsvBase64':page['tsvBase64'],'tsvSha256':hashlib.sha256(base64.b64decode(page['tsvBase64'],validate=True)).hexdigest()} for page in result['pages']],
                                 'metrics':measure(expected,text)})
        stable=all(a['outcome']==attempts[0]['outcome'] and a.get('rawSha256')==attempts[0].get('rawSha256') and a.get('reason')==attempts[0].get('reason') for a in attempts)
        cases.append({'case':name,'fictional':True,'originalSha256':hashlib.sha256(original).hexdigest(),'originalBytes':len(original),
                      'render':render,'expectedText':expected,'attempts':attempts,'repeatStable':stable})
    clean=cases[0]
    if any(a['outcome']!='actual_ocr_output' or not a['metrics']['normalisedExact'] for a in clean['attempts']):raise ValueError('Known clean baseline regressed: '+json.dumps(clean,separators=(',',':')))
    if not all(item['repeatStable'] for item in cases):raise ValueError('Repeated fixed corpus output changed: '+json.dumps([item for item in cases if not item['repeatStable']],separators=(',',':')))
    return {'runnerSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'extractorSha256':hashlib.sha256(Path('/original/run_ocr_document.py').read_bytes()).hexdigest(),
            'fixtureGeneratorSha256':hashlib.sha256(Path('/original/supplier_scan_fixture.py').read_bytes()).hexdigest(),
            'format':'inveos.ocr_adversity_measurement.v1','cases':cases,'attemptCount':len(CASES)*2,
            'successfulOcrAttempts':sum(a['outcome']=='actual_ocr_output' for item in cases for a in item['attempts']),
            'metric':'uppercase ASCII alphanumeric tokens; punctuation excluded; edit rates may exceed one',
            'professionalApproval':False,'productionApproval':False,
            'limitations':'Controlled fictional English pages only. No representative client scans, multilingual/handwritten accuracy, semantic table reconstruction, provenance authenticity or legal acceptance.'}


if __name__=='__main__':
    print(json.dumps(run(),separators=(',',':')))
