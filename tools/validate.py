from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path

from tools.lib.contracts import Issue, load_manifest, validate_document
from tools.lib.jsonio import load_json
from tools.lib.privacy import (
    scan_json,
    scan_release_name,
    scan_release_tree,
    scan_site_tree,
)


def validate_repository(repo_root: Path) -> list[Issue]:
    manifest = load_manifest(repo_root)
    entries = manifest.get("datasets")
    if not isinstance(entries, Mapping):
        return [
            Issue(
                "schema/manifest.json",
                "invalid_manifest",
                "datasets are not configured",
            )
        ]

    issues: list[Issue] = []
    data_root = repo_root / "data"
    if data_root.exists() or data_root.is_symlink():
        release_issues = scan_release_tree(data_root)
        issues.extend(release_issues)
        if any(issue.code == "symlink" for issue in release_issues):
            return issues
    records: dict[str, list[Mapping]] = {dataset: [] for dataset in entries}
    for dataset in sorted(entries):
        entry = entries[dataset]
        if not isinstance(entry, Mapping):
            issues.append(Issue(dataset, "invalid_manifest", "dataset entry is invalid"))
            continue
        paths = _dataset_paths(repo_root, entry)
        if not paths:
            issues.append(Issue(dataset, "missing_document", "canonical dataset is missing"))
            continue
        for path in paths:
            relative = _relative_display(path, repo_root)
            try:
                document = load_json(path)
            except (OSError, ValueError, json.JSONDecodeError):
                issues.append(Issue(relative, "invalid_json", "canonical JSON is invalid"))
                continue
            for issue in validate_document(dataset, document, repo_root):
                issues.append(Issue(f"{relative}:{issue.path}", issue.code, issue.message))
            document_records = document.get("records")
            if isinstance(document_records, list):
                records[dataset].extend(
                    record for record in document_records if isinstance(record, Mapping)
                )
    issues.extend(validate_references(records))
    return issues


def validate_references(datasets: Mapping[str, list[Mapping]]) -> list[Issue]:
    issues: list[Issue] = []
    sources = _ids(datasets, "sources", "source_id")
    models = _ids(datasets, "models", "model_id")
    architectures = _ids(datasets, "architectures", "architecture_id")
    devices = _ids(datasets, "devices", "device_id")
    systems = _ids(datasets, "systems", "system_id")
    runtimes = _ids(datasets, "runtimes", "runtime_id")
    runs = _ids(datasets, "runs", "run_id")
    operators = _ids(datasets, "operators", "operator_id")
    artifacts = {
        (record.get("model_id"), artifact.get("artifact_id"))
        for record in datasets.get("models", [])
        for artifact in _mapping_list(record.get("artifacts"))
    }

    for index, record in enumerate(datasets.get("models", [])):
        _check(
            issues,
            f"$.models[{index}].architecture_id",
            record.get("architecture_id"),
            architectures,
        )
        _check_many(
            issues,
            f"$.models[{index}].source_ids",
            record.get("source_ids"),
            sources,
        )
    for index, record in enumerate(datasets.get("architectures", [])):
        base = f"$.architectures[{index}]"
        _check(issues, f"{base}.model_id", record.get("model_id"), models)
        _check_many(issues, f"{base}.source_ids", record.get("source_ids"), sources)
        node_ids = {
            node.get("node_id") for node in _mapping_list(record.get("nodes"))
            if isinstance(node.get("node_id"), str)
        }
        for edge_index, edge in enumerate(_mapping_list(record.get("edges"))):
            _check(issues, f"{base}.edges[{edge_index}].source", edge.get("source"), node_ids)
            _check(issues, f"{base}.edges[{edge_index}].target", edge.get("target"), node_ids)
    for index, record in enumerate(datasets.get("systems", [])):
        _check_many(
            issues,
            f"$.systems[{index}].device_ids",
            record.get("device_ids"),
            devices,
        )
    for index, record in enumerate(datasets.get("runtimes", [])):
        base = f"$.runtimes[{index}]"
        _check_many(issues, f"{base}.source_ids", record.get("source_ids"), sources)
        for child_index, feature in enumerate(_mapping_list(record.get("features"))):
            _check(
                issues,
                f"{base}.features[{child_index}].source_id",
                feature.get("source_id"),
                sources,
            )
        for child_index, support in enumerate(_mapping_list(record.get("model_support"))):
            child = f"{base}.model_support[{child_index}]"
            _check(issues, f"{child}.model_id", support.get("model_id"), models)
            _check(issues, f"{child}.source_id", support.get("source_id"), sources)
    for index, record in enumerate(datasets.get("runs", [])):
        base = f"$.runs[{index}]"
        model_id = record.get("model_id")
        _check(issues, f"{base}.model_id", model_id, models)
        artifact = record.get("model_artifact_id")
        if isinstance(artifact, str) and (model_id, artifact) not in artifacts:
            issues.append(_broken(f"{base}.model_artifact_id"))
        _check(issues, f"{base}.runtime_id", record.get("runtime_id"), runtimes)
        _check(issues, f"{base}.device_id", record.get("device_id"), devices)
        if record.get("system_id") is not None:
            _check(issues, f"{base}.system_id", record.get("system_id"), systems)
        _check(issues, f"{base}.source_id", record.get("source_id"), sources)
    for dataset in ("end_to_end", "stages", "operators"):
        for index, record in enumerate(datasets.get(dataset, [])):
            base = f"$.{dataset}[{index}]"
            _check(issues, f"{base}.run_id", record.get("run_id"), runs)
            _check(issues, f"{base}.source_id", record.get("source_id"), sources)
    for index, record in enumerate(datasets.get("rooflines", [])):
        base = f"$.rooflines[{index}]"
        _check(issues, f"{base}.run_id", record.get("run_id"), runs)
        _check(issues, f"{base}.operator_id", record.get("operator_id"), operators)
        _check(issues, f"{base}.device_id", record.get("device_id"), devices)
        _check(issues, f"{base}.source_id", record.get("source_id"), sources)
    return issues


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate Atlas release data")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--all", action="store_true", help="validate canonical data and generated site")
    mode.add_argument("--staged", action="store_true", help="validate staged release-boundary files")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    repo_root = Path.cwd()
    issues = validate_repository(repo_root) if args.all else validate_staged(repo_root)
    site_root = repo_root / "site"
    if args.all and (site_root.exists() or site_root.is_symlink()):
        issues.extend(scan_site_tree(site_root))
    for issue in issues:
        print(format_issue(issue), file=sys.stderr)
    return 1 if issues else 0


def validate_staged(repo_root: Path) -> list[Issue]:
    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "-z"],
        cwd=repo_root,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    if result.returncode != 0:
        return [Issue("git", "staged_read", "unable to inspect staged file names")]
    names = [os.fsdecode(name) for name in result.stdout.split(b"\0") if name]
    modes = _staged_modes(repo_root, names)
    issues: list[Issue] = []
    for name in names:
        if name not in modes:
            continue
        path = Path(name)
        issues.extend(scan_release_name(path, symlink=modes.get(name) == "120000"))
        if not path.parts or path.parts[0] not in {"data", "site"}:
            continue
        payload = _staged_content(repo_root, name)
        if payload is None:
            continue
        display = _display_name(name)
        try:
            text = payload.decode("utf-8")
        except UnicodeDecodeError:
            continue
        if path.suffix.lower() == ".json":
            try:
                value = json.loads(text)
            except json.JSONDecodeError:
                issues.append(
                    Issue(display, "invalid_json", "staged release JSON is malformed")
                )
            else:
                issues.extend(scan_json(value, display))
        else:
            issues.extend(scan_json(text, display))
    return issues


def format_issue(issue: Issue) -> str:
    return f"{issue.path}: {issue.code}: {issue.message}"


def _dataset_paths(repo_root: Path, entry: Mapping) -> list[Path]:
    data = entry.get("data")
    if isinstance(data, str):
        path = repo_root / data
        return [path] if path.is_file() else []
    data_glob = entry.get("data_glob")
    if isinstance(data_glob, str):
        return sorted(path for path in repo_root.glob(data_glob) if path.is_file())
    return []


def _ids(datasets: Mapping[str, list[Mapping]], dataset: str, field: str) -> set[str]:
    return {
        value for record in datasets.get(dataset, [])
        if isinstance((value := record.get(field)), str)
    }


def _mapping_list(value: object) -> list[Mapping]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, Mapping)]


def _check(issues: list[Issue], path: str, value: object, targets: set[object]) -> None:
    if isinstance(value, str) and value not in targets:
        issues.append(_broken(path))


def _check_many(
    issues: list[Issue], path: str, values: object, targets: set[object]
) -> None:
    if isinstance(values, list):
        for index, value in enumerate(values):
            _check(issues, f"{path}[{index}]", value, targets)


def _broken(path: str) -> Issue:
    return Issue(path, "broken_reference", "reference does not resolve")


def _relative_display(path: Path, repo_root: Path) -> str:
    return _display_name(path.relative_to(repo_root).as_posix())


def _display_name(name: str) -> str:
    return name.encode("unicode_escape").decode("ascii")


def _staged_modes(repo_root: Path, names: list[str]) -> dict[str, str]:
    if not names:
        return {}
    result = subprocess.run(
        ["git", "ls-files", "--stage", "-z", "--", *names],
        cwd=repo_root,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    modes: dict[str, str] = {}
    for entry in result.stdout.split(b"\0"):
        if b"\t" not in entry:
            continue
        metadata, raw_name = entry.split(b"\t", 1)
        modes[os.fsdecode(raw_name)] = metadata.split(maxsplit=1)[0].decode("ascii")
    return modes


def _staged_content(repo_root: Path, name: str) -> bytes | None:
    result = subprocess.run(
        ["git", "show", f":{name}"],
        cwd=repo_root,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    return result.stdout if result.returncode == 0 else None


if __name__ == "__main__":
    raise SystemExit(main())
