"""Runs only inside the isolated research container, against fictional PDFs."""
import hashlib,json,math,resource,time
from pathlib import Path
from docling.datamodel.base_models import InputFormat,ConversionStatus
from docling.datamodel.pipeline_options import NativePdfPipelineOptions
from docling.document_converter import DocumentConverter,NativePdfFormatOption

original=Path('/original/digital.pdf')
before=hashlib.sha256(original.read_bytes()).hexdigest()
converter=DocumentConverter(allowed_formats=[InputFormat.PDF],format_options={InputFormat.PDF:NativePdfFormatOption(pipeline_options=NativePdfPipelineOptions(generate_page_images=False,document_timeout=20))})
started=time.monotonic()
result=converter.convert(original,max_num_pages=2,max_file_size=65536)
if result.status!=ConversionStatus.SUCCESS:raise ValueError('Synthetic PDF conversion incomplete')
rows=[]
for item in result.document.texts:
    for prov in item.prov:
        box=prov.bbox.model_dump(mode='json')
        if not all(math.isfinite(box[k]) for k in ('l','r','t','b')):raise ValueError('Non-finite box')
        if not (70<=box['l']<=74 and box['l']<box['r']<400):raise ValueError('Incorrect horizontal region')
        y=[box['t'],box['b']]
        if str(box['coord_origin']).upper()=='TOPLEFT':y=[792-v for v in y]
        if not (695<=min(y)<max(y)<=715):raise ValueError('Incorrect vertical region')
        rows.append({'text':item.text,'page':prov.page_no,'box':box,'charspan':list(prov.charspan)})
quote='FICTIONAL INVEOS repeated passage'
if len(rows)!=2 or sorted(r['page'] for r in rows)!=[1,2] or any(r['text']!=quote or r['charspan']!=[0,len(quote)] for r in rows):raise ValueError('Incorrect repeated source references')
malformed='not_rejected'
try:
    bad=converter.convert(Path('/original/malformed.pdf'),max_num_pages=2,max_file_size=65536)
    if bad.status!=ConversionStatus.SUCCESS:malformed=str(bad.status)
except Exception as error:malformed=type(error).__name__
if malformed=='not_rejected':raise ValueError('Malformed PDF accepted')
if hashlib.sha256(original.read_bytes()).hexdigest()!=before:raise ValueError('Original changed')
print(json.dumps({'parserExecuted':True,'originalSha256':before,'rows':rows,'malformedOutcome':malformed,'elapsedSeconds':time.monotonic()-started,'maxRssKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss},sort_keys=True))
