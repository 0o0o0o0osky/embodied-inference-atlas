from __future__ import annotations

import argparse
import copy
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path

from extractors.benchmark import staging_output
from extractors.common import SourceFormatError, validate_source_label
from extractors.ncu import import_ncu_report
from extractors.nsys import import_nsys_sqlite
from extractors.profiler_common import ProfilerImportContext
from tools.lib.contracts import validate_document
from tools.lib.jsonio import load_json, write_json_atomic
from tools.lib.privacy import scan_json
from tools.lib.profiler import PROFILER_DATASETS, profiler_semantic_issues
from tools.lib.profiler_privacy import scan_profiler_bundle


_JOB_KEYS = {"job_version", "source_label", "policy_file", "inputs"}
_INPUT_KEYS = {
    "input", "source_label", "source_id", "system_id", "capture_label",
    "signature_policy_id", "window_policy_id", "tool", "policy_key", "run",
}
_POLICY_KEYS = {"policy_version", "signatures", "ncu", "nsys"}


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Stage one reviewed 3-Nsys/16-NCU profiler batch"
    )
    parser.add_argument("--job", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args(argv)


def import_profiler_job(
    job: Mapping[str, object], policy: Mapping[str, object], repo_root: Path
) -> dict[str, object]:
    if set(job) != _JOB_KEYS or job.get("job_version") != "1.0.0":
        raise SourceFormatError("profiler-batch: invalid job manifest")
    if set(policy) != _POLICY_KEYS or policy.get("policy_version") != "1.0.0":
        raise SourceFormatError("profiler-batch: invalid policy manifest")
    source_label = job.get("source_label")
    if not isinstance(source_label, str):
        raise SourceFormatError("profiler-batch: invalid job manifest")
    try:
        validate_source_label(source_label)
    except ValueError as error:
        raise SourceFormatError("profiler-batch: invalid job manifest") from error
    inputs = job.get("inputs")
    if not isinstance(inputs, list) or len(inputs) != 19:
        raise SourceFormatError(f"{source_label}: expected 19 profiler inputs")
    if not all(isinstance(item, Mapping) and set(item) == _INPUT_KEYS for item in inputs):
        raise SourceFormatError(f"{source_label}: invalid profiler input")
    tools = [item.get("tool") for item in inputs]
    if tools.count("nsys") != 3 or tools.count("ncu") != 16:
        raise SourceFormatError(f"{source_label}: expected 3 Nsys and 16 NCU inputs")
    paths = [item.get("input") for item in inputs]
    if not all(isinstance(path, str) for path in paths) or len(set(paths)) != 19:
        raise SourceFormatError(f"{source_label}: invalid profiler input")

    datasets: dict[str, list[dict[str, object]]] = {
        "runs": [],
        **{dataset: [] for dataset in PROFILER_DATASETS},
    }
    signature_by_id: dict[str, dict[str, object]] = {}
    primary_ids: dict[str, set[str]] = {dataset: set() for dataset in datasets}
    primary_keys = {
        "runs": "run_id",
        "profiler_captures": "capture_id",
        "timelines": "timeline_id",
        "kernel_signatures": "kernel_signature_id",
        "kernel_observations": "observation_id",
        "profiler_metrics": "metric_id",
        "operator_kernel_links": "link_id",
        "telemetry": "telemetry_id",
    }

    policy_groups = {
        "ncu": policy.get("ncu"),
        "nsys": policy.get("nsys"),
    }
    signatures = policy.get("signatures")
    if (
        not isinstance(signatures, Mapping)
        or not all(isinstance(value, Mapping) for value in signatures.values())
        or not all(isinstance(group, Mapping) for group in policy_groups.values())
    ):
        raise SourceFormatError(f"{source_label}: invalid policy manifest")

    for item in inputs:
        safe_label = item.get("source_label")
        try:
            if not isinstance(safe_label, str):
                raise ValueError
            validate_source_label(safe_label)
        except ValueError as error:
            raise SourceFormatError(f"{source_label}: invalid profiler input") from error
        context = ProfilerImportContext(
            source_label=safe_label,
            source_id=item["source_id"],
            system_id=item["system_id"],
            run=copy.deepcopy(item["run"]),
            capture_label=item["capture_label"],
            signature_policy_id=item["signature_policy_id"],
            window_policy_id=item["window_policy_id"],
        )
        tool = item["tool"]
        group = policy_groups[tool]
        assert isinstance(group, Mapping)
        local_policy = group.get(item["policy_key"])
        if not isinstance(local_policy, Mapping):
            raise SourceFormatError(f"{safe_label}: missing profiler policy")
        hydrated = _hydrate_policy(tool, local_policy, signatures, safe_label)
        input_file = Path(item["input"])
        if tool == "nsys":
            if input_file.suffix != ".sqlite":
                raise SourceFormatError(f"{safe_label}: invalid Nsys input")
            part = import_nsys_sqlite(input_file, context, hydrated)
        else:
            if not input_file.name.endswith(".ncu-rep"):
                raise SourceFormatError(f"{safe_label}: invalid NCU input")
            part = import_ncu_report(input_file, context, hydrated)
        part_datasets = part.get("datasets")
        if not isinstance(part_datasets, Mapping) or set(part_datasets) != set(datasets):
            raise SourceFormatError(f"{safe_label}: invalid profiler result")
        for dataset, raw_records in part_datasets.items():
            if not isinstance(raw_records, list) or not all(
                isinstance(record, Mapping) for record in raw_records
            ):
                raise SourceFormatError(f"{safe_label}: invalid profiler result")
            key = primary_keys[dataset]
            for raw_record in raw_records:
                record = copy.deepcopy(dict(raw_record))
                record_id = record.get(key)
                if not isinstance(record_id, str):
                    raise SourceFormatError(f"{safe_label}: invalid profiler result")
                if dataset == "kernel_signatures":
                    previous = signature_by_id.get(record_id)
                    if previous is None:
                        signature_by_id[record_id] = record
                        datasets[dataset].append(record)
                    elif previous != record:
                        raise SourceFormatError(
                            f"{safe_label}: conflicting kernel signature policy"
                        )
                    continue
                if record_id in primary_ids[dataset]:
                    raise SourceFormatError(f"{safe_label}: duplicate profiler record")
                primary_ids[dataset].add(record_id)
                datasets[dataset].append(record)

    bundle = {
        "bundle_version": "1.0.0",
        "source_label": source_label,
        "datasets": datasets,
    }
    _validate_bundle(bundle, repo_root)
    return bundle


def _hydrate_policy(
    tool: object,
    local_policy: Mapping[str, object],
    signatures: Mapping[object, object],
    source_label: str,
) -> dict[str, object]:
    result = copy.deepcopy(dict(local_policy))
    if tool == "ncu":
        signature_id = result.pop("signature_id", None)
        signature = signatures.get(signature_id)
        if not isinstance(signature, Mapping):
            raise SourceFormatError(f"{source_label}: missing kernel signature policy")
        result["signature"] = copy.deepcopy(dict(signature))
        return result
    rules = result.get("signature_rules")
    if not isinstance(rules, list):
        raise SourceFormatError(f"{source_label}: invalid Nsys policy")
    hydrated_rules = []
    for rule in rules:
        if not isinstance(rule, Mapping):
            raise SourceFormatError(f"{source_label}: invalid Nsys policy")
        hydrated_rule = copy.deepcopy(dict(rule))
        signature_id = hydrated_rule.pop("signature_id", None)
        signature = signatures.get(signature_id)
        if not isinstance(signature, Mapping):
            raise SourceFormatError(f"{source_label}: missing kernel signature policy")
        hydrated_rule["signature"] = copy.deepcopy(dict(signature))
        hydrated_rules.append(hydrated_rule)
    result["signature_rules"] = hydrated_rules
    return result


def _validate_bundle(bundle: Mapping[str, object], repo_root: Path) -> None:
    datasets = bundle.get("datasets")
    assert isinstance(datasets, Mapping)
    issues = []
    for dataset, records in datasets.items():
        document = {
            "schema_version": "1.0.0",
            "dataset": dataset,
            "records": records,
        }
        issues.extend(validate_document(dataset, document, repo_root))
    issues.extend(profiler_semantic_issues(datasets))
    issues.extend(scan_json(bundle))
    issues.extend(scan_profiler_bundle(bundle))
    if issues:
        raise SourceFormatError("profiler-batch: rejected canonical boundary")


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        repo_root = Path.cwd()
        output = staging_output(args.output, repo_root)
        job = load_json(args.job)
        if not isinstance(job, Mapping) or not isinstance(job.get("policy_file"), str):
            raise SourceFormatError("profiler-batch: invalid job manifest")
        policy = load_json(Path(job["policy_file"]))
        if not isinstance(policy, Mapping):
            raise SourceFormatError("profiler-batch: invalid policy manifest")
        bundle = import_profiler_job(job, policy, repo_root)
        write_json_atomic(output, bundle)
    except (OSError, SourceFormatError, ValueError, KeyError, TypeError):
        print("profiler import: rejected source, policy, or output", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
