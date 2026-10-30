#!/usr/bin/env python3
"""Render fictional source-family acceptance copies with installed LibreOffice/Poppler.
Consumes artifacts emitted by research-api.test.ts and tika-report-acceptance.test.ts.
This checks office rendering/redaction, not parser execution or browser interaction.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile


def run(*command):
    return subprocess.run(command, check=True, capture_output=True, text=True, timeout=60).stdout


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifacts', type=Path)
    args = parser.parse_args()
    root = args.artifacts.resolve()
    results = []
    with tempfile.TemporaryDirectory(prefix='source-family-office-') as temp:
        profile = '-env:UserInstallation=' + Path(temp).as_uri()
        version = run('libreoffice', '--version').strip()
        families = ['rdap_domain_v1', 'supplied_webpage_v1', 'gleif_lei_v1', 'tika']
        if (root / 'tika_field').is_dir():
            families.append('tika_field')
        for family in families:
            is_tika = family.startswith('tika')
            path = root / family
            report = (json.loads(base64.b64decode(json.loads((path / 'package.json').read_text())['reportBase64']))
                      if is_tika else json.loads((path / 'report.json').read_text()))
            finding = report['tikaFindings' if is_tika else 'findings'][0]
            marker = 'FICTIONAL_TIKA_PRIVATE_INTERPRETATION' if is_tika else 'FICTIONAL_RESEARCH_PRIVATE'
            secrets = [marker, finding['source']['filename'], finding['source']['sha256']]
            if is_tika:
                secrets += [finding['reference']['id'], finding['interpretation']['claim']['id'], 'FICTIONAL_TIKA_PRIVATE_OUTLINE']
            else:
                secrets += [report['sourceUse'][0]['research']['payload']['receipt']['runId']]
            for proof in report.get('fieldProvenance', []):
                p = proof['payload']
                secrets += [proof['sha256'], p['manifestSha256'], p['manifest']['id'], p['manifest']['deviceId'], p['captureGrant']['authority']['grantId']]
            office = path / 'office'
            office.mkdir(exist_ok=True)
            for variant in ('full', 'redacted'):
                original = path / (variant + '.docx')
                before = sha(original)
                run('libreoffice', profile, '--headless', '--convert-to', 'pdf', '--outdir', str(office), str(original))
                assert sha(original) == before, 'Office changed original DOCX bytes'
                for source, label in ((path / (variant + '.pdf'), 'pdf'), (office / (variant + '.pdf'), 'docx')):
                    text = run('pdftotext', '-layout', str(source), '-')
                    compact = ''.join(text.split())
                    assert (marker in compact) == (variant == 'full'), (family, variant, label, 'finding marker')
                    if family == 'tika_field':
                        assert ('Fieldcapture' in compact) == (variant == 'full')
                        for proof in report['fieldProvenance']:
                            for field_marker in (proof['sha256'], proof['payload']['manifest']['id'], proof['payload']['captureGrant']['authority']['grantId']):
                                assert (field_marker in compact) == (variant == 'full'), (family, variant, label, 'Field provenance')
                    if variant == 'redacted':
                        assert '[REDACTED]' in text
                        for secret in secrets:
                            assert ''.join(secret.split()) not in compact, (family, label, 'redacted content retained')
                    (office / (variant + '-' + label + '.txt')).write_text(text)
                    run('pdftoppm', '-f', '1', '-singlefile', '-scale-to', '1300', '-png', str(source), str(office / (variant + '-' + label)))
                    results.append({'family': family, 'variant': variant, 'renderedFrom': label, 'pdfSha256': sha(source), 'sourceDocxSha256': before, 'textAndRedactionChecked': True})
            edited = office / 'resaved'
            edited.mkdir(exist_ok=True)
            run('libreoffice', profile, '--headless', '--convert-to', 'docx:Office Open XML Text', '--outdir', str(edited), str(path / 'full.docx'))
            assert sha(edited / 'full.docx') != sha(path / 'full.docx'), 'Office re-save unexpectedly preserved exact bytes'
            from verify_report_docx import verify
            try:
                verify((edited / 'full.docx').read_bytes(), sha(path / 'full.docx'))
            except ValueError:
                pass
            else:
                raise AssertionError('Office re-save retained trusted fingerprint')
    receipt = {'renderer': version, 'actualOfficeAndPopplerExecution': True, 'copies': results, 'officeResaveTrustedDigestRejected': True, 'actualParserExecuted': False, 'browserInteractionChecked': False, 'limitation': 'Fictional fixtures only; visually inspect pages. No native runtime, legal or production approval.'}
    (root / 'source-family-render-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt))


if __name__ == '__main__':
    main()
