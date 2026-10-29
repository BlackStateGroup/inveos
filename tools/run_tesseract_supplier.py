"""Runs only inside the qualified OCR research container; no application writes."""
import collections
import base64
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import resource
import sys
import time
from bounded_process import run_bounded
from supplier_scan_fixture import PAGES,digital_supplier_pdf,scanned_supplier_pdf


def sha(data):return hashlib.sha256(data).hexdigest()


def words(raw,width,height):
    if len(raw)>1024*1024:raise ValueError('TSV output limit exceeded')
    result=[]
    for row in csv.DictReader(io.StringIO(raw.decode('utf-8')),delimiter='\t',quoting=csv.QUOTE_NONE):
        if row.get('level')!='5':continue
        if len(result)>=1000:raise ValueError('Word limit exceeded')
        x,y,w,h=[int(row[key]) for key in ('left','top','width','height')];confidence=float(row['conf']);text=row['text']
        if not text or len(text)>500 or not math.isfinite(confidence) or not 0<=confidence<=100 or x<0 or y<0 or w<=0 or h<=0 or x+w>width or y+h>height:raise ValueError('Invalid OCR word geometry or confidence')
        result.append(dict(text=text,confidence=confidence,pixelBox=[x,y,x+w,y+h],pdfBox=[x/2,y/2,(x+w)/2,(y+h)/2],origin='TOPLEFT'))
    return result


def inventory():
    def cli(args):
        r=run_bounded(args,timeout=20,max_output=2*1024*1024)
        if r.returncode:raise ValueError('Inventory command failed')
        return r.stdout.decode()
    packages={}
    for line in cli(['dpkg-query','-W','-f=${binary:Package}\t${Version}\t${Architecture}\n']).splitlines():
        name,version,architecture=line.split('\t');packages[name]=dict(version=version,architecture=architecture)
    def artifact(path):
        path=Path(path);data=path.read_bytes()
        if len(data)>64*1024*1024:raise ValueError('Artifact bound exceeded')
        return dict(path=str(path),resolvedPath=str(path.resolve()),bytes=len(data),sha256=sha(data))
    native=cli(['ldd','/usr/bin/tesseract']);paths=['/usr/bin/tesseract']
    paths+=re.findall(r'(?:=>\s+|^\s*)(/[^\s]+)',native,re.M)
    records=[]
    for value in sorted(set(paths+['/usr/share/tesseract-ocr/5/tessdata/eng.traineddata'])):
        path=Path(value);found=None
        for query in [str(path),str(path.resolve()),'*/'+path.name]:
            response=run_bounded(['dpkg-query','-S',query],timeout=10,max_output=65536)
            for line in response.stdout.decode().splitlines():
                owner,separator,owned=line.partition(': ')
                if separator and Path(owned).resolve()==path.resolve():found=owner;break
            if found:break
        if not found or found not in packages:raise ValueError('Runtime file has no package owner')
        notice=Path('/usr/share/doc')/found.split(':')[0]/'copyright'
        data=notice.read_bytes()
        records.append({**artifact(path),'package':found,'packageVersion':packages[found]['version'],'copyright':artifact(notice),'declaredLicences':sorted(set(re.findall(r'^License: (.+)$',data.decode('utf-8',errors='replace'),re.M)))})
    for name in ['tesseract-ocr','tesseract-ocr-eng']:
        if b'License: Apache-2.0' not in (Path('/usr/share/doc')/name/'copyright').read_bytes():raise ValueError('Unexpected primary OCR or language-data terms')
    if packages.get('tesseract-ocr',{}).get('version')!='5.3.0-2':raise ValueError('Unexpected OCR package revision')
    return dict(format='inveos_tesseract_runtime_inventory_v1',packages=packages,artifacts=records,
                libraryLoading='ldd_inside_qualified_isolation',parserExecuted=False,
                approval='research_only_no_shipping_or_licence_approval')


def experiment():
    # Native PDF/image code is imported only after the outer controller has
    # inspected the runtime inventory and proved the container restrictions.
    import pypdfium2 as pdfium
    root=Path('/scratch');digital=digital_supplier_pdf();doc=pdfium.PdfDocument(digital);images=[]
    for page in doc:
        bitmap=page.render(scale=2);image=bitmap.to_pil().convert('RGB');images.append((image.width,image.height,image.tobytes()));bitmap.close();page.close()
    doc.close();scan=scanned_supplier_pdf(images);original=root/'fictional-scanned-register.pdf';original.write_bytes(scan)
    scan_doc=pdfium.PdfDocument(scan);results=[]
    for attempt in range(2):
        pages=[]
        for index,page in enumerate(scan_doc):
            # Prove the scan has no hidden digital text layer before OCR.
            text=page.get_textpage()
            if text.count_chars()!=0:raise ValueError('Synthetic scan contains a hidden text layer')
            text.close()
            bitmap=page.render(scale=2);image=bitmap.to_pil().convert('RGB');path=root/f'page-{index+1}.png';image.save(path);width,height=image.size;image.close();bitmap.close();page.close()
            start=time.monotonic();result=run_bounded(['tesseract',str(path),'stdout','-l','eng','--dpi','144','--psm','6','tsv'],timeout=30,max_output=1024*1024)
            if result.returncode:raise ValueError('OCR failed on fictional scan')
            rows=words(result.stdout,width,height);expected=collections.Counter(re.findall('[A-Z0-9]+',' '.join(PAGES[index])));actual=collections.Counter(re.findall('[A-Z0-9]+',' '.join(row['text'] for row in rows).upper()))
            pages.append(dict(page=index+1,width=width,height=height,renderScale=2,sourcePdfSha256=sha(scan),inputPngSha256=sha(path.read_bytes()),rawTsvSha256=sha(result.stdout),words=rows,
                              expectedTokens=sum(expected.values()),matchedTokens=sum((expected&actual).values()),observedTokens=sum(actual.values()),
                              wallSeconds=time.monotonic()-start,cumulativeChildrenPeakRssKiB=resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss))
        results.append(pages)
    scan_doc.close()
    if original.read_bytes()!=scan:raise ValueError('Original scan changed')
    if [p['rawTsvSha256'] for p in results[0]]!=[p['rawTsvSha256'] for p in results[1]]:raise ValueError('Repeated OCR output differs')
    malformed=root/'malformed.png';malformed.write_bytes(b'FICTIONAL malformed image')
    bad=run_bounded(['tesseract',str(malformed),'stdout','-l','eng','tsv'],timeout=15,max_output=65536)
    if bad.returncode==0:raise ValueError('Malformed input unexpectedly succeeded')
    # The case journey uses genuinely separate records; the historical two-page
    # benchmark above remains byte-for-byte comparable with previous receipts.
    register=pdfium.PdfDocument(digital_supplier_pdf(1))
    page=register[0];bitmap=page.render(scale=2,may_draw_forms=False,draw_annots=False)
    image=bitmap.to_pil().convert('RGB')
    register_scan=scanned_supplier_pdf([(image.width,image.height,image.tobytes())])
    image.close();bitmap.close();page.close();register.close()
    return dict(status='fictional_scanned_supplier_measured',digitalGeneratorSha256=sha(digital),originalScanSha256=sha(scan),originalScanBase64=base64.b64encode(scan).decode(),originalUnchanged=True,
                supplierSources={'declarationPdfBase64':base64.b64encode(digital_supplier_pdf(0)).decode(),'scannedRegisterPdfBase64':base64.b64encode(register_scan).decode()},
                runs=results,malformedInputRejected=True,allExpectedTokensRecovered=all(p['matchedTokens']==p['expectedTokens'] for p in results[0]),
                sourceRevision='Debian tesseract-ocr 5.3.0-2; not the catalogue source-head pin',
                limitations='English clean synthetic raster only; no skew/noise/multilingual/table/real scan accuracy, API attachment, human acceptance or product approval')


if __name__=='__main__':
    os.environ['OMP_THREAD_LIMIT']='1'
    print(json.dumps(inventory() if '--inventory' in sys.argv else experiment(),sort_keys=True))
