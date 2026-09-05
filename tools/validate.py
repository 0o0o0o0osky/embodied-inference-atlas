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
from tools.lib.profiler import profiler_semantic_issues
from tools.lib.profiler_privacy import scan_profiler_bundle
from tools.lib.roofline import roofline_problems
from tools.lib.roofline_materialize import logical_snapshot_problems
from tools.lib.runtime_realization import runtime_realization_problems


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
    issues.extend(profiler_semantic_issues(records))
    issues.extend(scan_profiler_bundle({"datasets": records}))
    issues.extend(
        Issue(problem.path, problem.code, problem.message)
        for problem in roofline_problems(records)
    )
    issues.extend(
        Issue(problem.path, problem.code, problem.message)
        for problem in logical_snapshot_problems(records)
    )
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
    model_graphs = {
        record.get("model_graph_id"): record
        for record in datasets.get("model_graphs", [])
        if isinstance(record.get("model_graph_id"), str)
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
    for index, record in enumerate(datasets.get("model_graphs", [])):
        base = f"$.model_graphs[{index}]"
        _check(issues, f"{base}.model_id", record.get("model_id"), models)
        _check_many(issues, f"{base}.source_ids", record.get("source_ids"), sources)
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
    configurations = {
        record.get("configuration_id"): record
        for record in datasets.get("runs", [])
        if isinstance(record.get("configuration_id"), str)
    }
    runtime_records = {
        record.get("runtime_id"): record
        for record in datasets.get("runtimes", [])
        if isinstance(record.get("runtime_id"), str)
    }
    for index, record in enumerate(datasets.get("runtime_realizations", [])):
        base = f"$.runtime_realizations[{index}]"
        model_id = record.get("model_id")
        graph_id = record.get("model_graph_id")
        runtime_id = record.get("runtime_id")
        _check(issues, f"{base}.model_id", model_id, models)
        _check(issues, f"{base}.model_graph_id", graph_id, set(model_graphs))
        _check(issues, f"{base}.runtime_id", runtime_id, runtimes)
        _check_many(issues, f"{base}.device_ids", record.get("device_ids"), devices)
        for artifact_index, artifact_id in enumerate(record.get("model_artifact_ids", [])):
            if isinstance(artifact_id, str) and (model_id, artifact_id) not in artifacts:
                issues.append(_broken(f"{base}.model_artifact_ids[{artifact_index}]"))
        runtime = runtime_records.get(runtime_id)
        if isinstance(runtime, Mapping) and record.get("runtime_revision") != runtime.get("public_commit"):
            issues.append(
                Issue(
                    f"{base}.runtime_revision",
                    "revision_mismatch",
                    "realization revision must match the runtime catalog",
                )
            )
        local_problems = runtime_realization_problems(
            record, model_graphs.get(graph_id) if isinstance(graph_id, str) else None
        )
        issues.extend(
            Issue(f"{base}{problem.path[1:]}", problem.code, problem.message)
            for problem in local_problems
        )
        for evidence_index, evidence in enumerate(_mapping_list(record.get("evidence"))):
            evidence_base = f"{base}.evidence[{evidence_index}]"
            if evidence.get("source_id") is not None:
                _check(issues, f"{evidence_base}.source_id", evidence.get("source_id"), sources)
            if (
                evidence.get("kind") == "source_code"
                and isinstance(runtime, Mapping)
                and evidence.get("revision") != runtime.get("public_commit")
            ):
                issues.append(
                    Issue(
                        f"{evidence_base}.revision",
                        "revision_mismatch",
                        "source evidence revision must match the runtime catalog",
                    )
                )
            _check_many(issues, f"{evidence_base}.run_ids", evidence.get("run_ids"), runs)
        if record.get("availability") == "measured":
            artifact_ids = set(record.get("model_artifact_ids", []))
            device_ids = set(record.get("device_ids", []))
            precision_ids = {
                precision.get("precision_path_id")
                for precision in _mapping_list(record.get("precision_paths"))
            }
            configuration_ids = record.get("configuration_ids", [])
            if not artifact_ids or not configuration_ids or not device_ids:
                issues.append(
                    Issue(
                        base,
                        "measured_applicability",
                        "measured realizations require artifact, configuration, and device IDs",
                    )
                )
            for configuration_index, configuration_id in enumerate(configuration_ids):
                configuration = configurations.get(configuration_id)
                configuration_path = f"{base}.configuration_ids[{configuration_index}]"
                if configuration is None:
                    issues.append(_broken(configuration_path))
                    continue
                precision = configuration.get("precision")
                precision_id = precision.get("precision_id") if isinstance(precision, Mapping) else None
                compatible = (
                    configuration.get("model_id") == model_id
                    and configuration.get("runtime_id") == runtime_id
                    and configuration.get("model_artifact_id") in artifact_ids
                    and configuration.get("device_id") in device_ids
                    and precision_id in precision_ids
                )
                if not compatible:
                    issues.append(
                        Issue(
                            configuration_path,
                            "configuration_mismatch",
                            "configuration does not match realization applicability",
                        )
                    )
    ceiling_ids = _ids(datasets, "roofline_ceilings", "ceiling_id")
    scenario_ids = _ids(datasets, "roofline_scenarios", "scenario_id")
    basis_ids = _ids(datasets, "roofline_bases", "basis_id")
    realization_ids = _ids(datasets, "runtime_realizations", "realization_id")
    for index, record in enumerate(datasets.get("roofline_ceilings", [])):
        base = f"$.roofline_ceilings[{index}]"
        _check(issues, f"{base}.device_id", record.get("device_id"), devices)
        _check_provenance_sources(issues, base, record, sources)
    for index, record in enumerate(datasets.get("roofline_scenarios", [])):
        base = f"$.roofline_scenarios[{index}]"
        _check(issues, f"{base}.model_id", record.get("model_id"), models)
        _check_provenance_sources(issues, base, record, sources)
    for index, record in enumerate(datasets.get("roofline_bases", [])):
        base = f"$.roofline_bases[{index}]"
        _check(issues, f"{base}.scenario_id", record.get("scenario_id"), scenario_ids)
        _check(issues, f"{base}.ceiling_id", record.get("ceiling_id"), ceiling_ids)
        _check(issues, f"{base}.device_id", record.get("device_id"), devices)
        if record.get("runtime_id") is not None:
            _check(issues, f"{base}.runtime_id", record.get("runtime_id"), runtimes)
        if record.get("realization_id") is not None:
            _check(issues, f"{base}.realization_id", record.get("realization_id"), realization_ids)
        if record.get("run_id") is not None:
            _check(issues, f"{base}.run_id", record.get("run_id"), runs)
        _check_provenance_sources(issues, base, record, sources)
    for index, record in enumerate(datasets.get("roofline_points", [])):
        base = f"$.roofline_points[{index}]"
        _check(issues, f"{base}.basis_id", record.get("basis_id"), basis_ids)
        _check_provenance_sources(issues, base, record, sources)
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


def _check_provenance_sources(
    issues: list[Issue], path: str, value: object, sources: set[object]
) -> None:
    if isinstance(value, Mapping):
        provenance = value.get("provenance")
        if isinstance(provenance, Mapping):
            _check_many(issues, f"{path}.provenance.source_ids", provenance.get("source_ids"), sources)
        for key, child in value.items():
            _check_provenance_sources(issues, f"{path}.{key}", child, sources)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _check_provenance_sources(issues, f"{path}[{index}]", child, sources)


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
