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


def scan_profiler_bundle(value: object) -> list[Issue]:
    datasets = value.get("datasets") if isinstance(value, Mapping) else None
    if not isinstance(datasets, Mapping):
        datasets = value if isinstance(value, Mapping) else {}
    issues: list[Issue] = []
    for dataset in sorted(PROFILER_DATASETS):
        if dataset in datasets:
            issues.extend(_scan(datasets[dataset], f"$.datasets.{dataset}"))
    return issues


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
