#!/usr/bin/env python3
"""Actually open/render and re-save a fictional INVEOS DOCX with LibreOffice."""
import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path
from verify_report_docx import verify


def run(*command):
    return subprocess.run(command, check=True, capture_output=True, text=True, timeout=60).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--disclosure-profile', action='store_true')
    args = parser.parse_args()
    source = Path(__file__).resolve().parents[1] / ('tests/fixtures/fictional-disclosure-report.docx' if args.disclosure_profile else 'tests/fixtures/fictional-editable-report.docx')
    original = source.read_bytes()
    checked = verify(original, hashlib.sha256(original).hexdigest(), 'a' * 64)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='inveos-docx-office-') as directory:
        root = Path(directory)
        copied = root / source.name
        copied.write_bytes(original)
        profile = '-env:UserInstallation=' + (root / 'profile').as_uri()
        version = run('libreoffice', '--version').strip()
        run('libreoffice', profile, '--headless', '--convert-to', 'pdf', '--outdir', str(output), str(copied))
        pdf = output / (source.stem + '.pdf')
        text = run('pdftotext', str(pdf), '-')
        notices = ['EDITABLE REPORT COPY', 'VERIFY DISCLOSURE APPROVAL SEPARATELY'] if args.disclosure_profile else ['EDITABLE INTERNAL COPY', 'NOT A CLIENT RELEASE']
        for phrase in [*notices, 'Fictional Paperworks', 'Ελληνικά', '日本語', 'café', '<&>', 'a' * 64]:
            if phrase not in text:
                raise ValueError('Rendered text omitted expected fictional content: ' + phrase)
        if copied.read_bytes() != original:
            raise ValueError('Opening changed the preserved original export')
        edited = root / 'edited'
        edited.mkdir()
        run('libreoffice', profile, '--headless', '--convert-to', 'docx:Office Open XML Text', '--outdir', str(edited), str(copied))
        resaved = (edited / source.name).read_bytes()
        if resaved == original:
            raise ValueError('Expected office re-save to produce a different byte representation')
        try:
            verify(resaved, checked['docxSha256'])
        except ValueError:
            pass
        else:
            raise ValueError('Office re-save incorrectly retained the trusted original fingerprint')
        run('pdftoppm', '-f', '1', '-singlefile', '-scale-to', '1300', '-png', str(pdf), str(output / 'fictional-docx-office'))
        result = {'fixture': source.name, 'profile': checked['format'], 'originalSha256': checked['docxSha256'], 'renderer': version, 'actualOfficeRender': True, 'renderedTextChecked': True, 'officeResaveChangedFingerprint': True, 'sourceBytesUnchanged': True, 'limitation': 'Text extraction is not glyph validation. Inspect the rendered page. Editor/font-specific layout and all-glyph coverage, Microsoft Word compatibility and client release are not qualified.'}
        (output / 'office-receipt.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))


if __name__ == '__main__':
    main()
