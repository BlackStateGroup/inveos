"""Independent, standard-library validation of the optional composition v1 receipt.

This verifies consistency against the selected frozen reviewed findings. Reviewer
names/IDs are declarations, not signatures. Trust the separately retained whole
report fingerprint and the application's independent review controls.
"""
import hashlib
import json
import re
from datetime import datetime

UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
SHA = re.compile(r'^[a-f0-9]{64}$')


def require(condition, message):
    if not condition:
        raise ValueError('Composition: ' + message)


def shape(value, keys):
    require(isinstance(value, dict) and set(value) == set(keys.split()), 'unexpected receipt shape')


def identifier(value):
    require(isinstance(value, str) and UUID.fullmatch(value), 'invalid identifier')


def text(value, low=1, high=2000):
    require(isinstance(value, str) and low <= len(value.encode('utf-16-le')) // 2 <= high and value.strip() == value,
            'invalid declared text')
    require(not re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', value), 'control characters')
    value.encode('utf-8')


def timestamp(value):
    text(value, 1, 40)
    require(datetime.fromisoformat(value.replace('Z', '+00:00')).tzinfo is not None,
            'timezone required')


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(',', ':'),
                                    allow_nan=False).encode('utf-8')).hexdigest()


def verify_composition(report):
    if 'composition' not in report:
        return 0
    c = report['composition']
    shape(c, 'format payload sha256 authorId authorName recordedAt review')
    require(c['format'] == 'inveos_report_composition_v1', 'unknown format')
    p = c['payload']
    shape(p, 'format caseId id version state outline reason')
    require(p['format'] == 'inveos_report_outline_v1' and p['state'] == 'active', 'invalid outline format/state')
    identifier(p['id'])
    identifier(p['caseId'])
    require(p['caseId'] == report['case']['id'], 'case mismatch')
    require(type(p['version']) is int and 1 <= p['version'] <= 100, 'invalid version')
    text(p['reason'], 10)
    o = p['outline']
    shape(o, 'name scope method limitations sections')
    text(o['name'], 3, 150)
    for key in ('scope', 'method', 'limitations'):
        text(o[key], 10)
    sections = o['sections']
    require(isinstance(sections, list) and 1 <= len(sections) <= 50, 'invalid section count')
    section_ids, selected_ids, ordered = set(), set(), []
    actual = {}
    for kind, name in (('text', 'findings'), ('document', 'documentFindings'),
                       ('transcript', 'transcriptFindings'), ('speech', 'speechFindings')):
        for f in report.get(name, []):
            source = f['claim']['source'] if kind == 'transcript' else f['source']
            require(f['id'] not in actual, 'duplicate frozen finding')
            actual[f['id']] = (kind, digest(['inveos_composition_finding_v1', kind, f['id'],
                                          f['text'], f['reviewer'], f['reviewedAt'],
                                          source['id'], source['sha256']]))
    for section in sections:
        shape(section, 'id title findings')
        identifier(section['id'])
        text(section['title'], 3, 150)
        require(section['id'] not in section_ids, 'duplicate section identity')
        section_ids.add(section['id'])
        require(isinstance(section['findings'], list) and len(section['findings']) <= 1000,
                'invalid selection count')
        selections = []
        for f in section['findings']:
            shape(f, 'kind id sha256')
            identifier(f['id'])
            require(isinstance(f['sha256'], str) and SHA.fullmatch(f['sha256']), 'invalid finding digest')
            require(f['id'] not in selected_ids, 'duplicate selected finding')
            selected_ids.add(f['id'])
            require(actual.get(f['id']) == (f['kind'], f['sha256']), 'selected finding identity mismatch')
            selections.append({key: f[key] for key in ('kind', 'id', 'sha256')})
        ordered.append({'id': section['id'], 'title': section['title'], 'findings': selections})
    require(1 <= len(selected_ids) <= 1000 and selected_ids == set(actual), 'selection must cover exactly the frozen findings')
    canonical = {key: p[key] for key in ('format', 'caseId', 'id', 'version', 'state')}
    canonical['outline'] = {key: o[key] for key in ('name', 'scope', 'method', 'limitations')}
    canonical['outline']['sections'] = ordered
    canonical['reason'] = p['reason']
    require(c['sha256'] == digest(canonical), 'outline fingerprint mismatch')
    identifier(c['authorId'])
    text(c['authorName'])
    timestamp(c['recordedAt'])
    r = c['review']
    shape(r, 'id decision reason reviewerId reviewerName recordedAt')
    identifier(r['id'])
    identifier(r['reviewerId'])
    require(r['decision'] == 'accepted' and r['reviewerId'] != c['authorId'], 'independent acceptance required')
    text(r['reason'], 10)
    text(r['reviewerName'])
    timestamp(r['recordedAt'])
    # Composition v1 deliberately includes no unrelated working context.
    context = report['investigation']
    require(context.get('status') == 'working_context_not_findings', 'invalid context status')
    require(all(not context.get(key) for key in ('objectives', 'questions', 'hypotheses', 'blockers',
                                                'chronology', 'documentLinks', 'transcriptLinks', 'speechLinks')),
            'composition v1 must not include unrelated working context')
    return len(selected_ids)
