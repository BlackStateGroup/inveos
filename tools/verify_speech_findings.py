"""Speech finding consistency checks, independent of the application and ASR runtime."""
from datetime import datetime
try:
    from tools.verify_speech_context import verify_bytes, serialise, sha, account
    from tools.verify_transcript import require, keys, identifier, string, timestamp
except ModuleNotFoundError:
    from verify_speech_context import verify_bytes, serialise, sha, account
    from verify_transcript import require, keys, identifier, string, timestamp

LIMITATIONS = 'Interpretation of a human-reviewed speech account. Recognition, corrected words, speaker labels and time ranges remain attributed accounts, not proof of identity, factual truth or complete recording coverage.'


def same(left, right):
    return serialise(left, True) == serialise(right, True)


def verify_findings(report, finding_ids, evidence):
    values = report.get('speechFindings', [])
    require(type(values) is list and len(values) <= 200, 'Speech finding count bound')
    tenants = set()
    for finding in values:
        keys(finding, set('kind id text reviewer reviewedAt source claim review'.split()))
        require(finding['kind'] == 'reviewed_speech', 'Unknown speech finding kind')
        identifier(finding['id']); require(finding['id'] not in finding_ids, 'Duplicate speech finding identity'); finding_ids.add(finding['id'])
        claim, review = finding['claim'], finding['review']
        keys(claim, set('id caseId text proposedBy proposedAt digest source context reference limitations'.split()))
        for k in ('id', 'caseId', 'proposedBy'):
            identifier(claim[k])
        require(claim['caseId'] == report['case']['id'] and claim['limitations'] == LIMITATIONS, 'Speech scope or limitations differ')
        string(claim['text'], 2000); require(len(claim['text'].strip()) >= 10, 'Speech interpretation is missing')
        timestamp(claim['proposedAt'], utc=True)
        require(sha(serialise({k: v for k, v in claim.items() if k != 'digest'}, True)) == claim['digest'], 'Speech proposal fingerprint differs')
        verify_bytes(serialise(claim['context']))
        p = claim['context']['payload']; source = claim['source']; ref = claim['reference']
        require(p['caseId'] == claim['caseId'], 'Cross-case speech context')
        tenants.add(p['derivative']['context']['tenantId'])
        keys(source, set('id filename sha256 sourceTime receivedTime policy'.split()))
        expected_source = dict(zip(('id', 'filename', 'sha256', 'sourceTime', 'receivedTime'), (p['source'][k] for k in ('evidenceId', 'filename', 'digest', 'sourceTime', 'receivedTime'))))
        require(same({k: v for k, v in source.items() if k != 'policy'}, expected_source) and same(finding['source'], source), 'Speech original metadata differs')
        policy = source['policy']; keys(policy, set('authorityId authorityVersion purpose lawfulBasis scope retentionDays minimisation'.split()))
        require(policy['authorityId'] == p['source']['authorityId'] and type(policy['authorityVersion']) is int and policy['authorityVersion'] == p['source']['authorityVersion'] == p['derivative']['context']['authorityVersion'], 'Speech authority differs')
        require(type(policy['retentionDays']) is int and 1 <= policy['retentionDays'] <= 3650, 'Speech retention bound')
        for k in ('purpose', 'lawfulBasis', 'scope', 'minimisation'):
            string(policy[k], 10000)
        keys(ref, set('jobId segmentIndex version correspondenceDigest offsetBasis startByte endByte quote account'.split()))
        require(ref['jobId'] == p['jobId'] and type(ref['segmentIndex']) is int and 0 <= ref['segmentIndex'] < len(p['segments']), 'Speech segment identity differs')
        segment = p['segments'][ref['segmentIndex']]
        require(type(ref['version']) is int and ref['version'] == len(segment['corrections']), 'Speech selected version differs')
        selected = account(segment['raw'], segment['corrections'][-1] if segment['corrections'] else None)
        correspondence = next((v['decision'] for v in segment['reviews'] if v['decision']['version'] == ref['version']), None)
        require(correspondence is not None and correspondence['accepted'] is True and correspondence['digest'] == ref['correspondenceDigest'], 'Accepted audio correspondence required')
        require(selected['hasSpeech'] is True and same(selected, ref['account']) and ref['offsetBasis'] == 'selected_speech_utf8_not_original_audio', 'Speech citation context differs')
        start, end = ref['startByte'], ref['endByte']; content = selected['text'].encode('utf-8'); string(ref['quote'], 10000)
        require(type(start) is int and type(end) is int and 0 <= start < end <= len(content) and content[start:end] == ref['quote'].encode('utf-8'), 'Speech citation does not match UTF-8 bytes')
        keys(review, set('id claimId claimDigest accepted reason reviewerId reviewerName recordedAt'.split()))
        identifier(review['id']); identifier(review['reviewerId']); string(review['reviewerName'], 1500000, empty=True, controls=True); string(review['reason'], 3000)
        require(len(review['reason'].strip()) >= 10, 'Speech interpretation review reason missing'); timestamp(review['recordedAt'], utc=True)
        authors = {claim['proposedBy'], p['requestedBy']} | {x['actorId'] for x in segment['corrections']}
        require(review['accepted'] is True and review['claimId'] == claim['id'] and review['claimDigest'] == claim['digest'] and review['reviewerId'] not in authors, 'Independent accepted speech interpretation required')
        require(finding['text'] == claim['text'] and finding['reviewer'] == review['reviewerName'] and finding['reviewedAt'] == review['recordedAt'], 'Speech finding differs from reviewed interpretation')
        at = lambda v: datetime.fromisoformat(v.replace('Z', '+00:00'))
        require(at(correspondence['recordedAt']) <= at(p['exportedAt']) <= at(claim['proposedAt']) <= at(review['recordedAt']), 'Speech interpretation chronology differs')
        identity = {k: source[k] for k in ('sha256', 'filename', 'sourceTime', 'receivedTime', 'policy')}; identity['contentBase64'] = p['source']['originalBase64']
        require(source['id'] not in evidence or same(identity, evidence[source['id']]), 'Conflicting speech original identity')
        evidence[source['id']] = identity
    require(len(tenants) <= 1, 'Mixed tenant speech lineage')
    return len(values)
