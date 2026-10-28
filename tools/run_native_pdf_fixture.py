"""Runs only inside the isolated research container, against fictional PDFs."""
import hashlib,json,math,resource,time
from pathlib import Path
from docling.datamodel.base_models import InputFormat,ConversionStatus
from docling.datamodel.pipeline_options import NativePdfPipelineOptions
from docling.pipeline.native_pdf_pipeline import NativePdfPipeline
from docling.datamodel.document import InputDocument
from docling.datamodel.settings import DocumentLimits
from docling.datamodel.backend_options import ThreadedDoclingParseBackendOptions
from docling.backend.docling_parse_backend import ThreadedDoclingParseDocumentBackend

original=Path('/original/digital.pdf')
before=hashlib.sha256(original.read_bytes()).hexdigest()
def convert(path):
    document=InputDocument(path_or_stream=path,format=InputFormat.PDF,
        backend=ThreadedDoclingParseDocumentBackend,
        backend_options=ThreadedDoclingParseBackendOptions(parser_threads=1,include_bitmap_images=False,render_pages=False),
        limits=DocumentLimits(max_num_pages=2,max_file_size=65536))
    if not document.valid:raise ValueError('Invalid bounded PDF input')
    pipeline=NativePdfPipeline(NativePdfPipelineOptions(generate_page_images=False,generate_picture_images=False,parser_threads=1,document_timeout=20))
    return pipeline.execute(document,raises_on_error=True)
started=time.monotonic()
result=convert(original)
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
    bad=convert(Path('/original/malformed.pdf'))
    if bad.status!=ConversionStatus.SUCCESS:malformed=str(bad.status)
except Exception as error:malformed=type(error).__name__
if malformed=='not_rejected':raise ValueError('Malformed PDF accepted')
if hashlib.sha256(original.read_bytes()).hexdigest()!=before:raise ValueError('Original changed')
print(json.dumps({'parserExecuted':True,'originalSha256':before,'rows':rows,'malformedOutcome':malformed,'elapsedSeconds':time.monotonic()-started,'maxRssKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss},sort_keys=True))
