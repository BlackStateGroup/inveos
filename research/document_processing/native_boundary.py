"""First-party research bridge from actual native output to scoped citations.

Caller context/runtime identity must come from the trusted dispatcher. This is
not authentication, storage, approval, or a signature against wholesale forgery.
"""
import json
import math
from .contract import MAX_BYTES, canonical, digest, normalise_docling, verify_citation
from tools.pdf_text_coverage import text_coverage


def _unique_pairs(pairs):
    result={}
    for key,value in pairs:
        if key in result:raise ValueError('Duplicate JSON key')
        result[key]=value
    return result


def build_envelope(original, raw, context, *, worker_context, runtime, successful):
    if type(raw) is not bytes or len(raw)>MAX_BYTES:raise ValueError('Raw output limit')
    if context!=worker_context:raise ValueError('Job context mismatch')
    if type(successful) is not bool or not successful:raise ValueError('Incomplete parser result')
    if not isinstance(runtime,dict):raise ValueError('Missing runtime provenance')
    for key in ('image_sha256','wheel_inventory_sha256'):
        value=runtime.get(key)
        if not isinstance(value,str) or len(value)!=64 or any(c not in '0123456789abcdef' for c in value):
            raise ValueError('Invalid runtime digest')
    data=json.loads(raw,object_pairs_hook=_unique_pairs)
    if not isinstance(data,dict):raise ValueError('Invalid native document')
    pages=data.get('pages')
    if not isinstance(pages,dict) or not 1<=len(pages)<=1000:raise ValueError('Missing original pages')
    if set(pages)!={str(i) for i in range(1,len(pages)+1)}:raise ValueError('Non-contiguous original pages')
    for key,page in pages.items():
        if not isinstance(page,dict) or type(page.get('page_no')) is not int or page['page_no']!=int(key):
            raise ValueError('Page identity mismatch')
        size=page.get('size')
        if not isinstance(size,dict) or any(type(size.get(k)) not in (int,float) or not math.isfinite(size[k]) or size[k]<=0 for k in ('width','height')):
            raise ValueError('Invalid page dimensions')
    # Reuse the existing contract, preserving the entire raw document digest.
    record=normalise_docling(original,raw,context,worker_context=worker_context,
        tool_version=runtime.get('tool_version'),tool_revision=runtime.get('tool_revision',''),configuration=runtime)
    rows=[]
    for ref in record['references']:
        page=pages.get(str(ref['page']))
        if page is None:raise ValueError('Reference outside original pages')
        box=ref['bbox'];size=page['size']
        if max(box['l'],box['r'])>size['width'] or max(box['b'],box['t'])>size['height']:
            raise ValueError('Reference outside original page')
        rows.append({'page':ref['page'],'text':record['text'].encode()[ref['start_byte']:ref['end_byte']].decode()})
    body={'schema':'inveos.native-boundary-lab.v1','extraction':record,
          'coverage':text_coverage(len(pages),rows,True),
          'runtime':runtime,'reviewState':'unreviewed','offsetBasis':'extracted_utf8_not_original_pdf'}
    return {**body,'envelope_sha256':digest(canonical(body))}


def cite_envelope(envelope,original,raw,context,*,runtime,item_ref,start_byte,end_byte,quote):
    rebuilt=build_envelope(original,raw,context,worker_context=context,runtime=runtime,successful=True)
    if rebuilt!=envelope:raise ValueError('Extraction envelope changed')
    citation=verify_citation(envelope['extraction'],original,raw,context,runtime,item_ref,start_byte,end_byte,quote)
    return {**citation,'envelope_sha256':envelope['envelope_sha256'],'coverage':envelope['coverage']}
