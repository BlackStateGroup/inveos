"""Expand two already audited, hash-locked wheels as data; never host imports."""
import hashlib
import json
from pathlib import Path
import stat
import zipfile

ROOT=Path(__file__).resolve().parent.parent
WHEEL_INVENTORY='2b796619e4ab39da1d75f6c99d77c5a15d4453fa89bf478764ab7a608e6c7116'


def prepare_ocr_bundle(bundle):
    inventory=(ROOT/'research/runtime_artifacts/ocr-wheels.json').read_bytes()
    if hashlib.sha256(inventory).hexdigest()!=WHEEL_INVENTORY:
        raise ValueError('OCR wheel selection drift')
    records=json.loads(inventory)['artifacts']
    if {r['name'] for r in records}!={'pillow','pypdfium2'}:
        raise ValueError('Unexpected OCR wheel closure')
    runtime=Path(bundle)/'runtime'
    runtime.mkdir()
    total=0
    for record in records:
        source=ROOT/'.research-cache/docling-locked-cp312'/record['filename']
        if source.stat().st_size!=record['bytes'] or hashlib.sha256(source.read_bytes()).hexdigest()!=record['sha256']:
            raise ValueError('OCR wheel fingerprint mismatch')
        with zipfile.ZipFile(source) as archive:
            for member in archive.infolist():
                if member.is_dir():continue
                path=Path(member.filename)
                total+=member.file_size
                if path.is_absolute() or '..' in path.parts or '\\' in member.filename or '.data/' in member.filename or member.filename.endswith('.pth') or stat.S_ISLNK(member.external_attr>>16) or member.file_size>128*1024*1024 or total>256*1024*1024:
                    raise ValueError('Unsafe OCR wheel member')
                target=runtime/path
                target.parent.mkdir(parents=True,exist_ok=True)
                with target.open('xb') as stream:stream.write(archive.read(member))
                target.chmod(0o444)
    return {'wheelInventory':WHEEL_INVENTORY,'wheels':[r['filename'] for r in records]}
