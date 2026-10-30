#!/usr/bin/env python3
"""Actual reduced Tika PDF research; no API integration or OCR quality inference."""
import argparse
import base64
import io
import json
from pathlib import Path
import shlex
import tarfile
import tempfile
import time
import uuid
import xml.etree.ElementTree as ET

if __package__:
    from .build_tika_research import CONFIG, IMAGE, JAVA_FLAGS, sha
    from .probe_worker_isolation import command, container_args, check_configuration, require, run_probe
    from .synthetic_pdf import digital_pdf, coverage_pdf
    from .tika_runtime_artifacts import PIN, verify
else:
    from build_tika_research import CONFIG, IMAGE, JAVA_FLAGS, sha
    from probe_worker_isolation import command, container_args, check_configuration, require, run_probe
    from synthetic_pdf import digital_pdf, coverage_pdf
    from tika_runtime_artifacts import PIN, verify

ROOT = Path(__file__).resolve().parents[1]
PHRASE = 'FICTIONAL INVEOS repeated passage'


def analyse(raw, original, expected):
    require(len(raw) <= 2 * 1024 * 1024, 'Research output bound')
    report = json.loads(raw)
    require(report['format'] == 'inveos_tika_research_probe_v1' and report['state'] == 'unreviewed_research_derivative', 'Unexpected probe format/state')
    require(report['sourceSha256'] == sha(original), 'Original identity mismatch')
    xhtml = base64.b64decode(report['xhtmlBase64'], validate=True)
    require(len(xhtml) <= 1048576 and sha(xhtml) == report['xhtmlSha256'], 'XHTML byte/hash mismatch')
    require(b'<!DOCTYPE' not in xhtml.upper() and b'<!ENTITY' not in xhtml.upper(), 'XHTML declarations prohibited')
    root = ET.fromstring(xhtml)
    ns = '{http://www.w3.org/1999/xhtml}'
    require(root.tag == ns + 'html', 'Unexpected XHTML root')
    pages = root.findall('.//' + ns + 'div[@class="page"]')
    require(len(pages) == len(expected), 'Page coverage mismatch')
    rows = []
    for number, (page, has_text) in enumerate(zip(pages, expected), 1):
        text = ' '.join(''.join(page.itertext()).split())
        require(text == (PHRASE if has_text else ''), 'Fictional page text differs')
        encoded = text.encode('utf-8')
        rows.append({'page': number, 'text': text, 'textSha256': sha(encoded), 'utf8Bytes': len(encoded), 'textPresent': bool(text), 'citation': {'startByte': 0, 'endByte': len(encoded), 'quote': text, 'offsetBasis': 'normalised extracted page text, not original PDF bytes'} if text else None})
    for key in ['parseNanos', 'processCpuNanos', 'peakRssKiB']:
        require(type(report[key]) is int and report[key] >= 0, 'Missing actual resource measurement')
    require(report['peakRssKiB'] > 0, 'Linux peak RSS not observed')
    return {'sourceSha256': report['sourceSha256'], 'xhtmlSha256': sha(xhtml), 'pages': rows,
            'allPagesHaveText': all(row['textPresent'] for row in rows),
            'metadata': report['metadata'], 'metrics': {k: report[k] for k in ['parseNanos', 'processCpuNanos', 'peakRssKiB']}}, xhtml


def experiment(source, cache, built, output):
    lock_bytes = (ROOT / 'research/runtime_artifacts/tika-research-artifacts.json').read_bytes()
    lock = json.loads(lock_bytes)
    verify(lock, cache, source)
    build = json.loads((built / 'build-receipt.json').read_bytes())
    jar = (built / 'reduced-tika.jar').read_bytes()
    require(build['format'] == 'inveos.tika_research_build.v1' and build['image'] == IMAGE and build['imageId'] == CONFIG and build['sourceRevision'] == PIN and build['runtimeLockSha256'] == sha(lock_bytes) and build['wrapperSha256'] == sha((ROOT / 'research/tika/TikaPdfProbe.java').read_bytes()) and build['compiledJarSha256'] == sha(jar) and build['repeatedBuildsIdentical'] is True, 'Build receipt does not match current inputs')
    qualification = run_probe(IMAGE, runtime=True)
    require(qualification['imageId'] == CONFIG, 'Unqualified JDK identity')
    info = json.loads(command('image', 'inspect', CONFIG).stdout)[0]
    volumes = info['Config'].get('Volumes') or {}
    fixtures = {'digital': (digital_pdf(), [True, True]), 'mixed': (coverage_pdf(['text', 'blank', 'raster']), [True, False, False]), 'raster': (coverage_pdf(['raster']), [False]), 'blank': (coverage_pdf(['blank']), [False]), 'malformed': (b'%PDF-1.4\nFICTIONAL malformed\n', None), 'signature': (b'FICTIONAL not a PDF', None), 'oversize': (digital_pdf() + b' ' * 2097152, None)}
    output.mkdir(parents=True, exist_ok=True)
    reports = {}
    with tempfile.TemporaryDirectory(prefix='inveos-tika-pdf-') as directory:
        root = Path(directory)
        root.chmod(0o755)
        for label, (original, expected) in fixtures.items():
            bundle = root / (label + '.tar')
            parts = {'reduced-tika.jar': jar, 'fixture.pdf': original}
            for artifact in lock['artifacts']:
                parts['artifacts/' + Path(artifact['jar']).name] = (cache / artifact['jar']).read_bytes()
            with tarfile.open(bundle, 'w') as archive:
                for name, data in sorted(parts.items()):
                    entry = tarfile.TarInfo(name)
                    entry.size, entry.mode, entry.mtime = len(data), 0o444, 0
                    archive.addfile(entry, io.BytesIO(data))
            bundle.chmod(0o444)
            bundle_hash = sha(bundle.read_bytes())
            runs = []
            for attempt in range(2):
                name = 'inveos-tika-pdf-' + uuid.uuid4().hex
                try:
                    script = 'cd /scratch\ntar -xf /original\nexec java ' + ' '.join(map(shlex.quote, JAVA_FLAGS)) + " -cp '/scratch/reduced-tika.jar:/scratch/artifacts/*' inveos.research.TikaPdfProbe /scratch/fixture.pdf\n"
                    command(*container_args(name, CONFIG, bundle, volumes, runtime=True), script)
                    check_configuration(json.loads(command('inspect', name).stdout)[0], volumes, runtime=True)
                    started = time.monotonic()
                    result = command('start', '--attach', name, timeout=45, max_output=2 * 1024 * 1024, check=False)
                    elapsed = time.monotonic() - started
                    state = json.loads(command('inspect', name).stdout)[0]['State']
                    require(not state['OOMKilled'], 'Parser exhausted its memory limit')
                    if expected is None:
                        require(result.returncode != 0 and not result.stdout.strip(), 'Invalid input produced a success derivative')
                        runs.append({'rejected': True, 'exit': result.returncode, 'wallSeconds': elapsed, 'stderrSha256': sha(result.stderr.encode())})
                    else:
                        require(result.returncode == 0, 'Isolated Tika parse failed: ' + result.stderr[-4000:])
                        report, xhtml = analyse(result.stdout.encode(), original, expected)
                        report['metrics']['wallSeconds'] = elapsed
                        runs.append(report)
                        (output / f'{label}-{attempt + 1}.xhtml').write_bytes(xhtml)
                    require(sha(bundle.read_bytes()) == bundle_hash, 'Read-only parser input bundle changed')
                finally:
                    command('rm', '--force', name, check=False)
                    require(command('inspect', name, check=False).returncode != 0, 'Parser container cleanup failed')
            if expected is not None:
                require(runs[0]['pages'] == runs[1]['pages'], 'Repeated extracted page references differ')
            reports[label] = {'sourceSha256': sha(original), 'sourceBytes': len(original), 'runs': runs}
    receipt = {'format': 'inveos.tika_pdf_comparison.v1', 'sourceRevision': PIN, 'image': IMAGE, 'imageId': CONFIG, 'compiledJarSha256': sha(jar), 'runtimeLockSha256': sha(lock_bytes), 'qualification': qualification, 'fixtures': reports,
               'limitations': ['Actual reduced Tika/PDFBox parser, OCR explicitly disabled. Raster is a checkerboard, not an OCR accuracy corpus.', 'Page text references are reproducible on this small fictional corpus; bounding-box precision, reading order, tables, multilingual scans and long-document quality remain unqualified.', 'No source findings, human decisions, production integration, licence approval or legal conclusion follows from this research. Publisher signatures, full base-image provenance and security acceptance remain open.']}
    (output / 'tika-pdf-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return {'fixtures': len(reports), 'actualParserRuns': sum(len(v['runs']) for v in reports.values()), 'receipt': str(output / 'tika-pdf-receipt.json')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--cache', type=Path, default=ROOT / '.research-cache/tika-runtime')
    parser.add_argument('--built', type=Path, default=ROOT / '.research-cache/tika-built')
    parser.add_argument('--output', type=Path, default=ROOT / 'output/evals/tika-pdf')
    args = parser.parse_args()
    print(json.dumps(experiment(args.source.resolve(), args.cache.resolve(), args.built.resolve(), args.output.resolve()), indent=2))


if __name__ == '__main__':
    main()
