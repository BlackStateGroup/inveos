"""Runs only inside the isolated research container, against fictional PDFs."""
import hashlib,json,math,resource,time
from pathlib import Path
from pdf_text_coverage import text_coverage
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
coverage_cases={}
for name,expected_pages,missing in [('mixed',2,[2]),('blank',2,[1]),('raster',1,[1])]:
    path=Path('/original')/(name+'.pdf')
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    converted=convert(path)
    if converted.status!=ConversionStatus.SUCCESS:raise ValueError('Coverage fixture conversion failed')
    if len(converted.document.pages)!=expected_pages:raise ValueError('Lost original pages')
    extracted=[{'page':p.page_no,'text':item.text} for item in converted.document.texts for p in item.prov]
    coverage=text_coverage(expected_pages,extracted,True)
    if coverage['pagesWithoutText']!=missing:raise ValueError('Unexpected page coverage')
    if any(r['text']!=quote for r in extracted):raise ValueError('Fabricated raster text')
    if hashlib.sha256(path.read_bytes()).hexdigest()!=digest:raise ValueError('Original changed')
    coverage_cases[name]={'originalSha256':digest,'rows':extracted,'coverage':coverage}
for name in ('overpages','oversize'):
    path=Path('/original')/(name+'.pdf')
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    rejected=False
    try:
        converted=convert(path)
        rejected=converted.status!=ConversionStatus.SUCCESS
    except ValueError:rejected=True
    if not rejected:raise ValueError('Input limit was not enforced')
    if hashlib.sha256(path.read_bytes()).hexdigest()!=digest:raise ValueError('Rejected original changed')
    coverage_cases[name]={'originalSha256':digest,'rejected':True}
print(json.dumps({'parserExecuted':True,'originalSha256':before,'rows':rows,'malformedOutcome':malformed,'coverageCases':coverage_cases,'nativeDocument':result.document.model_dump(mode='json'),'elapsedSeconds':time.monotonic()-started,'maxRssKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss},sort_keys=True))
