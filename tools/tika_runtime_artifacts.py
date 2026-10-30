#!/usr/bin/env python3
"""Acquire and statically inspect a reduced exact-pin Tika research classpath. Never execute JARs."""
import argparse
from collections import deque
import hashlib
import io
import json
from pathlib import Path
import re
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PIN = 'f45b9498f35d55445af28737407586362b2e37fc'
ORIGIN = 'https://repo.maven.apache.org/maven2/'
NS = {'p': 'http://maven.apache.org/POM/4.0.0'}
MODULES = ['tika-annotation-processor', 'tika-core', 'tika-parsers/tika-parsers-standard/tika-parsers-standard-modules/tika-parser-xmp-commons', 'tika-parsers/tika-parsers-standard/tika-parsers-standard-modules/tika-parser-pdf-module']
MAX_FILE = 64 * 1024 * 1024
MAX_TOTAL = 256 * 1024 * 1024


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def coordinates(group, artifact, version):
    for value in [group, artifact, version]:
        require(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.+-]{0,150}', value) and '..' not in value, 'Unsafe Maven coordinate')
    return group, artifact, version


def relative(coords, suffix):
    group, artifact, version = coordinates(*coords)
    require(suffix in ('.pom', '.jar', '-sources.jar'), 'Unexpected artifact type')
    return group.replace('.', '/') + '/' + artifact + '/' + version + '/' + artifact + '-' + version + suffix


def xml(data):
    require(len(data) <= 1024 * 1024 and b'<!DOCTYPE' not in data.upper() and b'<!ENTITY' not in data.upper(), 'Unsafe or oversized POM')
    root = ET.fromstring(data)
    if root.tag == 'project':
        for element in root.iter():
            require('}' not in element.tag, 'Mixed POM namespaces')
            element.tag = '{' + NS['p'] + '}' + element.tag
    require(root.tag == '{' + NS['p'] + '}project' and (root.findtext('p:modelVersion', namespaces=NS) or '').strip() == '4.0.0', 'Unexpected POM root/version')
    return root


def expand(value, properties):
    require(isinstance(value, str), 'Missing Maven value')
    for _ in range(20):
        if '${' not in value:
            return value
        value = re.sub(r'\$\{([^}]+)\}', lambda m: properties.get(m[1], m[0]), value)
    raise ValueError('Unresolved Maven property: ' + value)


def text(root, name):
    value = root.findtext('p:' + name, namespaces=NS)
    return value.strip() if value is not None else None


def dependency(element):
    return {name: text(element, name) for name in ['groupId', 'artifactId', 'version', 'scope', 'optional', 'type', 'classifier']} | {'exclusions': [(text(e, 'groupId'), text(e, 'artifactId')) for e in element.findall('p:exclusions/p:exclusion', NS)]}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise ValueError('Maven artifact redirect refused')


class Inventory:
    def __init__(self, cache, *, offline=False):
        self.cache = cache
        self.offline = offline
        self.files = {}
        self.models = {}
        self.visiting = set()
        self.bytes = 0
        self.opener = urllib.request.build_opener(NoRedirect)

    def artifact(self, coords, suffix):
        name = relative(coords, suffix)
        path = self.cache / name
        require(not any(p.is_symlink() for p in [self.cache, path, *path.parents]), 'Symlink in artifact cache')
        limit = 1024 * 1024 if suffix == '.pom' else MAX_FILE
        if path.exists():
            require(path.is_file() and path.stat().st_size <= limit, 'Cached artifact is oversized or irregular')
            data = path.read_bytes()
        else:
            require(not self.offline, 'Artifact absent in offline cache: ' + name)
            start = time.monotonic()
            with self.opener.open(ORIGIN + name, timeout=30) as response:
                require(response.status == 200 and response.url == ORIGIN + name, 'Unexpected artifact response')
                chunks, size = [], 0
                while True:
                    chunk = response.read(min(65536, limit - size + 1))
                    if not chunk:
                        break
                    chunks.append(chunk)
                    size += len(chunk)
                    require(size <= limit and time.monotonic() - start <= 90, 'Artifact size/deadline limit')
                data = b''.join(chunks)
            require(data, 'Empty artifact')
            require(self.bytes + len(data) <= MAX_TOTAL and len(self.files) < 180, 'Classpath acquisition budget exceeded')
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        if name not in self.files:
            self.bytes += len(data)
            require(self.bytes <= MAX_TOTAL and len(self.files) < 180, 'Classpath acquisition budget exceeded')
            self.files[name] = {'path': name, 'bytes': len(data), 'sha256': sha(data)}
        return data

    def model(self, coords):
        coords = coordinates(*coords)
        if coords in self.models:
            return self.models[coords]
        require(coords not in self.visiting and len(self.visiting) < 15 and len(self.models) < 100, 'POM parent/import recursion limit')
        self.visiting.add(coords)
        result = self.effective(xml(self.artifact(coords, '.pom')), coords)
        self.visiting.remove(coords)
        self.models[coords] = result
        return result

    def effective(self, root, coords, parent=None):
        p = root.find('p:parent', NS)
        if parent is None and p is not None:
            parent = self.model((text(p, 'groupId'), text(p, 'artifactId'), text(p, 'version')))
        parent = parent or {'properties': {}, 'managed': {}, 'dependencies': [], 'imports': [], 'coords': ('', '', ''), 'declaredLicences': []}
        props = dict(parent['properties'])
        declared = root.find('p:properties', NS)
        if declared is not None:
            props.update({e.tag.split('}')[-1]: e.text or '' for e in declared})
        for name, value in zip(['groupId', 'artifactId', 'version'], coords):
            props['project.' + name] = value
            props['pom.' + name] = value
        for name, value in zip(['groupId', 'artifactId', 'version'], parent['coords']):
            props['project.parent.' + name] = value
        managed, imports = dict(parent['managed']), list(parent['imports'])
        for element in root.findall('p:dependencyManagement/p:dependencies/p:dependency', NS):
            d = dependency(element)
            key = expand(d['groupId'], props), expand(d['artifactId'], props)
            if d['scope'] == 'import':
                imports.append((*key, expand(d['version'], props)))
            else:
                managed[key] = (d, props.copy())
        deps = {(expand(d['groupId'], origin), expand(d['artifactId'], origin)): (d, origin) for d, origin in parent['dependencies']}
        for element in root.findall('p:dependencies/p:dependency', NS):
            d = dependency(element)
            deps[(expand(d['groupId'], props), expand(d['artifactId'], props))] = d, props.copy()
        profiles = [text(p, 'id') for p in root.findall('p:profiles/p:profile', NS) if p.findall('p:dependencies/p:dependency', NS)]
        return {'coords': coords, 'properties': props, 'managed': managed, 'imports': imports, 'dependencies': list(deps.values()), 'dependencyProfiles': profiles, 'declaredLicences': [{'name': text(e, 'name'), 'url': text(e, 'url')} for e in root.findall('p:licenses/p:license', NS)] or parent['declaredLicences']}

    def managed_version(self, key, model, seen=frozenset()):
        require(model['coords'] not in seen and len(seen) < 15, 'BOM import cycle/depth limit')
        seen = seen | {model['coords']}
        if key in model['managed']:
            d, props = model['managed'][key]
            return expand(d['version'], props)
        # Import only the BOM supplying a requested key, bounded by model limits.
        for coords in model['imports']:
            if coords[0] == 'org.bouncycastle' and key[0] != 'org.bouncycastle':
                continue
            if coords[0] != key[0] and not (coords[0] == 'com.fasterxml.jackson' and key[0].startswith('com.fasterxml.jackson')):
                continue
            value = self.managed_version(key, self.model(coords), seen)
            if value:
                return value
        return None


def inspect_jar(data):
    notices, native, count, expanded = [], [], 0, 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = set()
        for entry in archive.infolist():
            name = entry.filename
            require(name not in names and not name.startswith('/') and '\\' not in name and all(part not in ('', '.', '..') for part in name.rstrip('/').split('/')), 'Unsafe or duplicate JAR entry')
            names.add(name)
            expanded += entry.file_size
            count += 1
            require(expanded <= 192 * 1024 * 1024 and count <= 30000 and not entry.flag_bits & 1, 'JAR expansion/entry/encryption bound')
            if name.lower().endswith(('.so', '.dll', '.exe', '.dylib')):
                native.append(name)
            if re.fullmatch(r'(license|licence|notice|copyright)(\.(txt|md|html))?', name.lower().split('/')[-1]):
                require(entry.file_size <= 1024 * 1024 and len(notices) < 100, 'Notice bound')
                value = archive.read(entry)
                notices.append({'path': name, 'bytes': len(value), 'sha256': sha(value)})
    require(not native, 'Unexpected native payload in reduced Java classpath')
    return {'entries': count, 'expandedBytes': expanded, 'notices': notices, 'nativePayloads': native}


def discover(source, cache, *, offline=False):
    import subprocess
    actual = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    require(actual == PIN and not subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain']), 'Exact clean Tika source pin required')
    inventory = Inventory(cache, offline=offline)
    parent_root = xml((source / 'tika-parent/pom.xml').read_bytes())
    props = {e.tag.split('}')[-1]: e.text for e in parent_root.find('p:properties', NS)}
    root_model = inventory.effective(parent_root, ('org.apache.tika', 'tika-parent', props['revision']))
    source_models = {'tika-parent/pom.xml': root_model}
    source_files = {}

    def local_model(path):
        if path in source_models:
            return source_models[path]
        raw = (source / path).read_bytes()
        r = xml(raw)
        p = r.find('p:parent', NS)
        parent_path = str((Path(path).parent / text(p, 'relativePath')).as_posix())
        import posixpath
        parent_path = posixpath.normpath(parent_path)
        require(not parent_path.startswith('../'), 'Source POM parent escaped checkout')
        model = inventory.effective(r, ('org.apache.tika', text(r, 'artifactId'), props['revision']), local_model(parent_path))
        source_models[path] = model
        return model

    queue = deque()
    for module in MODULES:
        model = local_model(module + '/pom.xml')
        for d, origin in model['dependencies']:
            if d['scope'] == 'test' or expand(d['groupId'], origin) == 'org.apache.tika':
                continue
            queue.append((d, origin, model, frozenset(), True, module))
    chosen, edges = {}, []
    while queue:
        require(len(edges) < 300 and len(chosen) < 40, 'Dependency graph bound')
        d, origin, model, excluded, direct, requester = queue.popleft()
        key = expand(d['groupId'], origin), expand(d['artifactId'], origin)
        if key in excluded or d['scope'] in ['test', 'system', 'import'] or not direct and (d['scope'] == 'provided' or d['optional'] == 'true'):
            continue
        require(d['type'] in (None, 'jar') and d['classifier'] is None, 'Unsupported dependency variant')
        version = inventory.managed_version(key, root_model) or (expand(d['version'], origin) if d['version'] else inventory.managed_version(key, model))
        coords = coordinates(*key, version)
        edges.append({'requester': requester, 'requested': ':'.join(coords), 'scope': d['scope'] or 'compile', 'direct': direct})
        if key in chosen:
            edges[-1]['selected'] = ':'.join(chosen[key])
            continue
        chosen[key] = coords
        child = inventory.model(coords)
        omit = excluded | frozenset((expand(g, origin), expand(a, origin)) for g, a in d['exclusions'])
        for entry, child_origin in child['dependencies']:
            queue.append((entry, child_origin, child, omit, False, ':'.join(coords)))
    artifacts = []
    for coords in sorted(chosen.values()):
        model = inventory.model(coords)
        jar = inventory.artifact(coords, '.jar')
        sources = inventory.artifact(coords, '-sources.jar')
        artifacts.append({'coordinates': ':'.join(coords), 'jar': relative(coords, '.jar'), 'sources': relative(coords, '-sources.jar'), 'declaredLicences': model['declaredLicences'], 'dependencyProfilesNotEvaluated': model['dependencyProfiles'], 'jarInspection': inspect_jar(jar), 'sourceInspection': inspect_jar(sources)})
    for name in ['LICENSE.txt', 'NOTICE.txt', *source_models]:
        raw = (source / name).read_bytes()
        source_files[name] = {'bytes': len(raw), 'sha256': sha(raw)}
    return {'format': 'inveos.tika_research_artifacts.v1', 'sourceRevision': PIN, 'origin': ORIGIN, 'modules': MODULES, 'sourceInputs': source_files, 'files': sorted(inventory.files.values(), key=lambda f: f['path']), 'artifacts': artifacts, 'dependencyEdges': edges, 'limitations': ['Research acquisition/static audit only; no parser executed or build/runtime/quality/licence approval.', 'Compile/runtime main-POM dependencies only; test/optional transitive/provided transitive and profiles are not activated. Inspect recorded profiles against the explicit reduced Java runner before qualification.', 'Official HTTPS discovery and locally pinned hashes are not publisher signature authentication.']}


def records(lock):
    require(isinstance(lock, dict) and lock.get('format') == 'inveos.tika_research_artifacts.v1' and lock.get('sourceRevision') == PIN and lock.get('origin') == ORIGIN and lock.get('modules') == MODULES, 'Unknown inventory')
    require(isinstance(lock.get('files'), list) and 1 <= len(lock['files']) <= 180, 'File count bound')
    paths, total = {}, 0
    for row in lock['files']:
        require(isinstance(row, dict) and set(row) == {'path', 'bytes', 'sha256'}, 'Invalid file record')
        path = row['path']
        require(isinstance(path, str) and path not in paths and re.fullmatch(r'[A-Za-z0-9_./+-]+', path) and not path.startswith('/') and '..' not in path and type(row['bytes']) is int and 0 < row['bytes'] <= MAX_FILE and isinstance(row['sha256'], str) and re.fullmatch('[a-f0-9]{64}', row['sha256']), 'Invalid artifact record')
        parts = path.split('/')
        require(len(parts) >= 4, 'Invalid Maven artifact path')
        coords = coordinates('.'.join(parts[:-3]), parts[-3], parts[-2])
        suffixes = [s for s in ('.pom', '.jar', '-sources.jar') if relative(coords, s) == path]
        require(len(suffixes) == 1 and (suffixes[0] != '.pom' or row['bytes'] <= 1024 * 1024), 'Unexpected artifact filename/size')
        paths[path] = row
        total += row['bytes']
        require(total <= MAX_TOTAL, 'Artifact total bound')
    require(isinstance(lock.get('artifacts'), list) and 1 <= len(lock['artifacts']) <= 40, 'Classpath count bound')
    chosen = set()
    for artifact in lock['artifacts']:
        require(isinstance(artifact, dict) and isinstance(artifact.get('coordinates'), str), 'Invalid classpath entry')
        parts = artifact['coordinates'].split(':')
        require(len(parts) == 3, 'Invalid classpath coordinate')
        coords = coordinates(*parts)
        require(coords[:2] not in chosen, 'Duplicate classpath coordinate')
        chosen.add(coords[:2])
        for key, suffix in [('jar', '.jar'), ('sources', '-sources.jar')]:
            require(artifact.get(key) == relative(coords, suffix) and artifact[key] in paths, 'Classpath file missing or mismatched')
        require(relative(coords, '.pom') in paths, 'Classpath POM missing')
    jar_paths = {p for p in paths if p.endswith('.jar')}
    require(jar_paths == {a[k] for a in lock['artifacts'] for k in ('jar', 'sources')}, 'Unaccounted runtime artifact')
    return paths, total


def fetch(lock, cache):
    paths, _ = records(lock)
    inventory = Inventory(cache)
    for path, row in paths.items():
        parts = path.split('/')
        coords = ('.'.join(parts[:-3]), parts[-3], parts[-2])
        suffix = next(s for s in ('.pom', '.jar', '-sources.jar') if relative(coords, s) == path)
        data = inventory.artifact(coords, suffix)
        require(len(data) == row['bytes'] and sha(data) == row['sha256'], 'Acquired artifact differs from reviewed lock')


def verify(lock, cache, source=None):
    paths, total = records(lock)
    for path, row in paths.items():
        file = cache / path
        require(not any(p.is_symlink() for p in [file, cache, *file.parents]) and file.is_file() and file.stat().st_size == row['bytes'], 'Artifact size/path mismatch')
        require(sha(file.read_bytes()) == row['sha256'], 'Artifact byte/hash mismatch')
    for artifact in lock['artifacts']:
        for key, inspection in [('jar', 'jarInspection'), ('sources', 'sourceInspection')]:
            require(inspect_jar((cache / artifact[key]).read_bytes()) == artifact.get(inspection), 'Artifact payload/notice inspection differs')
    if source is not None:
        require(discover(source, cache, offline=True) == lock, 'Offline source/POM graph replay differs from lock')
    return {'filesVerified': len(paths), 'bytesVerified': total, 'jarPairsVerified': len(lock['artifacts']), 'sourceGraphReplayed': source is not None, 'runtimeExecuted': False, 'licenceApproved': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--cache', type=Path, default=ROOT / '.research-cache/tika-runtime')
    parser.add_argument('--lock', type=Path, required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--discover', action='store_true')
    mode.add_argument('--fetch', action='store_true')
    args = parser.parse_args()
    if args.discover:
        require(args.source is not None, 'Exact source checkout required')
        require(not args.lock.exists(), 'Discovery never replaces an existing lock')
        lock = discover(args.source.resolve(), args.cache.resolve())
        args.lock.parent.mkdir(parents=True, exist_ok=True)
        args.lock.write_text(json.dumps(lock, indent=2) + '\n')
    else:
        lock = json.loads(args.lock.read_text())
    if args.fetch:
        fetch(lock, args.cache.resolve())
    print(json.dumps(verify(lock, args.cache.resolve(), args.source.resolve() if args.source else None), indent=2))


if __name__ == '__main__':
    main()
