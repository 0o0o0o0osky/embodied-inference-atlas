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
    removals: int = 0


def plan_promotion(bundle: Mapping, repo_root: Path) -> PromotionPlan:
    manifest = load_manifest(repo_root)
    datasets = manifest.get("datasets")
    if not isinstance(datasets, Mapping):
        raise PromotionError("manifest datasets are invalid")
    _validate_bundle(bundle, manifest)
    incoming_sets = bundle["datasets"]
    assert isinstance(incoming_sets, Mapping)
    removals = bundle.get("removals", {})

    unknown = sorted((set(incoming_sets) | set(removals)) - set(datasets))
    if unknown:
        raise PromotionError(f"unknown dataset: {unknown[0]}")
    _validate_profiler_bundle(bundle, incoming_sets, datasets, repo_root, manifest)

    planned: list[PromotionChange] = []
    additions = 0
    updates = 0
    removed = 0
    for dataset in sorted(set(incoming_sets) | set(removals)):
        entry = datasets[dataset]
        incoming = incoming_sets.get(dataset, [])
        removed_keys = set(removals.get(dataset, []))
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
        if removed_keys & {record[primary_key] for record in copied}:
            raise PromotionError(f"cannot remove and upsert the same key: {dataset}")

        if isinstance(entry.get("data"), str):
            path = repo_root / entry["data"]
            _ensure_safe_path(path, repo_root)
            current, original = _load_current(path, dataset, manifest)
            _validate_current_privacy(dataset, current)
            current_records = current.get("records")
            current_keys = _record_keys(current_records, primary_key)
            if removed_keys - current_keys:
                raise PromotionError(f"removal key does not exist: {dataset}")
            assert isinstance(current_records, list)
            current_by_key = {
                record[primary_key]: record for record in current_records
            }
            candidate = dict(current)
            candidate["records"] = _merge_records(
                [record for record in current_records if record[primary_key] not in removed_keys],
                copied, primary_key,
            )
            removed += len(removed_keys)
            additions += sum(record[primary_key] not in current_keys for record in copied)
            updates += sum(
                record[primary_key] in current_keys
                and current_by_key[record[primary_key]] != record
                for record in copied
            )
            _validate_candidate(dataset, candidate, repo_root)
            if _json_bytes(candidate) != (original or b""):
                safe_before = _json_bytes(current) if original is not None else b""
                planned.append(
                    PromotionChange(dataset, path, candidate, original, safe_before)
                )
        elif isinstance(entry.get("data_glob"), str):
            if removed_keys:
                raise PromotionError(f"removals require a single-file dataset: {dataset}")
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
    return PromotionPlan(repo_root, tuple(planned), diff, additions, updates, removed)


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
    if not allowed <= set(bundle) or set(bundle) - (allowed | {"removals"}):
        raise PromotionError(
            "bundle requires bundle_version, source_label, datasets, and optional removals"
        )
    if bundle.get("bundle_version") != manifest.get("schema_version"):
        raise PromotionError("bundle_version does not match the repository schema")
    source_label = bundle.get("source_label")
    if not isinstance(source_label, str) or not re.fullmatch(r"[a-z0-9-]+", source_label):
        raise PromotionError("source_label must be lowercase kebab-case")
    if not isinstance(bundle.get("datasets"), Mapping):
        raise PromotionError("bundle datasets must be an object")
    removals = bundle.get("removals", {})
    if not isinstance(removals, Mapping):
        raise PromotionError("bundle removals must be an object")
    for dataset, keys in removals.items():
        if not isinstance(keys, list) or not all(isinstance(key, str) and key for key in keys):
            raise PromotionError(f"removals must be explicit primary-key arrays: {dataset}")
        if len(keys) != len(set(keys)):
            raise PromotionError(f"duplicate removal key: {dataset}")
        if keys and dataset in PROFILER_DATASETS:
            raise PromotionError("profiler evidence is append-only and cannot be removed")


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
    current_sets: dict[str, list[Mapping]] = {}
    required = {
        "sources", "models", "runtimes", "devices", "systems",
        "runs", "end_to_end", "stages", "model_graphs",
        "runtime_realizations", *PROFILER_DATASETS,
    }
    if bundle.get("removals"):
        required.update(manifest_entries)
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
        current_sets[dataset] = current
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
            for key in bundle.get("removals", {}).get(dataset, []):
                previous = merged.get(key)
                if dataset == "runs" and previous and previous.get("capture_method") in {"ncu", "nsys"}:
                    raise PromotionError("profiler runs are append-only and cannot be removed")
                merged.pop(key, None)
            combined[dataset] = list(merged.values())
        else:
            combined[dataset] = current

    append_only_issues: list[Issue] = []
    incoming_captures = incoming_sets.get("profiler_captures", [])
    incoming_profiler_runs = {
        capture.get("run_id") for capture in incoming_captures
        if isinstance(capture, Mapping)
        and isinstance(capture.get("run_id"), str)
    } if isinstance(incoming_captures, list) else set()
    for dataset in (*PROFILER_DATASETS, "runs"):
        incoming = incoming_sets.get(dataset)
        entry = manifest_entries.get(dataset)
        if not isinstance(incoming, list) or not isinstance(entry, Mapping):
            continue
        primary_key = entry.get("primary_key")
        if not isinstance(primary_key, str):
            continue
        current_by_key = {
            record.get(primary_key): record
            for record in current_sets.get(dataset, [])
            if isinstance(record.get(primary_key), str)
        }
        for index, record in enumerate(incoming):
            if not isinstance(record, Mapping):
                continue
            key = record.get(primary_key)
            previous = current_by_key.get(key)
            if previous is None:
                continue
            path = f"$.datasets.{dataset}[{index}].{primary_key}"
            if dataset == "kernel_signatures":
                if dict(previous) != dict(record):
                    append_only_issues.append(Issue(
                        path,
                        "profiler_signature_drift",
                        "an existing shared kernel signature must be structurally identical",
                    ))
                continue
            profiler_evidence = (
                dataset != "runs"
                or record.get("capture_method") in {"ncu", "nsys"}
                or record.get("run_id") in incoming_profiler_runs
            )
            if profiler_evidence:
                append_only_issues.append(Issue(
                    path,
                    "profiler_evidence_overwrite",
                    "profiler run and child IDs are append-only and cannot be reused",
                ))
    if append_only_issues:
        raise PromotionError(
            "profiler bundle violates append-only evidence", append_only_issues
        )

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
    if bundle.get("removals"):
        from tools.validate import validate_references

        references = validate_references(combined)
        if references:
            raise PromotionError("removal candidate has invalid references", references)


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
        current_by_key = {
            record[primary_key]: record for record in current_records
        }
        updates += sum(
            record[primary_key] in current_by_key
            and current_by_key[record[primary_key]] != record
            for record in grouped[path]
        )
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
    # Canonical documents contain many identical punctuation/event lines. Feeding
    # their already-equal population to SequenceMatcher makes a simple record
    # insertion quadratic. Trim exact common boundaries before matching, preserving
    # absolute line coordinates and the usual three context lines.
    prefix = 0
    common = min(len(before), len(after))
    while prefix < common and before[prefix] == after[prefix]:
        prefix += 1
    if prefix == len(before) == len(after):
        return ""
    suffix = 0
    while suffix < common - prefix and before[len(before) - suffix - 1] == after[len(after) - suffix - 1]:
        suffix += 1
    old_end, new_end = len(before) - suffix, len(after) - suffix
    # Match only the changed middle. Keeping equal prefix/suffix as fixed anchors
    # also prevents repetitive braces from shifting context past a clipped edge.
    codes = [(tag, i + prefix, j + prefix, k + prefix, end + prefix)
             for tag, i, j, k, end in difflib.SequenceMatcher(
                 None, before[prefix:old_end], after[prefix:new_end]
             ).get_opcodes()]
    if prefix:
        codes.insert(0, ("equal", 0, prefix, 0, prefix))
    if suffix:
        codes.append(("equal", old_end, len(before), new_end, len(after)))
    result = [f"--- a/{relative}\n", f"+++ b/{relative}\n"]
    for group in _diff_groups(codes):
        result.append(f"@@ -{_diff_range(group[0][1], group[-1][2])} +{_diff_range(group[0][3], group[-1][4])} @@\n")
        for tag, i, j, k, end in group:
            if tag == "equal":
                result.extend(" " + line for line in before[i:j])
            else:
                if tag in ("replace", "delete"):
                    result.extend("-" + line for line in before[i:j])
                if tag in ("replace", "insert"):
                    result.extend("+" + line for line in after[k:end])
    return "".join(result)


def _diff_range(start: int, end: int) -> str:
    length = end - start
    if length == 1:
        return str(start + 1)
    return f"{start if length == 0 else start + 1},{length}"


def _diff_groups(codes, context: int = 3):
    """Group anchored opcodes using ordinary unified-diff context semantics."""
    group = []
    for index, (tag, i, j, k, end) in enumerate(codes):
        if tag == "equal":
            if index == 0:
                i, k = max(i, j - context), max(k, end - context)
            if index == len(codes) - 1:
                j, end = min(j, i + context), min(end, k + context)
            if j - i > 2 * context:
                group.append((tag, i, i + context, k, k + context))
                if any(item[0] != "equal" for item in group):
                    yield group
                group = []
                i, k = j - context, end - context
        group.append((tag, i, j, k, end))
    if any(item[0] != "equal" for item in group):
        yield group



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
