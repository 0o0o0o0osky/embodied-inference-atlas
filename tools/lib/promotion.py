from __future__ import annotations

import copy
import difflib
import json
import os
import re
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from tools.lib.contracts import Issue, load_manifest, validate_document
from tools.lib.jsonio import load_json, write_json_atomic
from tools.lib.privacy import scan_json
from tools.lib.profiler import PROFILER_DATASETS, profiler_semantic_issues
from tools.lib.profiler_privacy import scan_profiler_bundle


class PromotionError(ValueError):
    def __init__(self, message: str, issues: list[Issue] | None = None):
        super().__init__(message)
        self.issues = tuple(issues or ())


@dataclass(frozen=True)
class PromotionChange:
    dataset: str
    path: Path
    document: dict[str, object]
    original: bytes | None
    safe_before: bytes


@dataclass(frozen=True)
class PromotionPlan:
    repo_root: Path
    changes: tuple[PromotionChange, ...]
    diff: str
    additions: int
    updates: int


def plan_promotion(bundle: Mapping, repo_root: Path) -> PromotionPlan:
    manifest = load_manifest(repo_root)
    datasets = manifest.get("datasets")
    if not isinstance(datasets, Mapping):
        raise PromotionError("manifest datasets are invalid")
    _validate_bundle(bundle, manifest)
    incoming_sets = bundle["datasets"]
    assert isinstance(incoming_sets, Mapping)

    unknown = sorted(set(incoming_sets) - set(datasets))
    if unknown:
        raise PromotionError(f"unknown dataset: {unknown[0]}")
    _validate_profiler_bundle(bundle, incoming_sets, datasets, repo_root, manifest)

    planned: list[PromotionChange] = []
    additions = 0
    updates = 0
    for dataset in sorted(incoming_sets):
        entry = datasets[dataset]
        incoming = incoming_sets[dataset]
        if not isinstance(entry, Mapping):
            raise PromotionError(f"dataset manifest entry is invalid: {dataset}")
        if not isinstance(incoming, list) or not all(
            isinstance(record, Mapping) for record in incoming
        ):
            raise PromotionError(f"dataset records must be objects: {dataset}")
        primary_key = entry.get("primary_key")
        if not isinstance(primary_key, str):
            raise PromotionError(f"dataset primary key is invalid: {dataset}")
        copied = [copy.deepcopy(dict(record)) for record in incoming]
        _validate_incoming_keys(copied, primary_key)

        if isinstance(entry.get("data"), str):
            path = repo_root / entry["data"]
            _ensure_safe_path(path, repo_root)
            current, original = _load_current(path, dataset, manifest)
            _validate_current_privacy(dataset, current)
            current_records = current.get("records")
            current_keys = _record_keys(current_records, primary_key)
            assert isinstance(current_records, list)
            candidate = dict(current)
            candidate["records"] = _merge_records(current_records, copied, primary_key)
            additions += sum(record[primary_key] not in current_keys for record in copied)
            updates += sum(record[primary_key] in current_keys for record in copied)
            _validate_candidate(dataset, candidate, repo_root)
            if _json_bytes(candidate) != (original or b""):
                safe_before = _json_bytes(current) if original is not None else b""
                planned.append(
                    PromotionChange(dataset, path, candidate, original, safe_before)
                )
        elif isinstance(entry.get("data_glob"), str):
            changes, added, updated = _plan_glob_dataset(
                dataset, entry["data_glob"], primary_key, copied, repo_root, manifest
            )
            planned.extend(changes)
            additions += added
            updates += updated
        else:
            raise PromotionError(f"dataset path is invalid: {dataset}")

    planned.sort(key=lambda change: change.path.as_posix())
    diff = "".join(_change_diff(change, repo_root) for change in planned)
    return PromotionPlan(repo_root, tuple(planned), diff, additions, updates)


def apply_promotion(plan: PromotionPlan) -> None:
    try:
        for change in plan.changes:
            _ensure_safe_path(change.path, plan.repo_root)
            current = change.path.read_bytes() if change.path.exists() else None
            if current != change.original:
                raise PromotionError(
                    "canonical data changed after the promotion plan was created"
                )
    except PromotionError:
        raise
    except Exception as error:
        raise PromotionError("promotion apply preflight failed") from error

    attempted: list[PromotionChange] = []
    try:
        for change in plan.changes:
            attempted.append(change)
            write_json_atomic(change.path, change.document)
    except Exception as error:
        rollback_failed = False
        for change in reversed(attempted):
            try:
                _restore_original(change)
            except Exception:
                rollback_failed = True
        message = (
            "promotion apply failed and rollback was incomplete"
            if rollback_failed
            else "promotion apply failed; canonical documents were restored"
        )
        raise PromotionError(message) from error


def _merge_records(
    current: list[dict], incoming: list[dict], primary_key: str
) -> list[dict]:
    merged = {record[primary_key]: record for record in current}
    seen: set[str] = set()
    for record in incoming:
        key = record[primary_key]
        if key in seen:
            raise PromotionError(f"duplicate incoming key: {key}")
        seen.add(key)
        merged[key] = record
    return [merged[key] for key in sorted(merged)]


def _validate_bundle(bundle: Mapping, manifest: Mapping[str, object]) -> None:
    allowed = {"bundle_version", "source_label", "datasets"}
    if set(bundle) != allowed:
        raise PromotionError(
            "bundle must contain only bundle_version, source_label, and datasets"
        )
    if bundle.get("bundle_version") != manifest.get("schema_version"):
        raise PromotionError("bundle_version does not match the repository schema")
    source_label = bundle.get("source_label")
    if not isinstance(source_label, str) or not re.fullmatch(r"[a-z0-9-]+", source_label):
        raise PromotionError("source_label must be lowercase kebab-case")
    if not isinstance(bundle.get("datasets"), Mapping):
        raise PromotionError("bundle datasets must be an object")


def _validate_incoming_keys(records: list[dict], primary_key: str) -> None:
    seen: set[str] = set()
    for record in records:
        key = record.get(primary_key)
        if not isinstance(key, str):
            raise PromotionError(f"incoming record is missing primary key: {primary_key}")
        if key in seen:
            raise PromotionError(f"duplicate incoming key: {key}")
        seen.add(key)


def _validate_profiler_bundle(
    bundle: Mapping,
    incoming_sets: Mapping,
    manifest_entries: Mapping,
    repo_root: Path,
    manifest: Mapping,
) -> None:
    combined: dict[str, list[Mapping]] = {}
    required = {
        "sources", "models", "runtimes", "devices", "systems",
        "runs", "end_to_end", "stages", "model_graphs",
        "runtime_realizations", *PROFILER_DATASETS,
    }
    for dataset in required:
        entry = manifest_entries.get(dataset)
        if not isinstance(entry, Mapping):
            combined[dataset] = []
            continue
        current: list[Mapping] = []
        data = entry.get("data")
        paths: list[Path]
        if isinstance(data, str):
            paths = [repo_root / data]
        elif isinstance(entry.get("data_glob"), str):
            paths = sorted(repo_root.glob(entry["data_glob"]))
        else:
            paths = []
        for path in paths:
            if path.is_file():
                document = load_json(path)
                records = document.get("records")
                if isinstance(records, list):
                    current.extend(record for record in records if isinstance(record, Mapping))
        incoming = incoming_sets.get(dataset, [])
        primary_key = entry.get("primary_key")
        if isinstance(incoming, list) and isinstance(primary_key, str):
            merged = {
                record.get(primary_key): copy.deepcopy(dict(record)) for record in current
                if isinstance(record.get(primary_key), str)
            }
            for record in incoming:
                if isinstance(record, Mapping) and isinstance(record.get(primary_key), str):
                    merged[record[primary_key]] = copy.deepcopy(dict(record))
            combined[dataset] = list(merged.values())
        else:
            combined[dataset] = current

    issues = scan_profiler_bundle({"datasets": combined})
    for dataset, incoming in incoming_sets.items():
        if dataset not in {*PROFILER_DATASETS, "runs"} or not isinstance(incoming, list):
            continue
        document = {
            "schema_version": manifest.get("schema_version"),
            "dataset": dataset,
            "records": incoming,
        }
        issues.extend(validate_document(dataset, document, repo_root))
    if issues:
        raise PromotionError("profiler bundle failed validation", issues)

    semantic = profiler_semantic_issues(combined)
    if semantic:
        raise PromotionError("profiler bundle failed semantic validation", semantic)


def _record_keys(records: object, primary_key: str) -> set[str]:
    if not isinstance(records, list) or not all(isinstance(record, dict) for record in records):
        raise PromotionError("canonical document records are invalid")
    keys: set[str] = set()
    for record in records:
        key = record.get(primary_key)
        if not isinstance(key, str):
            raise PromotionError(f"canonical record is missing primary key: {primary_key}")
        keys.add(key)
    return keys


def _load_current(
    path: Path, dataset: str, manifest: Mapping[str, object]
) -> tuple[dict[str, object], bytes | None]:
    if path.exists():
        original = path.read_bytes()
        try:
            current = load_json(path)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            raise PromotionError(f"canonical document is invalid: {dataset}") from error
        return current, original
    return {
        "schema_version": manifest.get("schema_version"),
        "dataset": dataset,
        "records": [],
    }, None


def _plan_glob_dataset(
    dataset: str,
    pattern: str,
    primary_key: str,
    incoming: list[dict],
    repo_root: Path,
    manifest: Mapping[str, object],
) -> tuple[list[PromotionChange], int, int]:
    if pattern.count("*") != 1:
        raise PromotionError(f"dataset glob is not promotable: {dataset}")
    prefix, suffix = pattern.split("*", 1)
    glob_parent = Path(prefix) if prefix.endswith(("/", "\\")) else Path(prefix).parent
    _ensure_safe_path(repo_root / glob_parent, repo_root)
    existing_paths: dict[str, Path] = {}
    for path in sorted(repo_root.glob(pattern)):
        _ensure_safe_path(path, repo_root)
        document = load_json(path)
        keys = _record_keys(document.get("records"), primary_key)
        for key in keys:
            if key in existing_paths:
                raise PromotionError(f"duplicate canonical key: {key}")
            existing_paths[key] = path

    grouped: dict[Path, list[dict]] = {}
    additions = 0
    updates = 0
    for record in incoming:
        key = record[primary_key]
        if key in existing_paths:
            path = existing_paths[key]
            updates += 1
        else:
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", key):
                raise PromotionError(f"primary key must be filesystem-safe: {primary_key}")
            path = repo_root / f"{prefix}{key}{suffix}"
            _ensure_safe_path(path, repo_root)
            additions += 1
        grouped.setdefault(path, []).append(record)

    changes: list[PromotionChange] = []
    for path in sorted(grouped, key=lambda item: item.as_posix()):
        current, original = _load_current(path, dataset, manifest)
        _validate_current_privacy(dataset, current)
        current_records = current.get("records")
        _record_keys(current_records, primary_key)
        assert isinstance(current_records, list)
        candidate = dict(current)
        candidate["records"] = _merge_records(current_records, grouped[path], primary_key)
        _validate_candidate(dataset, candidate, repo_root)
        if _json_bytes(candidate) != (original or b""):
            safe_before = _json_bytes(current) if original is not None else b""
            changes.append(
                PromotionChange(dataset, path, candidate, original, safe_before)
            )
    return changes, additions, updates


def _validate_candidate(
    dataset: str, candidate: Mapping[str, object], repo_root: Path
) -> None:
    issues = validate_document(dataset, candidate, repo_root)
    issues.extend(scan_json(candidate))
    if issues:
        raise PromotionError(f"promotion candidate failed validation: {dataset}", issues)


def _validate_current_privacy(dataset: str, current: Mapping[str, object]) -> None:
    issues = scan_json(current)
    if issues:
        raise PromotionError(f"canonical document failed privacy scan: {dataset}", issues)


def _json_bytes(value: object) -> bytes:
    payload = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    return payload.encode("utf-8")


def _change_diff(change: PromotionChange, repo_root: Path) -> str:
    relative = change.path.relative_to(repo_root).as_posix()
    before = change.safe_before.decode("utf-8").splitlines(keepends=True)
    after = _json_bytes(change.document).decode("utf-8").splitlines(keepends=True)
    return "".join(
        difflib.unified_diff(
            before,
            after,
            fromfile=f"a/{relative}",
            tofile=f"b/{relative}",
        )
    )


def _ensure_safe_path(path: Path, repo_root: Path) -> None:
    try:
        relative = path.relative_to(repo_root)
    except ValueError as error:
        raise PromotionError("canonical path is outside the repository") from error
    current = repo_root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise PromotionError("canonical path must not contain a symlink")
    try:
        path.resolve(strict=False).relative_to(repo_root.resolve(strict=True))
    except (OSError, ValueError) as error:
        raise PromotionError("canonical path is outside the repository") from error


def _restore_original(change: PromotionChange) -> None:
    if change.original is None:
        change.path.unlink(missing_ok=True)
        return
    with tempfile.NamedTemporaryFile("wb", dir=change.path.parent, delete=False) as handle:
        handle.write(change.original)
        temporary = Path(handle.name)
    try:
        os.replace(temporary, change.path)
    finally:
        temporary.unlink(missing_ok=True)
