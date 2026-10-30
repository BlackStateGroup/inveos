#!/usr/bin/env python3
"""Render and re-save the actual fictional API speech DOCX. No real recordings."""
import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path
from verify_report_docx import verify


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=60).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kind', choices=['speech', 'collection'], default='speech')
    kind = parser.parse_args().kind
    root = Path(__file__).resolve().parents[1] / ('output/evals/' + kind + '-office')
    original = root / ('fictional-' + kind + '.docx')
    receipt = json.loads((root / 'receipt.json').read_text())
    data = original.read_bytes()
    checked = verify(data, receipt['docxSha256'], receipt['reportSha256'])
    with tempfile.TemporaryDirectory(prefix='inveos-speech-office-') as temporary:
        profile = '-env:UserInstallation=' + (Path(temporary) / 'profile').as_uri()
        run('libreoffice', profile, '--headless', '--convert-to', 'pdf', '--outdir', str(root), str(original))
        pdf = root / ('fictional-' + kind + '.pdf')
        rendered = ' '.join(run('pdftotext', str(pdf), '-').split())
        phrases = ['SPEECH FINDING', receipt['quote'], receipt['text'], 'Original audio:'] if kind == 'speech' else ['Collection receipt:', 'Collection permission:', *receipt['requiredText']]
        for phrase in [*phrases, 'VERIFY DISCLOSURE APPROVAL SEPARATELY', 'SHA-256']:
            if ' '.join(phrase.split()) not in rendered:
                raise ValueError('Missing ' + kind + ' provenance in office rendering: ' + phrase)
        edited = root / 'resaved'
        edited.mkdir(exist_ok=True)
        run('libreoffice', profile, '--headless', '--convert-to', 'docx', '--outdir', str(edited), str(original))
        rewritten = (edited / original.name).read_bytes()
        try:
            verify(rewritten, receipt['docxSha256'], receipt['reportSha256'])
        except ValueError:
            pass
        else:
            raise ValueError('Re-saved DOCX incorrectly retained original verification')
        if original.read_bytes() != data:
            raise ValueError('Office operation changed preserved original')
        run('pdftoppm', '-f', '1', '-singlefile', '-scale-to', '1600', '-png', str(pdf), str(root / 'first-page'))
        result = {'office': run('libreoffice', '--version').strip(), 'originalDocxSha256': receipt['docxSha256'], 'pdfSha256': hashlib.sha256(pdf.read_bytes()).hexdigest(), 'sourceParagraphsVerified': checked['paragraphsMatched'], ('renderedSpeechProvenancePresent' if kind == 'speech' else 'renderedCollectionProvenancePresent'): True, 'resavedOriginalVerificationRejected': True, 'originalUnchanged': True}
        (root / 'office-receipt.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))


if __name__ == '__main__':
    main()
