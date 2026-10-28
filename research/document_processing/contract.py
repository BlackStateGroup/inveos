"""Synthetic, stdlib-only extraction boundary. No parser execution or app writes.

Offsets refer to UTF-8 derivative bytes, NEVER original PDF bytes. Caller-owned
job context is compared explicitly; this is not an authentication mechanism.
"""
from dataclasses import asdict, dataclass
import hashlib
import json
import math

MAX_BYTES = 2_000_000
MAX_ITEMS = 1000


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(',', ':'),
                      ensure_ascii=False, allow_nan=False).encode('utf-8')


@dataclass(frozen=True)
class Context:
    tenant_id: str
    case_id: str
    evidence_id: str
    authority_id: str
    authority_version: int
    original_sha256: str
    source_time: str
    received_time: str

    def __post_init__(self):
        if any(not isinstance(v, str) or not v for k, v in asdict(self).items()
               if k != 'authority_version'):
            raise ValueError('Missing context')
        if type(self.authority_version) is not int or self.authority_version < 1:
            raise ValueError('Invalid authority version')
        if len(self.original_sha256) != 64 or any(c not in '0123456789abcdef' for c in self.original_sha256):
            raise ValueError('Invalid original digest')


def normalise_docling(original: bytes, raw: bytes, context: Context, *,
                      worker_context: Context, tool_version: str,
                      tool_revision: str, configuration: dict) -> dict:
    """Accept a deliberately narrow Docling JSON text-item subset.

    Only single-page, full-item charspans are supported. Tables, pictures,
    multi-page items and partial spans fail closed pending richer adapters.
    No upstream results are promoted to claims or findings.
    """
    if context != worker_context:
        raise ValueError('Job context mismatch')
    if not original or len(original) > MAX_BYTES or len(raw) > MAX_BYTES:
        raise ValueError('Input size limit')
    if digest(original) != context.original_sha256:
        raise ValueError('Original digest mismatch')
    if not tool_version or len(tool_revision) != 40 or any(c not in '0123456789abcdef' for c in tool_revision):
        raise ValueError('Missing pinned tool provenance')
    if not isinstance(configuration, dict):
        raise ValueError('Invalid configuration')
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError('Expected document object')
    items = data.get('texts')
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_ITEMS:
        raise ValueError('Text item limit')
    chunks, references, seen = [], [], set()
    offset = 0
    for item in items:
        if not isinstance(item, dict):
            raise ValueError('Expected text item object')
        text, ref, prov = item.get('text'), item.get('self_ref'), item.get('prov')
        if not isinstance(text, str) or not text or not isinstance(ref, str) or not ref.startswith('#/texts/') or ref in seen:
            raise ValueError('Invalid or repeated text item')
        if not isinstance(prov, list) or len(prov) != 1:
            raise ValueError('Exactly one source location required')
        p = prov[0]
        if not isinstance(p, dict):
            raise ValueError('Expected provenance object')
        page, box = p.get('page_no'), p.get('bbox')
        if type(page) is not int or page < 1 or p.get('charspan') != [0, len(text)]:
            raise ValueError('Invalid page or unsupported character span')
        if not isinstance(box, dict) or box.get('coord_origin') not in ('TOPLEFT', 'BOTTOMLEFT'):
            raise ValueError('Missing coordinate origin')
        coords = [box.get(k) for k in ('l', 't', 'r', 'b')]
        if any(type(v) not in (int, float) or not math.isfinite(v) or v < 0 for v in coords):
            raise ValueError('Invalid bounding box')
        l, t, r, b = coords
        if l >= r or (t >= b if box['coord_origin'] == 'TOPLEFT' else b >= t):
            raise ValueError('Inverted bounding box')
        encoded = text.encode('utf-8')
        references.append({'item_ref': ref, 'page': page, 'bbox': box,
                           'start_byte': offset, 'end_byte': offset + len(encoded)})
        chunks.append(encoded)
        offset += len(encoded) + 1
        seen.add(ref)
    text_bytes = b'\n'.join(chunks)
    if len(text_bytes) > MAX_BYTES:
        raise ValueError('Output size limit')
    body = {'schema': 'inveos.extraction-lab.v1', 'context': asdict(context),
            'state': 'unreviewed_derivative', 'tool': {'name': 'docling',
            'version': tool_version, 'revision': tool_revision},
            'configuration_sha256': digest(canonical(configuration)),
            'raw_sha256': digest(raw), 'text_sha256': digest(text_bytes),
            'text': text_bytes.decode('utf-8'), 'references': references}
    return {**body, 'extraction_id': digest(canonical(body))}


def verify_citation(record: dict, original: bytes, raw: bytes, context: Context,
                    configuration: dict, item_ref: str, start_byte: int,
                    end_byte: int, quote: str) -> dict:
    """Rebuild the derivative and validate an explicitly selected occurrence.

    Result remains unreviewed. A real reviewer must compare the original page.
    """
    rebuilt = normalise_docling(original, raw, context, worker_context=context,
        tool_version=record['tool']['version'], tool_revision=record['tool']['revision'],
        configuration=configuration)
    if rebuilt != record:
        raise ValueError('Derivative or provenance changed')
    if type(start_byte) is not int or type(end_byte) is not int or not isinstance(quote, str) or not quote:
        raise ValueError('Invalid quote')
    ref = next((r for r in record['references'] if r['item_ref'] == item_ref), None)
    if ref is None or not ref['start_byte'] <= start_byte < end_byte <= ref['end_byte']:
        raise ValueError('Quote outside source item')
    if record['text'].encode('utf-8')[start_byte:end_byte] != quote.encode('utf-8'):
        raise ValueError('Quote does not match derivative bytes')
    return {'state': 'unreviewed_derivative_citation', 'extraction_id': record['extraction_id'],
            'original_sha256': context.original_sha256, 'item_ref': item_ref,
            'page': ref['page'], 'bbox': ref['bbox'], 'quote': quote,
            'start_byte': start_byte, 'end_byte': end_byte,
            'offset_basis': 'extracted_utf8_not_original_pdf'}
