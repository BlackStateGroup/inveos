"""Single-original research runner, executed only in the qualified offline container."""
import hashlib,json
from pathlib import Path
from docling.datamodel.base_models import InputFormat,ConversionStatus
from docling.datamodel.pipeline_options import NativePdfPipelineOptions
from docling.pipeline.native_pdf_pipeline import NativePdfPipeline
from docling.datamodel.document import InputDocument
from docling.datamodel.settings import DocumentLimits
from docling.datamodel.backend_options import ThreadedDoclingParseBackendOptions
from docling.backend.docling_parse_backend import ThreadedDoclingParseDocumentBackend

path=Path('/original/input.pdf')
original=path.read_bytes()
if not 1<=len(original)<=65536:raise ValueError('Original limit')
before=hashlib.sha256(original).hexdigest()
document=InputDocument(path_or_stream=path,format=InputFormat.PDF,
    backend=ThreadedDoclingParseDocumentBackend,
    backend_options=ThreadedDoclingParseBackendOptions(parser_threads=1,include_bitmap_images=False,render_pages=False),
    limits=DocumentLimits(max_num_pages=2,max_file_size=65536))
if not document.valid:raise ValueError('Invalid bounded PDF')
pipeline=NativePdfPipeline(NativePdfPipelineOptions(generate_page_images=False,generate_picture_images=False,parser_threads=1,document_timeout=20))
result=pipeline.execute(document,raises_on_error=True)
if result.status!=ConversionStatus.SUCCESS:raise ValueError('Incomplete conversion')
if hashlib.sha256(path.read_bytes()).hexdigest()!=before:raise ValueError('Original changed')
print(json.dumps({'successful':True,'originalSha256':before,'document':result.document.model_dump(mode='json')}))
