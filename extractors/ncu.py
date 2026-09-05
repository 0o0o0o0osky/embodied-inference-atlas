from __future__ import annotations

import copy
import csv
import io
import re
import subprocess
from collections.abc import Mapping, Sequence
from pathlib import Path

from extractors.common import SourceFormatError, record_id
from extractors.profiler_common import (
    DIRECT_METRIC_NAMES,
    EXPLICIT_MISSING_METRICS,
    METRIC_REGISTRY,
    ProfilerImportContext,
    require_profiler_run,
)


NCU_READER_METRICS: tuple[str, ...] = (
    "gpu__time_duration.sum",
    "sm__throughput.avg.pct_of_peak_sustained_elapsed",
    "sm__pipe_tensor_cycles_active.avg.pct_of_peak_sustained_elapsed",
    "gpu__compute_memory_throughput.avg.pct_of_peak_sustained_elapsed",
    "l1tex__throughput.avg.pct_of_peak_sustained_active",
    "lts__throughput.avg.pct_of_peak_sustained_elapsed",
    "lts__d_sectors_fill_sysmem.avg.pct_of_peak_sustained_elapsed",
    "sm__maximum_warps_per_active_cycle_pct",
    "sm__warps_active.avg.pct_of_peak_sustained_active",
    "launch__grid_dim_x",
    "launch__grid_dim_y",
    "launch__grid_dim_z",
    "launch__block_dim_x",
    "launch__block_dim_y",
    "launch__block_dim_z",
    "launch__grid_size",
    "launch__block_size",
    "launch__registers_per_thread",
    "launch__shared_mem_per_block",
    "launch__shared_mem_per_block_static",
    "launch__shared_mem_per_block_dynamic",
)

_IDENTITY_COLUMNS = (
    "ID", "Process ID", "Process Name", "Host Name", "Kernel Name",
    "Context", "Stream", "Block Size", "Grid Size", "Device", "CC",
)
_SELECTION_POLICIES = {"explicit_invocation", "name_filter_first_match"}
_SECTION_MODES = {"section_set", "custom_metric_set_12"}
_WARNINGS = {"gpu_frequency_not_fixed", "work_id_unavailable"}


def parse_ncu_exports(
    session_csv: str,
    details_csv: str,
    raw_csv: str,
    context: ProfilerImportContext,
    policy: Mapping[str, object],
) -> dict[str, object]:
    run = require_profiler_run(context, "ncu")
    _validate_policy(context, policy)
    tool_version = _tool_version(session_csv, context)
    details_rows = _dict_rows(details_csv, context, "details")
    identity = _one_details_identity(details_rows, context)
    raw_rows = _dict_rows(raw_csv, context, "raw")
    raw = _one_raw_result(raw_rows, identity, context)
    values = {
        name: _number(raw.get(name), context, "raw", index + 1)
        for index, name in enumerate(NCU_READER_METRICS)
    }

    duration_ns = _integer(values["gpu__time_duration.sum"], context, "raw", 1)
    grid = [
        _positive_integer(values[f"launch__grid_dim_{axis}"], context, "raw", 1)
        for axis in "xyz"
    ]
    block = [
        _positive_integer(values[f"launch__block_dim_{axis}"], context, "raw", 1)
        for axis in "xyz"
    ]
    waves = _details_number(
        details_rows,
        ("Waves Per SM", "launch__waves_per_multiprocessor"),
        context,
    )
    capture_id = record_id("capture", context, 1)
    observation_id = record_id("kernel-observation", context, 1)
    run_id = run["run_id"]
    source_id = context.source_id
    selection_policy = policy["selection_policy"]
    assert isinstance(run_id, str) and isinstance(selection_policy, str)

    signature_source = policy["signature"]
    assert isinstance(signature_source, Mapping)
    signature = copy.deepcopy(dict(signature_source))
    signature["runtime_id"] = run["runtime_id"]
    signature["model_id"] = run["model_id"]
    signature_id = signature["kernel_signature_id"]
    assert isinstance(signature_id, str)

    backing_store_bytes = policy["backing_store_bytes"]
    capture_missing = {
        "target_window_label": "not_applicable",
        "nsys": "not_applicable",
    }
    if backing_store_bytes is None:
        capture_missing["ncu.backing_store_bytes"] = "counter_absent_from_report"
    capture = {
        "capture_id": capture_id,
        "run_id": run_id,
        "source_id": source_id,
        "evidence": "measured_local",
        "tool": "ncu",
        "tool_version": tool_version,
        "collection_scope": "representative_kernel_launch",
        "target_window_label": None,
        "target_window_count": 1,
        "selection_policy": selection_policy,
        "coverage": {
            "population": "one_replayed_launch",
            "observed_count": 1,
            "is_complete_for_population": True,
        },
        "warnings": list(policy["warnings"]),
        "nsys": None,
        "ncu": {
            "replay_mode": policy["replay_mode"],
            "replay_passes": policy["replay_passes"],
            "cache_control_request": policy["cache_control_request"],
            "clock_control_request": policy["clock_control_request"],
            "warmup_count": policy["warmup_count"],
            "backing_store_bytes": backing_store_bytes,
        },
        "missing": capture_missing,
    }
    quality = ["replayed_launch"] + [
        warning for warning in policy["warnings"]
        if warning in {"gpu_frequency_not_fixed", "work_id_unavailable"}
    ]
    observation = {
        "observation_id": observation_id,
        "capture_id": capture_id,
        "run_id": run_id,
        "source_id": source_id,
        "kernel_signature_id": signature_id,
        "observation_kind": "ncu_replayed_launch",
        "population": (
            "one_explicitly_selected_replayed_launch"
            if selection_policy == "explicit_invocation"
            else "one_name_filtered_first_match_replayed_launch"
        ),
        "calls": 1,
        "duration": {"statistic": "single", "value_ns": duration_ns, "sample_count": 1},
        "launch": {
            "grid": grid,
            "block": block,
            "registers_per_thread": _integer(
                values["launch__registers_per_thread"], context, "raw", 1
            ),
            "static_shared_memory_bytes": _integer(
                values["launch__shared_mem_per_block_static"], context, "raw", 1
            ),
            "dynamic_shared_memory_bytes": _integer(
                values["launch__shared_mem_per_block_dynamic"], context, "raw", 1
            ),
            "waves_per_sm": waves,
        },
        "duration_share": None,
        "quality": quality,
        "missing": {
            "duration_share": "not_applicable",
            **({"launch.waves_per_sm": "counter_absent_from_report"} if waves is None else {}),
        },
    }
    metrics = _metrics(
        values, capture_id, run_id, source_id, observation_id, context, policy
    )
    operating_point = run["operating_point"]
    assert isinstance(operating_point, Mapping)
    telemetry = {
        "telemetry_id": record_id("telemetry", context, 1),
        "run_id": run_id,
        "capture_id": capture_id,
        "source_id": source_id,
        "operating_point_id": operating_point["operating_point_id"],
        "record_kind": "sampled_series",
        "alignment": "same_run_unaligned",
        "window": None,
        "metric_name": "throttle_status",
        "samples": [],
        "summary": None,
        "evidence_semantics": "observed_samples",
        "missing_reason": "not_collected",
    }
    return {
        "bundle_version": "1.0.0",
        "source_label": context.source_label,
        "datasets": {
            "runs": [copy.deepcopy(dict(run))],
            "profiler_captures": [capture],
            "timelines": [],
            "kernel_signatures": [signature],
            "kernel_observations": [observation],
            "profiler_metrics": metrics,
            "operator_kernel_links": [],
            "telemetry": [telemetry],
        },
    }


def import_ncu_report(
    input_file: Path,
    context: ProfilerImportContext,
    policy: Mapping[str, object],
) -> dict[str, object]:
    common = [
        "ncu", "--import", str(input_file), "--csv",
        "--print-kernel-base", "function", "--print-units", "base", "--print-fp",
    ]
    pages: dict[str, str] = {}
    for page in ("session", "details", "raw"):
        command = [*common, "--page", page]
        if page == "raw":
            command.extend(("--metrics", ",".join(NCU_READER_METRICS)))
        try:
            result = subprocess.run(
                command,
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        except OSError as error:
            raise SourceFormatError(
                f"{context.source_label}: unable to read NCU {page} page"
            ) from error
        if result.returncode != 0:
            raise SourceFormatError(
                f"{context.source_label}: unable to read NCU {page} page"
            )
        pages[page] = result.stdout
    return parse_ncu_exports(
        pages["session"], pages["details"], pages["raw"], context, policy
    )


def _validate_policy(context: ProfilerImportContext, policy: Mapping[str, object]) -> None:
    signature = policy.get("signature")
    valid = (
        policy.get("policy_id") == context.signature_policy_id
        and policy.get("selection_policy") in _SELECTION_POLICIES
        and policy.get("section_mode") in _SECTION_MODES
        and policy.get("replay_mode") == "kernel"
        and isinstance(policy.get("replay_passes"), int)
        and not isinstance(policy.get("replay_passes"), bool)
        and policy["replay_passes"] > 0
        and policy.get("cache_control_request") == "all"
        and policy.get("clock_control_request") == "base"
        and isinstance(policy.get("warmup_count"), int)
        and not isinstance(policy.get("warmup_count"), bool)
        and policy["warmup_count"] >= 0
        and (
            policy.get("backing_store_bytes") is None
            or isinstance(policy.get("backing_store_bytes"), int)
            and not isinstance(policy.get("backing_store_bytes"), bool)
            and policy["backing_store_bytes"] >= 0
        )
        and isinstance(policy.get("warnings"), list)
        and set(policy["warnings"]).issubset(_WARNINGS)
        and isinstance(signature, Mapping)
        and context.window_policy_id == "not-applicable"
    )
    if not valid:
        raise SourceFormatError(f"{context.source_label}: invalid NCU policy")
    expected_signature = {
        "kernel_signature_id", "label_sanitized", "function_family",
        "implementation_family", "precision_path", "classification_method",
        "classification_confidence", "missing",
    }
    if set(signature) != expected_signature:
        raise SourceFormatError(f"{context.source_label}: invalid NCU policy")


def _tool_version(payload: str, context: ProfilerImportContext) -> str:
    rows = _csv_rows(payload, context, "session")
    values = [row[1] for row in rows if len(row) >= 2 and row[0] == "Nsight Compute Target"]
    if len(values) != 1:
        raise SourceFormatError(f"{context.source_label}: invalid NCU session page row 1")
    match = re.match(r"^(\d+\.\d+\.\d+\.\d+)(?:\s|$)", values[0])
    if match is None:
        raise SourceFormatError(f"{context.source_label}: invalid NCU session page row 1")
    return match.group(1)


def _csv_rows(payload: str, context: ProfilerImportContext, page: str) -> list[list[str]]:
    if not isinstance(payload, str):
        raise SourceFormatError(f"{context.source_label}: invalid NCU {page} page row 1")
    try:
        return list(csv.reader(io.StringIO(payload)))
    except csv.Error as error:
        raise SourceFormatError(
            f"{context.source_label}: invalid NCU {page} page row 1"
        ) from error


def _dict_rows(
    payload: str, context: ProfilerImportContext, page: str
) -> list[dict[str, str]]:
    rows = _csv_rows(payload, context, page)
    if not rows or len(rows[0]) != len(set(rows[0])):
        raise SourceFormatError(f"{context.source_label}: invalid NCU {page} page row 1")
    header = rows[0]
    required = set(_IDENTITY_COLUMNS)
    if not required.issubset(header):
        raise SourceFormatError(f"{context.source_label}: invalid NCU {page} page row 1")
    if page == "raw" and not set(NCU_READER_METRICS).issubset(header):
        raise SourceFormatError(f"{context.source_label}: invalid NCU raw page row 1")
    output: list[dict[str, str]] = []
    for row_index, row in enumerate(rows[1:], start=2):
        if len(row) > len(header):
            raise SourceFormatError(
                f"{context.source_label}: invalid NCU {page} page row {row_index}"
            )
        padded = [*row, *("" for _ in range(len(header) - len(row)))]
        output.append(dict(zip(header, padded)))
    return output


def _one_details_identity(
    rows: Sequence[Mapping[str, str]], context: ProfilerImportContext
) -> tuple[str, ...]:
    identities = {
        tuple(row.get(column, "") for column in _IDENTITY_COLUMNS)
        for row in rows
        if all(row.get(column, "") for column in _IDENTITY_COLUMNS)
    }
    if len(identities) != 1:
        raise SourceFormatError(f"{context.source_label}: invalid NCU details page row 1")
    return next(iter(identities))


def _one_raw_result(
    rows: Sequence[Mapping[str, str]],
    identity: tuple[str, ...],
    context: ProfilerImportContext,
) -> Mapping[str, str]:
    matches = [
        row for row in rows
        if tuple(row.get(column, "") for column in _IDENTITY_COLUMNS) == identity
    ]
    if len(matches) != 1:
        raise SourceFormatError(f"{context.source_label}: invalid NCU raw page row 1")
    return matches[0]


def _number(
    value: object, context: ProfilerImportContext, page: str, row: int
) -> float:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as error:
        raise SourceFormatError(
            f"{context.source_label}: invalid NCU {page} page row {row}"
        ) from error
    if number < 0 or number != number or number in {float("inf"), float("-inf")}:
        raise SourceFormatError(f"{context.source_label}: invalid NCU {page} page row {row}")
    return number


def _integer(
    value: float, context: ProfilerImportContext, page: str, row: int
) -> int:
    if not value.is_integer():
        raise SourceFormatError(f"{context.source_label}: invalid NCU {page} page row {row}")
    return int(value)


def _positive_integer(
    value: float, context: ProfilerImportContext, page: str, row: int
) -> int:
    result = _integer(value, context, page, row)
    if result < 1:
        raise SourceFormatError(f"{context.source_label}: invalid NCU {page} page row {row}")
    return result


def _details_number(
    rows: Sequence[Mapping[str, str]],
    names: tuple[str, ...],
    context: ProfilerImportContext,
) -> float | None:
    values = [
        row.get("Metric Value")
        for row in rows
        if row.get("Metric Name") in names and row.get("Metric Value")
    ]
    if not values:
        return None
    if len(values) != 1:
        raise SourceFormatError(f"{context.source_label}: invalid NCU details page row 1")
    try:
        value = float(values[0])
    except (TypeError, ValueError) as error:
        raise SourceFormatError(
            f"{context.source_label}: invalid NCU details page row 1"
        ) from error
    if value < 0 or value != value or value in {float("inf"), float("-inf")}:
        raise SourceFormatError(f"{context.source_label}: invalid NCU details page row 1")
    return value


def _metrics(
    values: Mapping[str, float],
    capture_id: str,
    run_id: str,
    source_id: str,
    observation_id: str,
    context: ProfilerImportContext,
    policy: Mapping[str, object],
) -> list[dict[str, object]]:
    metrics: list[dict[str, object]] = []
    section_mode = policy["section_mode"]
    for metric_name in DIRECT_METRIC_NAMES:
        spec = METRIC_REGISTRY[metric_name]
        raw_counter = spec["raw_counter_name"]
        assert isinstance(raw_counter, str)
        section = (
            "custom_metric_set_12"
            if section_mode == "custom_metric_set_12"
            else spec["sections"][0]
        )
        value: float | int = values[raw_counter]
        if metric_name == "kernel_duration":
            value = _integer(value, context, "raw", 1)
        metrics.append({
            "metric_id": record_id("metric", context, len(metrics) + 1),
            "capture_id": capture_id,
            "run_id": run_id,
            "source_id": source_id,
            "subject": {"kind": "kernel_observation", "id": observation_id},
            "metric_name": metric_name,
            "raw_counter_name": raw_counter,
            "section_name": section,
            "basis": "per_profiled_launch",
            "statistic": "single",
            "value": value,
            "unit": spec["unit"],
            "confidence": "medium",
            "missing_reason": None,
        })
    for metric_name, missing_reason in EXPLICIT_MISSING_METRICS:
        spec = METRIC_REGISTRY[metric_name]
        metrics.append({
            "metric_id": record_id("metric", context, len(metrics) + 1),
            "capture_id": capture_id,
            "run_id": run_id,
            "source_id": source_id,
            "subject": {"kind": "kernel_observation", "id": observation_id},
            "metric_name": metric_name,
            "raw_counter_name": None,
            "section_name": spec["sections"][0],
            "basis": "per_profiled_launch",
            "statistic": "single",
            "value": None,
            "unit": spec["unit"],
            "confidence": "unknown",
            "missing_reason": missing_reason,
        })
    return metrics
