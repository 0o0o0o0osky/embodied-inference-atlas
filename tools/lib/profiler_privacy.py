from __future__ import annotations

import re
from collections.abc import Mapping

from tools.lib.contracts import Issue


PROFILER_DATASETS = frozenset({
    "profiler_captures",
    "timelines",
    "kernel_signatures",
    "kernel_observations",
    "profiler_metrics",
    "operator_kernel_links",
    "telemetry",
})

_RAW_KEYS = frozenset({
    "pid", "tid", "process_id", "process_name", "thread_id", "thread_name",
    "global_pid", "global_tid", "context_id", "stream_id", "correlation_id",
    "graph_id", "graph_node_id", "device_id", "session_id", "timestamp",
    "absolute_timestamp", "created", "creation_time", "hostname", "host_name",
    "command", "arguments", "environment", "working_directory", "working_dir",
    "report_name", "report_path", "checkpoint_path", "source_path", "raw_log",
    "nvtx_text", "kernel_name", "kernel_symbol", "demangled_name", "mangled_name",
    "raw_symbol", "gpu_uuid", "uuid", "bus_location", "pci_bus_id", "gpu_info",
    "hash", "sha256",
})
_HASH = re.compile(r"(?i)^[0-9a-f]{32,128}$")
_GPU_UUID = re.compile(r"(?i)^GPU-[0-9a-f-]{32,}$")
_PCI_BUS = re.compile(r"(?i)^(?:[0-9a-f]{4}:)?[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$")
_ABSOLUTE_TIME = re.compile(
    r"^\d{4}-(?:\d{2}|[A-Za-z]{3})-\d{2}[T ]\d{2}:\d{2}:\d{2}"
)
_RAW_SYMBOL = re.compile(r"::|<[^>]+>\s*\(")
_BLOCKED_REPORT_SUFFIX = re.compile(r"(?i)\.(?:ncu-rep|nsys-rep|sqlite3?|db)$")
_SLUG = r"[a-z0-9]+(?:-[a-z0-9]+)*"
_RUN_ID = re.compile(rf"^run-({_SLUG})-(\d{{3}})$")
_CONFIG_ID = re.compile(rf"^config-{_SLUG}-\d{{3}}$")
_GLOBAL_IDS = {
    "capture_id": re.compile(rf"^capture-{_SLUG}-\d{{3}}$"),
    "timeline_id": re.compile(rf"^timeline-{_SLUG}-\d{{3}}$"),
    "kernel_signature_id": re.compile(rf"^kernel-signature-{_SLUG}$"),
    "observation_id": re.compile(rf"^kernel-observation-{_SLUG}-\d{{3}}$"),
    "metric_id": re.compile(rf"^metric-{_SLUG}-\d{{3}}$"),
    "link_id": re.compile(rf"^operator-kernel-link-{_SLUG}-\d{{3}}$"),
    "telemetry_id": re.compile(rf"^telemetry-{_SLUG}-\d{{3}}$"),
}
_LOCAL_IDS = {
    "lane_id": re.compile(r"^lane-\d{3}$"),
    "event_id": re.compile(r"^event-\d{5}$"),
}


def scan_profiler_bundle(value: object) -> list[Issue]:
    datasets = value.get("datasets") if isinstance(value, Mapping) else None
    if not isinstance(datasets, Mapping):
        datasets = value if isinstance(value, Mapping) else {}
    issues: list[Issue] = []
    captures = datasets.get("profiler_captures")
    capture_records = [
        item for item in captures if isinstance(item, Mapping)
    ] if isinstance(captures, list) else []
    profiler_run_ids = {
        item.get("run_id") for item in capture_records
        if isinstance(item.get("run_id"), str)
    }
    runs = datasets.get("runs")
    run_records = [
        (index, item) for index, item in enumerate(runs)
        if isinstance(item, Mapping)
        and (
            item.get("capture_method") in {"nsys", "ncu"}
            or item.get("run_id") in profiler_run_ids
        )
    ] if isinstance(runs, list) else []
    for dataset in sorted(PROFILER_DATASETS):
        if dataset in datasets:
            issues.extend(_scan(datasets[dataset], f"$.datasets.{dataset}"))
    issues.extend(_scan_generated_ids(datasets, run_records))
    return issues


def _scan_generated_ids(
    datasets: Mapping, run_records: list[tuple[int, Mapping]]
) -> list[Issue]:
    issues: list[Issue] = []
    run_labels: dict[object, tuple[str, str]] = {}
    for index, run in run_records:
        run_id = run.get("run_id")
        configuration_id = run.get("configuration_id")
        valid_configuration = (
            isinstance(configuration_id, str)
            and _CONFIG_ID.fullmatch(configuration_id) is not None
        )
        if not valid_configuration:
            issues.append(_generated_id(
                f"$.datasets.runs[{index}].configuration_id"
            ))
        match = _RUN_ID.fullmatch(run_id) if isinstance(run_id, str) else None
        if match is None:
            issues.append(_generated_id(f"$.datasets.runs[{index}].run_id"))
            continue
        label, ordinal = match.groups()
        run_labels[run_id] = (label, ordinal)
        if valid_configuration and configuration_id != f"config-{label}-{ordinal}":
            issues.append(_generated_id(
                f"$.datasets.runs[{index}].configuration_id"
            ))

    primary_keys = {
        "profiler_captures": "capture_id",
        "timelines": "timeline_id",
        "kernel_signatures": "kernel_signature_id",
        "kernel_observations": "observation_id",
        "profiler_metrics": "metric_id",
        "operator_kernel_links": "link_id",
        "telemetry": "telemetry_id",
    }
    run_scoped_prefixes = {
        "profiler_captures": "capture",
        "timelines": "timeline",
        "kernel_observations": "kernel-observation",
        "profiler_metrics": "metric",
        "telemetry": "telemetry",
    }
    for dataset, key in primary_keys.items():
        records = datasets.get(dataset)
        if not isinstance(records, list):
            continue
        for index, record in enumerate(records):
            if not isinstance(record, Mapping):
                continue
            value = record.get(key)
            issues.extend(_scan_reference_ids(
                record, f"$.datasets.{dataset}[{index}]", top_primary=key
            ))
            if dataset == "timelines":
                _scan_timeline_local_ids(issues, record, index)
            pattern = _GLOBAL_IDS[key]
            if not isinstance(value, str) or pattern.fullmatch(value) is None:
                issues.append(_generated_id(
                    f"$.datasets.{dataset}[{index}].{key}"
                ))
                continue
            run_label = run_labels.get(record.get("run_id"))
            prefix = run_scoped_prefixes.get(dataset)
            if run_label is not None and prefix is not None:
                label, ordinal = run_label
                expected = (
                    f"{prefix}-{label}-{ordinal}"
                    if dataset == "profiler_captures"
                    else None
                )
                if (
                    expected is not None and value != expected
                    or expected is None
                    and re.fullmatch(rf"{re.escape(prefix)}-{re.escape(label)}-\d{{3}}", value) is None
                ):
                    issues.append(_generated_id(
                        f"$.datasets.{dataset}[{index}].{key}"
                    ))
    return issues


def _scan_reference_ids(
    value: object, path: str, *, top_primary: str | None = None,
    at_top: bool = True,
) -> list[Issue]:
    issues: list[Issue] = []
    if isinstance(value, Mapping):
        subject = value.get("subject")
        if isinstance(subject, Mapping):
            subject_key = {
                "capture": "capture_id",
                "timeline": "timeline_id",
                "kernel_observation": "observation_id",
            }.get(subject.get("kind"))
            subject_id = subject.get("id")
            if subject_key is not None and (
                not isinstance(subject_id, str)
                or _GLOBAL_IDS[subject_key].fullmatch(subject_id) is None
            ):
                issues.append(_generated_id(f"{path}.subject.id"))
        evidence_ids = value.get("evidence_ids")
        if isinstance(evidence_ids, list):
            for index, item in enumerate(evidence_ids):
                if (
                    not isinstance(item, str)
                    or _GLOBAL_IDS["capture_id"].fullmatch(item) is None
                ):
                    issues.append(_generated_id(f"{path}.evidence_ids[{index}]"))
        for raw_key, child in value.items():
            key = str(raw_key)
            child_path = f"{path}.{key}"
            if not (at_top and key == top_primary):
                if key == "run_id" and (
                    not isinstance(child, str) or _RUN_ID.fullmatch(child) is None
                ):
                    issues.append(_generated_id(child_path))
                elif key in _GLOBAL_IDS and child is not None and (
                    not isinstance(child, str)
                    or _GLOBAL_IDS[key].fullmatch(child) is None
                ):
                    issues.append(_generated_id(child_path))
                elif key in _LOCAL_IDS and (
                    not isinstance(child, str)
                    or _LOCAL_IDS[key].fullmatch(child) is None
                ):
                    issues.append(Issue(
                        child_path,
                        "profiler_local_id",
                        "timeline-local ID must use its deterministic controlled form",
                    ))
            issues.extend(_scan_reference_ids(
                child, child_path, top_primary=None, at_top=False
            ))
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            issues.extend(_scan_reference_ids(
                child, f"{path}[{index}]", top_primary=None, at_top=False
            ))
    return issues


def _scan_timeline_local_ids(
    issues: list[Issue], timeline: Mapping, timeline_index: int
) -> None:
    for collection, key in (("lanes", "lane_id"), ("events", "event_id")):
        records = timeline.get(collection)
        if not isinstance(records, list):
            continue
        pattern = _LOCAL_IDS[key]
        width = 3 if key == "lane_id" else 5
        prefix = "lane" if key == "lane_id" else "event"
        for index, record in enumerate(records):
            value = record.get(key) if isinstance(record, Mapping) else None
            expected = f"{prefix}-{index + 1:0{width}d}"
            if (
                not isinstance(value, str)
                or pattern.fullmatch(value) is None
                or value != expected
            ):
                issues.append(Issue(
                    f"$.datasets.timelines[{timeline_index}].{collection}[{index}].{key}",
                    "profiler_local_id",
                    "timeline-local ID must use its deterministic controlled form",
                ))


def _generated_id(path: str) -> Issue:
    return Issue(
        path,
        "profiler_generated_id",
        "profiler ID must use its deterministic controlled form",
    )


def _scan(value: object, path: str) -> list[Issue]:
    issues: list[Issue] = []
    if isinstance(value, Mapping):
        for raw_key, child in sorted(value.items(), key=lambda item: str(item[0])):
            key = _normalize_key(str(raw_key))
            child_path = f"{path}.{raw_key}"
            if key in _RAW_KEYS:
                issues.append(
                    Issue(child_path, "profiler_raw_key", "raw profiler identity field is forbidden")
                )
            issues.extend(_scan(child, child_path))
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            issues.extend(_scan(child, f"{path}[{index}]"))
    elif isinstance(value, str):
        if _HASH.fullmatch(value):
            issues.append(
                Issue(path, "profiler_identity_hash", "hash-shaped profiler identity is forbidden")
            )
        if _GPU_UUID.fullmatch(value) or _PCI_BUS.fullmatch(value):
            issues.append(
                Issue(path, "profiler_hardware_identity", "raw hardware identity is forbidden")
            )
        if _ABSOLUTE_TIME.match(value):
            issues.append(
                Issue(path, "profiler_absolute_time", "absolute profiler timestamps are forbidden")
            )
        if _RAW_SYMBOL.search(value):
            issues.append(
                Issue(path, "profiler_raw_symbol", "raw profiler symbols are forbidden")
            )
        if _BLOCKED_REPORT_SUFFIX.search(value):
            issues.append(
                Issue(path, "profiler_report_reference", "raw profiler report references are forbidden")
            )
    return issues


def _normalize_key(value: str) -> str:
    separated = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", value)
    return re.sub(r"[^a-z0-9]+", "_", separated.lower()).strip("_")
