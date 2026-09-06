"""Archive superseded evidence and retain one verified analysis sample per case.

Default is a fully validated dry run. --apply backs up exact original bytes before
writing; raw reports are never touched. The backup manifest records retained IDs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from tools.lib.contracts import load_manifest
from tools.lib.representative_data import select_representative_data
from tools.validate import validate_repository


def _hash(content):
    return hashlib.sha256(content).hexdigest()


def _encode(value, *, pretty=False):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
        indent=2 if pretty else None, separators=None if pretty else (',', ':')) + '\n').encode()


def make_plan(root, documents, selection):
    changes = []
    for relative, content in sorted(documents.items()):
        path = Path(relative)
        if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != 'data':
            raise ValueError('archive changes must remain under canonical data/')
        original = (root / path).read_bytes()
        if original != content:
            changes.append({'path': relative, 'before_sha256': _hash(original),
                'after_sha256': _hash(content), 'before_bytes': len(original),
                'after_bytes': len(content), 'content': content})
    return {'selection': selection, 'changes': changes}


def public_plan(plan):
    return {'selection': plan['selection'], 'changes': [
        {key: value for key, value in change.items() if key != 'content'}
        for change in plan['changes']]}


def _atomic(path, content):
    descriptor, temporary = tempfile.mkstemp(prefix=f'.{path.name}.', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


def apply_archive(root, plan):
    for change in plan['changes']:
        if _hash((root / change['path']).read_bytes()) != change['before_sha256']:
            raise ValueError(f"{change['path']} changed since archive planning")
    parent = root / '.local/archive'
    parent.mkdir(parents=True, exist_ok=True)
    archive = Path(tempfile.mkdtemp(prefix=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-'), dir=parent))
    for change in plan['changes']:
        destination = archive / change['path']
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / change['path'], destination)
        if _hash(destination.read_bytes()) != change['before_sha256']:
            raise ValueError('archive backup hash mismatch; canonical untouched')
    (archive / 'manifest.json').write_bytes(_encode(public_plan(plan), pretty=True))
    written = []
    try:
        for change in plan['changes']:
            path = root / change['path']
            if _hash(path.read_bytes()) != change['before_sha256']:
                raise ValueError(f"{change['path']} changed since archive planning")
            _atomic(path, change['content'])
            written.append(change['path'])
    except BaseException:
        for relative in reversed(written): _atomic(root / relative, (archive / relative).read_bytes())
        raise
    return archive


def prepare_archive(root):
    entries = load_manifest(root)['datasets']
    datasets, documents = {}, {}
    for name, entry in entries.items():
        paths = [root / entry['data']] if 'data' in entry else sorted(root.glob(entry['data_glob']))
        records = []
        for path in paths:
            document = json.loads(path.read_text())
            documents[path.relative_to(root).as_posix()] = (name, document)
            records.extend(document['records'])
        datasets[name] = sorted(records, key=lambda r:r[entry['primary_key']])
    selected, report = select_representative_data(datasets)
    report['counts'] = {name: {'before': len(datasets[name]), 'after': len(selected[name])} for name in datasets}
    report['snapshot_bytes'] = {'before': len(_encode({'format_version': '1.0.0', 'datasets': datasets})),
        'after': len(_encode({'format_version': '1.0.0', 'datasets': selected}))}
    output = {}
    for relative, (name, document) in documents.items():
        key = entries[name]['primary_key']
        replacements = {r[key]: r for r in selected[name]}
        records = [replacements[r[key]] for r in document['records'] if r[key] in replacements]
        if records != document['records']:
            output[relative] = _encode({**document, 'records': records}, pretty=True)
    plan = make_plan(root, output, report)
    # Validate the exact candidate repository with the normal validators. This
    # covers references, schemas, privacy, profiler semantics and formula checks.
    with tempfile.TemporaryDirectory(prefix='atlas-archive-') as temporary:
        candidate = Path(temporary)
        shutil.copytree(root / 'schema', candidate / 'schema')
        (candidate / 'data').mkdir()
        for relative in documents:
            destination = candidate / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            if relative in output: destination.write_bytes(output[relative])
            else: shutil.copy2(root / relative, destination)
        issues = validate_repository(candidate)
        if issues:
            raise ValueError('\n'.join(f'{i.path}: {i.code}: {i.message}' for i in issues))
    return plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    plan = prepare_archive(args.root.resolve())
    print(json.dumps(public_plan(plan), ensure_ascii=False, indent=2))
    if args.apply:
        print(f'Archive: {apply_archive(args.root.resolve(), plan)}')


if __name__ == '__main__':
    main()
