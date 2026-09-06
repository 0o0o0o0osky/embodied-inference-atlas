from __future__ import annotations

import copy
import csv
import io
import re
import shlex
import subprocess
from collections.abc import Mapping, Sequence
from pathlib import Path

from extractors.common import SourceFormatError
from extractors.profiler_common import (
    DIRECT_METRIC_NAMES,
    EXPLICIT_MISSING_METRICS,
    METRIC_REGISTRY,
    RAW_COUNTER_REGISTRY,
    SCHEDULER_DIRECT_METRIC_NAMES,
    ProfilerImportContext,
    SCHEDULER_METRIC_NAMES,
    SYSMEM_SECTOR_METRIC_NAMES,
    WARP_STATE_METRIC_NAMES,
    profiler_record_id,
    require_profiler_run,
    valid_warp_trigger,
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

SECTION_READER_METRICS: tuple[str, ...] = (
    "gpc__cycles_elapsed.avg.per_second",
    "sm__cycles_elapsed.avg.per_second",
    "sm__ops_path_tensor_op_utcqmma_src_fp4_fp6_fp8_dst_fp32_sparsity_off.avg.pct_of_peak_sustained_elapsed",
)

SCHEDULER_DIRECT_READER_METRICS: tuple[str, ...] = (
    "gpu__time_duration.sum",
    "sm__throughput.avg.pct_of_peak_sustained_elapsed",
    "sm__pipe_tensor_cycles_active.avg.pct_of_peak_sustained_active",
    "gpu__compute_memory_throughput.avg.pct_of_peak_sustained_elapsed",
    "l1tex__throughput.avg.pct_of_peak_sustained_active",
    "lts__throughput.avg.pct_of_peak_sustained_elapsed",
    "sm__maximum_warps_per_active_cycle_pct",
    "sm__warps_active.avg.pct_of_peak_sustained_active",
)

MEMORY_WORKLOAD_READER_METRICS: tuple[str, ...] = (
    "gpu__compute_memory_access_throughput.avg.pct_of_peak_sustained_elapsed",
    "l1tex__t_sector_hit_rate.pct",
    "gpu__compute_memory_request_throughput.avg.pct_of_peak_sustained_elapsed",
    "lts__t_sector_hit_rate.pct",
    "sm__memory_throughput.avg.pct_of_peak_sustained_elapsed",
)

LAUNCH_READER_METRICS: tuple[str, ...] = tuple(
    metric for metric in NCU_READER_METRICS if metric.startswith("launch__")
)
REQUIRED_LAUNCH_READER_METRICS: tuple[str, ...] = (
    "launch__grid_dim_x",
    "launch__grid_dim_y",
    "launch__grid_dim_z",
    "launch__block_dim_x",
    "launch__block_dim_y",
    "launch__block_dim_z",
    "launch__registers_per_thread",
    "launch__shared_mem_per_block_static",
    "launch__shared_mem_per_block_dynamic",
)

SCHEDULER_READER_METRICS: tuple[str, ...] = (
    "smsp__issue_active.avg.per_cycle_active",
    "smsp__issue_active.avg.pct_of_peak_sustained_active",
    "smsp__issue_inst0.avg.pct_of_peak_sustained_active",
    "smsp__warps_active.avg.per_cycle_active",
    "smsp__warps_eligible.avg.per_cycle_active",
    "smsp__maximum_warps_avg_per_active_cycle",
    "smsp__warps_active.avg.peak_sustained",
)

SYSMEM_SECTOR_READER_METRICS: tuple[str, ...] = (
    "lts__d_sectors_fill_sysmem.sum",
    "lts__t_sectors_aperture_sysmem_op_write.sum",
    "lts__t_sectors_srcunit_tex_aperture_sysmem_lookup_miss.sum",
)

WARP_STATE_READER_METRICS: tuple[str, ...] = (
    "smsp__average_warp_latency_per_inst_issued.ratio",
    "smsp__average_warps_issue_stalled_long_scoreboard_per_issue_active.ratio",
    "smsp__average_warps_issue_stalled_short_scoreboard_per_issue_active.ratio",
)

_IDENTITY_COLUMNS = (
    "ID", "Process ID", "Process Name", "Host Name", "Kernel Name",
    "Context", "Stream", "Block Size", "Grid Size", "Device", "CC",
)
_LEGACY_SECTION_MODES = {"section_set", "custom_metric_set_12"}
_SCHEDULER_MODE = "scheduler_stats_with_sysmem_sectors"
_WARP_MODE = "warp_state_stats"
_LOCKED_SECTION_MODES = {_SCHEDULER_MODE, _WARP_MODE}
_SECTION_MODES = _LEGACY_SECTION_MODES | _LOCKED_SECTION_MODES
_WARNINGS = {"gpu_frequency_not_fixed", "work_id_unavailable"}
_LEGACY_SECTION_SET = {
    "LaunchStats", "Occupancy", "SpeedOfLight", "MemoryWorkloadAnalysis",
    "SpeedOfLight_HierarchicalTensorRooflineChart",
}
_SCHEDULER_SECTION_ORDER = (
    "SpeedOfLight",
    "ComputeWorkloadAnalysis",
    "MemoryWorkloadAnalysis",
    "LaunchStats",
    "Occupancy",
    "SchedulerStats",
)
_WARP_SECTION_ORDER = ("SpeedOfLight", "LaunchStats", "WarpStateStats")
_LOCKED_REQUIRED_OPTIONS = (
    ("--config-file", None, "off"),
    ("--profile-from-start", None, "off"),
    ("--graph-profiling", None, "node"),
    ("--filter-mode", None, "global"),
    ("--kernel-name-base", None, "function"),
    ("--rename-kernels", None, "off"),
    ("--import-source", None, "off"),
    ("--replay-mode", None, "kernel"),
    ("--cache-control", None, "all"),
    ("--clock-control", None, "none"),
    ("--launch-count", "-c", "1"),
)
_LOCKED_DENIED_OPTIONS = (
    "--devices", "--nvtx", "--nvtx-include", "--nvtx-exclude",
    "--range-filter", "--target-processes", "--target-processes-filter",
    "--native-include", "--native-exclude",
    "--python-include", "--python-exclude",
    "--section-folder", "--section-folder-recursive",
    "--launch-skip-before-match",
)
_APPROVED_SELECTORS = {
    "kernel-signature-pi0-encoder-large-gemm": {
        "kind": "kernel_id", "value": "::device_kernel:30",
    },
    "kernel-signature-pi0-decoder-nvjet-512x16": {
        "kind": "kernel_name",
        "value": "nvjet_sm110_qqhsh_512x16_128x3_2x1_2cta_v_bz_NNT",
        "launch_skip": 90,
    },
    "kernel-signature-pi0-siglip-fmha": {
        "kind": "kernel_id", "value": "::device_kernel:14",
    },
}
_CLI_DEFAULT_VERSION = "2025.3.0.0"
_COMMON_ORIGIN_KEYS = {
    "selection_policy", "replay_mode", "replay_passes",
    "cache_control_request", "clock_control_request", "warmup_count",
    "backing_store_bytes",
}
_LEGACY_ORIGIN_KEYS = _COMMON_ORIGIN_KEYS | {"gpu_frequency_not_fixed"}
_LOCKED_ORIGIN_KEYS = _COMMON_ORIGIN_KEYS | {
    "disable_extra_suffixes", "external_clock_control",
}
_TELEMETRY_UNITS = {
    "observed_gpu_frequency": "MHz",
    "observed_emc_frequency": "MHz",
    "observed_junction_temperature": "celsius",
    "observed_gpu_power": "mW",
    "throttle_status": "percent",
}
_TELEMETRY_ORIGINS = {
    "observed_gpu_frequency": "ncu_gpc_cycle_rate",
    "observed_emc_frequency": "jetson_clocks_show_current_freq",
    "observed_junction_temperature": "tegrastats_tj",
    "observed_gpu_power": "tegrastats_vdd_gpu",
    "throttle_status": "clock_event_audit",
}

_EXPECTED_RAW_UNITS = {
    "gpu__time_duration.sum": "ns",
    "sm__throughput.avg.pct_of_peak_sustained_elapsed": "%",
    "sm__pipe_tensor_cycles_active.avg.pct_of_peak_sustained_elapsed": "%",
    "sm__pipe_tensor_cycles_active.avg.pct_of_peak_sustained_active": "%",
    "gpu__compute_memory_throughput.avg.pct_of_peak_sustained_elapsed": "%",
    "gpu__compute_memory_access_throughput.avg.pct_of_peak_sustained_elapsed": "%",
    "l1tex__t_sector_hit_rate.pct": "%",
    "gpu__compute_memory_request_throughput.avg.pct_of_peak_sustained_elapsed": "%",
    "lts__t_sector_hit_rate.pct": "%",
    "sm__memory_throughput.avg.pct_of_peak_sustained_elapsed": "%",
    "l1tex__throughput.avg.pct_of_peak_sustained_active": "%",
    "lts__throughput.avg.pct_of_peak_sustained_elapsed": "%",
    "lts__d_sectors_fill_sysmem.avg.pct_of_peak_sustained_elapsed": "%",
    "sm__maximum_warps_per_active_cycle_pct": "%",
    "sm__warps_active.avg.pct_of_peak_sustained_active": "%",
    "gpc__cycles_elapsed.avg.per_second": "hz",
    "sm__cycles_elapsed.avg.per_second": "hz",
    "sm__ops_path_tensor_op_utcqmma_src_fp4_fp6_fp8_dst_fp32_sparsity_off.avg.pct_of_peak_sustained_elapsed": "%",
    "smsp__issue_active.avg.per_cycle_active": "",
    "smsp__issue_active.avg.pct_of_peak_sustained_active": "%",
    "smsp__issue_inst0.avg.pct_of_peak_sustained_active": "%",
    "smsp__warps_active.avg.per_cycle_active": "warp",
    "smsp__warps_eligible.avg.per_cycle_active": "warp",
    "smsp__maximum_warps_avg_per_active_cycle": "warp",
    "smsp__warps_active.avg.peak_sustained": "warp",
    "lts__d_sectors_fill_sysmem.sum": "sector",
    "lts__t_sectors_aperture_sysmem_op_write.sum": "sector",
    "lts__t_sectors_srcunit_tex_aperture_sysmem_lookup_miss.sum": "sector",
    # WarpStateStats assigns display semantics to otherwise surprising raw
    # units: latency exports `cycle`, while stall ratios export `inst`. Values
    # are preserved unchanged and canonical section provenance records the
    # cycles-per-issued-instruction interpretation; this is not a conversion.
    "smsp__average_warp_latency_per_inst_issued.ratio": "cycle",
    "smsp__average_warps_issue_stalled_long_scoreboard_per_issue_active.ratio": "inst",
    "smsp__average_warps_issue_stalled_short_scoreboard_per_issue_active.ratio": "inst",
    "launch__block_dim_x": "block",
    "launch__block_dim_y": "block",
    "launch__block_dim_z": "block",
    "launch__grid_dim_x": "",
    "launch__grid_dim_y": "",
    "launch__grid_dim_z": "",
    "launch__grid_size": "",
    "launch__block_size": "",
    "launch__registers_per_thread": "register/thread",
    "launch__shared_mem_per_block": "byte/block",
    "launch__shared_mem_per_block_static": "byte/block",
    "launch__shared_mem_per_block_dynamic": "byte/block",
    "launch__waves_per_multiprocessor": "wave",
}
assert set(_EXPECTED_RAW_UNITS) == set(RAW_COUNTER_REGISTRY)


def parse_ncu_exports(
    session_csv: str,
    details_csv: str,
    raw_csv: str,
    context: ProfilerImportContext,
    policy: Mapping[str, object],
) -> dict[str, object]:
    run = require_profiler_run(context, "ncu")
    _validate_policy(context, policy)
    facts = _session_facts(session_csv, context, policy)
    _verify_collection_facts(context, policy, facts)
    tool_version = facts["tool_version"]
    assert isinstance(tool_version, str)
    details_rows = _dict_rows(details_csv, context, "details")
    identity = _one_details_identity(details_rows, context)
    expected_identity = policy["expected_result_identity"]
    assert isinstance(expected_identity, Mapping)
    if identity != tuple(expected_identity[column] for column in _IDENTITY_COLUMNS):
        raise SourceFormatError(f"{context.source_label}: NCU result identity mismatch")
    reader_metrics = _reader_metrics(str(policy["section_mode"]))
    required_reader_metrics = _required_reader_metrics(
        str(policy["section_mode"])
    )
    _validate_raw_units(raw_csv, context, str(policy["section_mode"]))
    raw_rows = _dict_rows(
        raw_csv, context, "raw", required_reader_metrics
    )
    raw = _one_raw_result(raw_rows, identity, context)
    values = {
        name: _optional_number(raw.get(name), context, "raw", index + 1)
        for index, name in enumerate(reader_metrics)
    }
    for name in required_reader_metrics:
        _required_number(values.get(name), context)

    duration_ns = _integer(
        _required_number(values["gpu__time_duration.sum"], context),
        context,
        "raw",
        1,
    )
    grid = [
        _positive_integer(
            _required_number(values[f"launch__grid_dim_{axis}"], context),
            context,
            "raw",
            1,
        )
        for axis in "xyz"
    ]
    block = [
        _positive_integer(
            _required_number(values[f"launch__block_dim_{axis}"], context),
            context,
            "raw",
            1,
        )
        for axis in "xyz"
    ]
    expected_geometry = policy["expected_geometry"]
    assert isinstance(expected_geometry, Mapping)
    if grid != expected_geometry["grid"] or block != expected_geometry["block"]:
        raise SourceFormatError(f"{context.source_label}: NCU result geometry mismatch")
    waves = _details_number(
        details_rows,
        ("Waves Per SM", "launch__waves_per_multiprocessor"),
        context,
    )
    capture_id = profiler_record_id("capture", context, 1)
    observation_id = profiler_record_id("kernel-observation", context, 1)
    run_id = run["run_id"]
    source_id = context.source_id
    selection_policy = facts["selection_policy"]
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
        capture_missing["ncu.backing_store_bytes"] = "unavailable"
    ncu_collection = {
        "replay_mode": policy["replay_mode"],
        "replay_passes": policy["replay_passes"],
        "cache_control_request": policy["cache_control_request"],
        "clock_control_request": policy["clock_control_request"],
        "warmup_count": policy["warmup_count"],
        "backing_store_bytes": backing_store_bytes,
        "origins": copy.deepcopy(dict(policy["origins"])),
    }
    section_mode = str(policy["section_mode"])
    if section_mode in _LOCKED_SECTION_MODES:
        sections = (
            list(_SCHEDULER_SECTION_ORDER)
            if section_mode == _SCHEDULER_MODE
            else list(_WARP_SECTION_ORDER)
        )
        ncu_collection.update({
            "section_mode": section_mode,
            "sections": sections,
            "explicit_metrics": (
                list(SYSMEM_SECTOR_READER_METRICS)
                if section_mode == _SCHEDULER_MODE
                else []
            ),
            "disable_extra_suffixes": policy["disable_extra_suffixes"],
            "external_clock_control": copy.deepcopy(
                dict(policy["external_clock_control"])
            ),
        })
        if section_mode == _WARP_MODE:
            ncu_collection["warp_trigger"] = copy.deepcopy(
                dict(policy["warp_trigger"])
            )
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
        "ncu": ncu_collection,
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
            facts["population"]
        ),
        "calls": 1,
        "duration": {"statistic": "single", "value_ns": duration_ns, "sample_count": 1},
        "launch": {
            "grid": grid,
            "block": block,
            "registers_per_thread": _integer(
                _required_number(
                    values["launch__registers_per_thread"], context
                ),
                context, "raw", 1
            ),
            "static_shared_memory_bytes": _integer(
                _required_number(
                    values["launch__shared_mem_per_block_static"], context
                ),
                context, "raw", 1
            ),
            "dynamic_shared_memory_bytes": _integer(
                _required_number(
                    values["launch__shared_mem_per_block_dynamic"], context
                ),
                context, "raw", 1
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
    telemetry = _telemetry(
        capture_id, run_id, source_id, operating_point, context, policy, values
    )
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
            "telemetry": telemetry,
        },
    }


def import_ncu_report(
    input_file: Path,
    context: ProfilerImportContext,
    policy: Mapping[str, object],
) -> dict[str, object]:
    _validate_policy(context, policy)
    reader_metrics = _reader_metrics(str(policy["section_mode"]))
    common = [
        "ncu", "--config-file", "off", "--import", str(input_file), "--csv",
        "--print-kernel-base", "function", "--print-units", "base", "--print-fp",
    ]
    pages: dict[str, str] = {}
    for page in ("session", "details", "raw"):
        command = [*common, "--page", page]
        if page == "raw":
            command.extend(("--metrics", ",".join(reader_metrics)))
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
    origins = policy.get("origins")
    expected_identity = policy.get("expected_result_identity")
    expected_geometry = policy.get("expected_geometry")
    common_policy_keys = {
        "policy_id", "section_mode", "replay_mode", "replay_passes",
        "cache_control_request", "clock_control_request", "warmup_count",
        "backing_store_bytes", "warnings", "origins",
        "expected_result_identity", "expected_geometry", "signature",
    }
    section_mode = policy.get("section_mode")
    clock_control = policy.get("clock_control_request")
    warnings = policy.get("warnings")
    common_valid = (
        policy.get("policy_id") == context.signature_policy_id
        and policy.get("section_mode") in _SECTION_MODES
        and policy.get("replay_mode") == "kernel"
        and isinstance(policy.get("replay_passes"), int)
        and not isinstance(policy.get("replay_passes"), bool)
        and policy["replay_passes"] > 0
        and policy.get("cache_control_request") == "all"
        and isinstance(policy.get("warmup_count"), int)
        and not isinstance(policy.get("warmup_count"), bool)
        and policy["warmup_count"] >= 0
        and policy.get("backing_store_bytes") is None
        and isinstance(warnings, list)
        and len(warnings) == len(set(warnings))
        and set(warnings).issubset(_WARNINGS)
        and isinstance(origins, Mapping)
        and origins.get("selection_policy") == "session_command"
        and origins.get("replay_mode") in {"session_command", "ncu_cli_default_2025_3"}
        and origins.get("replay_passes") == "collection_log_manual_audit"
        and origins.get("cache_control_request") in {"session_command", "ncu_cli_default_2025_3"}
        and origins.get("clock_control_request") in {"session_command", "ncu_cli_default_2025_3"}
        and origins.get("warmup_count") == "harness_source_audit"
        and origins.get("backing_store_bytes") == "unavailable"
        and isinstance(expected_identity, Mapping)
        and set(expected_identity) == set(_IDENTITY_COLUMNS)
        and all(isinstance(expected_identity[column], str) and expected_identity[column] for column in _IDENTITY_COLUMNS)
        and isinstance(expected_geometry, Mapping)
        and set(expected_geometry) == {"grid", "block"}
        and _dimension(expected_geometry.get("grid"))
        and _dimension(expected_geometry.get("block"))
        and isinstance(signature, Mapping)
        and context.window_policy_id == "not-applicable"
    )
    legacy_valid = (
        common_valid
        and set(policy) == common_policy_keys
        and section_mode in _LEGACY_SECTION_MODES
        and clock_control in {"base", "none"}
        and "gpu_frequency_not_fixed" in warnings
        and set(origins) == _LEGACY_ORIGIN_KEYS
        and origins.get("gpu_frequency_not_fixed") == "collection_log_manual_audit"
    )
    locked_keys = common_policy_keys | {
        "approved_selector", "disable_extra_suffixes",
        "external_clock_control", "telemetry",
    }
    locked_valid = (
        common_valid
        and section_mode in _LOCKED_SECTION_MODES
        and set(policy) == (
            locked_keys | ({"warp_trigger"} if section_mode == _WARP_MODE else set())
        )
        and clock_control == "none"
        and "gpu_frequency_not_fixed" not in warnings
        and set(origins) == _LOCKED_ORIGIN_KEYS
        and all(
            origins.get(field) == "session_command"
            for field in (
                "selection_policy", "replay_mode", "cache_control_request",
                "clock_control_request", "disable_extra_suffixes",
            )
        )
        and isinstance(signature, Mapping)
        and policy.get("approved_selector") == _APPROVED_SELECTORS.get(
            signature.get("kernel_signature_id")
        )
        and policy.get("disable_extra_suffixes") is True
        and origins.get("external_clock_control") == "collection_wrapper_observed"
        and policy.get("external_clock_control") == {
            "controller": "jetson_clocks", "state": "locked",
        }
        and _valid_telemetry_policy(policy.get("telemetry"))
        and _valid_120w_operating_point(context.run)
        and (
            section_mode != _WARP_MODE
            or valid_warp_trigger(policy.get("warp_trigger"))
        )
    )
    if not (legacy_valid or locked_valid):
        raise SourceFormatError(f"{context.source_label}: invalid NCU policy")
    expected_signature = {
        "kernel_signature_id", "label_sanitized", "function_family",
        "implementation_family", "precision_path", "classification_method",
        "classification_confidence", "missing",
    }
    if set(signature) != expected_signature:
        raise SourceFormatError(f"{context.source_label}: invalid NCU policy")


def _valid_telemetry_policy(value: object) -> bool:
    if not isinstance(value, Mapping) or set(value) != set(_TELEMETRY_UNITS):
        return False
    for name, unit in _TELEMETRY_UNITS.items():
        summary = value.get(name)
        if not isinstance(summary, Mapping):
            return False
        if summary.get("origin") != _TELEMETRY_ORIGINS[name]:
            return False
        if set(summary) == {"missing_reason", "origin"}:
            if summary.get("missing_reason") != "unavailable_from_tool":
                return False
            continue
        if (
            set(summary) != {
                "statistic", "value", "unit", "sample_count", "origin",
            }
            or summary.get("statistic") not in {"mean", "max"}
            or summary.get("unit") != unit
            or not _nonnegative_number(summary.get("value"))
            or not isinstance(summary.get("sample_count"), int)
            or isinstance(summary.get("sample_count"), bool)
            or summary["sample_count"] < 1
            or name == "observed_gpu_frequency"
            and summary["sample_count"] != 1
        ):
            return False
    return True


def _valid_120w_operating_point(run: object) -> bool:
    if not isinstance(run, Mapping):
        return False
    operating_point = run.get("operating_point")
    return (
        isinstance(operating_point, Mapping)
        and operating_point.get("power_mode") in {"120W", "120w-mode-1"}
        and operating_point.get("clock_policy") == "jetson_clocks_locked"
        and operating_point.get("throttle_status") == "unknown"
    )


def _nonnegative_number(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and value >= 0
        and value == value
        and value not in {float("inf"), float("-inf")}
    )


def _reader_metrics(section_mode: str) -> tuple[str, ...]:
    if section_mode == "section_set":
        return tuple(dict.fromkeys((*NCU_READER_METRICS, *SECTION_READER_METRICS, *SCHEDULER_READER_METRICS)))
    if section_mode == _SCHEDULER_MODE:
        return (
            *SCHEDULER_DIRECT_READER_METRICS,
            *MEMORY_WORKLOAD_READER_METRICS,
            *LAUNCH_READER_METRICS,
            SECTION_READER_METRICS[0],
            *SCHEDULER_READER_METRICS,
            *SYSMEM_SECTOR_READER_METRICS,
        )
    if section_mode == _WARP_MODE:
        return (
            "gpu__time_duration.sum",
            "sm__throughput.avg.pct_of_peak_sustained_elapsed",
            *LAUNCH_READER_METRICS,
            SECTION_READER_METRICS[0],
            *WARP_STATE_READER_METRICS,
        )
    return NCU_READER_METRICS


def _required_reader_metrics(section_mode: str) -> tuple[str, ...]:
    if section_mode == "custom_metric_set_12":
        return _reader_metrics(section_mode)
    required = (
        "gpu__time_duration.sum",
        *REQUIRED_LAUNCH_READER_METRICS,
    )
    if section_mode == _SCHEDULER_MODE:
        return (*required, *SYSMEM_SECTOR_READER_METRICS)
    return required


def _session_facts(
    payload: str,
    context: ProfilerImportContext,
    policy: Mapping[str, object],
) -> dict[str, object]:
    rows = _csv_rows(payload, context, "session")
    versions = [
        row[1] for row in rows
        if len(row) >= 2 and row[0] == "Nsight Compute Target"
    ]
    commands = [
        row[1] for row in rows
        if len(row) >= 2 and row[0] == "Profiler Command Line"
    ]
    if len(versions) != 1 or len(commands) != 1:
        raise SourceFormatError(f"{context.source_label}: invalid NCU session page row 1")
    match = re.match(r"^(\d+\.\d+\.\d+\.\d+)(?:\s|$)", versions[0])
    if match is None:
        raise SourceFormatError(f"{context.source_label}: invalid NCU session page row 1")
    tool_version = match.group(1)
    try:
        tokens = shlex.split(commands[0])
    except ValueError as error:
        raise SourceFormatError(
            f"{context.source_label}: invalid NCU session page row 1"
        ) from error

    if _option_values(tokens, "--set"):
        raise SourceFormatError(f"{context.source_label}: invalid NCU section selection")

    kernel_ids = _option_values(tokens, "--kernel-id")
    kernel_names = _option_values(tokens, "--kernel-name", "-k")
    launch_counts = _option_values(tokens, "--launch-count", "-c")
    launch_skips = _option_values(tokens, "--launch-skip", "-s")
    if len(launch_counts) != 1 or _positive_option_integer(
        launch_counts[0], context
    ) != 1:
        raise SourceFormatError(f"{context.source_label}: invalid NCU selection")
    if len(kernel_ids) == 1 and not kernel_names and not launch_skips:
        selection = "explicit_invocation"
        population = "one_explicitly_selected_replayed_launch"
    elif (
        len(kernel_names) == 1
        and not kernel_ids
        and (not launch_skips or (
            len(launch_skips) == 1
            and _positive_option_integer(launch_skips[0], context) > 0
        ))
    ):
        selection = "name_filter_selected_match"
        population = "one_name_filtered_selected_match_replayed_launch"
    else:
        raise SourceFormatError(f"{context.source_label}: invalid NCU selection")

    replay_mode, replay_origin = _controlled_option(
        tokens, "--replay-mode", None, "kernel", tool_version, context
    )
    cache_control, cache_origin = _controlled_option(
        tokens, "--cache-control", None, "all", tool_version, context
    )
    clock_control, clock_origin = _controlled_option(
        tokens, "--clock-control", None, "base", tool_version, context
    )
    sections = _option_values(tokens, "--section")
    metric_sets = _option_values(tokens, "--metrics")
    disable_extra_suffixes = tokens.count("--disable-extra-suffixes") == 1
    explicit_metrics = (
        [item.strip() for item in metric_sets[0].split(",")]
        if len(metric_sets) == 1
        else []
    )
    if (
        (set(sections) == _LEGACY_SECTION_SET and len(sections) == len(_LEGACY_SECTION_SET)
         or tuple(sections) == _SCHEDULER_SECTION_ORDER)
        and not metric_sets
    ):
        section_mode = "section_set"
    elif len(metric_sets) == 1 and not sections:
        section_mode = "custom_metric_set_12"
    elif (
        tuple(sections) == _SCHEDULER_SECTION_ORDER
        and tuple(explicit_metrics) == SYSMEM_SECTOR_READER_METRICS
        and disable_extra_suffixes
    ):
        section_mode = _SCHEDULER_MODE
    elif (
        tuple(sections) == _WARP_SECTION_ORDER
        and not metric_sets
        and disable_extra_suffixes
    ):
        section_mode = _WARP_MODE
    else:
        raise SourceFormatError(f"{context.source_label}: invalid NCU section selection")
    if section_mode in _LOCKED_SECTION_MODES:
        _validate_locked_command(tokens, policy, context)
    return {
        "tool_version": tool_version,
        "selection_policy": selection,
        "population": population,
        "section_mode": section_mode,
        "replay_mode": replay_mode,
        "cache_control_request": cache_control,
        "clock_control_request": clock_control,
        "disable_extra_suffixes": disable_extra_suffixes,
        "origins": {
            "selection_policy": "session_command",
            "replay_mode": replay_origin,
            "cache_control_request": cache_origin,
            "clock_control_request": clock_origin,
        },
    }


def _validate_locked_command(
    tokens: Sequence[str],
    policy: Mapping[str, object],
    context: ProfilerImportContext,
) -> None:
    for long, short, expected in _LOCKED_REQUIRED_OPTIONS:
        if (
            _option_values(tokens, long, short) != [expected]
            or tokens.count(long) != 1
        ):
            raise SourceFormatError(
                f"{context.source_label}: invalid locked NCU command"
            )
    if (
        tokens.count("--disable-extra-suffixes") != 1
        or any(_option_values(tokens, option) for option in _LOCKED_DENIED_OPTIONS)
    ):
        raise SourceFormatError(
            f"{context.source_label}: invalid locked NCU command"
        )

    approved = policy.get("approved_selector")
    if not isinstance(approved, Mapping):
        raise SourceFormatError(
            f"{context.source_label}: invalid locked NCU selector"
        )
    kernel_ids = _option_values(tokens, "--kernel-id")
    kernel_names = _option_values(tokens, "--kernel-name", "-k")
    launch_skips = _option_values(tokens, "--launch-skip", "-s")
    if approved.get("kind") == "kernel_id":
        valid = (
            kernel_ids == [approved.get("value")]
            and tokens.count("--kernel-id") == 1
            and not kernel_names
            and not launch_skips
        )
    else:
        valid = (
            kernel_names == [approved.get("value")]
            and tokens.count("--kernel-name") == 1
            and not kernel_ids
            and launch_skips == [str(approved.get("launch_skip"))]
            and tokens.count("--launch-skip") == 1
        )
    if not valid:
        raise SourceFormatError(
            f"{context.source_label}: invalid locked NCU selector"
        )


def _option_values(tokens: Sequence[str], long: str, short: str | None = None) -> list[str]:
    names = {long, *(item for item in (short,) if item is not None)}
    values: list[str] = []
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token in names:
            if index + 1 >= len(tokens) or tokens[index + 1].startswith("-"):
                return [*values, ""]
            values.append(tokens[index + 1])
            index += 2
            continue
        prefixes = [f"{long}=", *(f"{short}=" for short in (short,) if short)]
        for prefix in prefixes:
            if token.startswith(prefix):
                values.append(token[len(prefix):])
                break
        index += 1
    return values


def _positive_option_integer(value: str, context: ProfilerImportContext) -> int:
    try:
        result = int(value)
    except ValueError as error:
        raise SourceFormatError(f"{context.source_label}: invalid NCU selection") from error
    if result < 1:
        raise SourceFormatError(f"{context.source_label}: invalid NCU selection")
    return result


def _controlled_option(
    tokens: Sequence[str], long: str, short: str | None, default: str,
    tool_version: str, context: ProfilerImportContext,
) -> tuple[str, str]:
    values = _option_values(tokens, long, short)
    if len(values) > 1:
        raise SourceFormatError(f"{context.source_label}: invalid NCU collection option")
    if values:
        return values[0], "session_command"
    if tool_version != _CLI_DEFAULT_VERSION:
        raise SourceFormatError(f"{context.source_label}: unsupported NCU CLI defaults")
    return default, "ncu_cli_default_2025_3"


def _verify_collection_facts(
    context: ProfilerImportContext,
    policy: Mapping[str, object],
    facts: Mapping[str, object],
) -> None:
    origins = policy["origins"]
    assert isinstance(origins, Mapping)
    for field in ("replay_mode", "cache_control_request", "clock_control_request"):
        fact_origins = facts["origins"]
        assert isinstance(fact_origins, Mapping)
        if policy[field] != facts[field] or origins[field] != fact_origins[field]:
            raise SourceFormatError(f"{context.source_label}: NCU collection metadata mismatch")
    if policy["section_mode"] != facts["section_mode"]:
        raise SourceFormatError(f"{context.source_label}: NCU collection metadata mismatch")
    if (
        policy["section_mode"] in _LOCKED_SECTION_MODES
        and policy["disable_extra_suffixes"] != facts["disable_extra_suffixes"]
    ):
        raise SourceFormatError(f"{context.source_label}: NCU collection metadata mismatch")


def _csv_rows(payload: str, context: ProfilerImportContext, page: str) -> list[list[str]]:
    if not isinstance(payload, str):
        raise SourceFormatError(f"{context.source_label}: invalid NCU {page} page row 1")
    try:
        return list(csv.reader(io.StringIO(payload)))
    except csv.Error as error:
        raise SourceFormatError(
            f"{context.source_label}: invalid NCU {page} page row 1"
        ) from error


def _validate_raw_units(
    payload: str, context: ProfilerImportContext, section_mode: str
) -> None:
    rows = _csv_rows(payload, context, "raw")
    if len(rows) < 2 or len(rows[1]) > len(rows[0]):
        raise SourceFormatError(f"{context.source_label}: invalid NCU raw page row 2")
    units = [*rows[1], *("" for _ in range(len(rows[0]) - len(rows[1])))]
    for column, (name, unit) in enumerate(zip(rows[0], units)):
        expected = _EXPECTED_RAW_UNITS.get(name)
        has_numeric_value = (
            section_mode in _LOCKED_SECTION_MODES
            and expected is not None
            and any(
                _optional_number(
                    row[column] if column < len(row) else None,
                    context,
                    "raw",
                    row_index,
                ) is not None
                for row_index, row in enumerate(rows[2:], start=3)
            )
        )
        if (unit or has_numeric_value) and unit != expected:
            raise SourceFormatError(
                f"{context.source_label}: invalid NCU raw unit for {name}"
            )


def _dict_rows(
    payload: str, context: ProfilerImportContext, page: str,
    reader_metrics: Sequence[str] = NCU_READER_METRICS,
) -> list[dict[str, str]]:
    rows = _csv_rows(payload, context, page)
    if not rows or len(rows[0]) != len(set(rows[0])):
        raise SourceFormatError(f"{context.source_label}: invalid NCU {page} page row 1")
    header = rows[0]
    required = set(_IDENTITY_COLUMNS)
    if not required.issubset(header):
        raise SourceFormatError(f"{context.source_label}: invalid NCU {page} page row 1")
    if page == "raw" and not set(reader_metrics).issubset(header):
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


def _optional_number(
    value: object, context: ProfilerImportContext, page: str, row: int
) -> float | None:
    if value is None or isinstance(value, str) and (
        not value.strip()
        or value.strip().lower() in {"n/a", "na", "not available"}
    ):
        return None
    return _number(value, context, page, row)


def _required_number(
    value: float | None, context: ProfilerImportContext
) -> float:
    if value is None:
        raise SourceFormatError(f"{context.source_label}: invalid NCU raw page row 1")
    return value


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


def _dimension(value: object) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 3
        and all(
            isinstance(item, int) and not isinstance(item, bool) and item > 0
            for item in value
        )
    )


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
    values: Mapping[str, float | None],
    capture_id: str,
    run_id: str,
    source_id: str,
    observation_id: str,
    context: ProfilerImportContext,
    policy: Mapping[str, object],
) -> list[dict[str, object]]:
    metrics: list[dict[str, object]] = []
    section_mode = policy["section_mode"]
    if section_mode in _LEGACY_SECTION_MODES:
        metric_names = [*DIRECT_METRIC_NAMES]
    elif section_mode == _SCHEDULER_MODE:
        metric_names = [
            *SCHEDULER_DIRECT_METRIC_NAMES,
            "gpc_cycle_rate_hz",
            *SCHEDULER_METRIC_NAMES,
            *SYSMEM_SECTOR_METRIC_NAMES,
        ]
    else:
        metric_names = [
            "kernel_duration",
            "sm_throughput_pct_of_peak_sustained_elapsed",
            "gpc_cycle_rate_hz",
            *WARP_STATE_METRIC_NAMES,
        ]
    if section_mode == "section_set":
        metric_names.extend((
            "gpc_cycle_rate_hz",
            "sm_cycle_rate_hz",
            "tensor_path_fp4_fp6_fp8_to_fp32_dense_pct_of_peak_elapsed",
            *SCHEDULER_METRIC_NAMES,
        ))
    for metric_name in metric_names:
        spec = METRIC_REGISTRY[metric_name]
        raw_counter = spec["raw_counter_name"]
        assert isinstance(raw_counter, str)
        section = (
            "custom_metric_set_12"
            if section_mode == "custom_metric_set_12"
            else spec["sections"][0]
        )
        raw_value = values.get(raw_counter)
        value: float | int | None = raw_value
        if raw_value is not None and (
            metric_name == "kernel_duration" or spec["unit"] == "sector"
        ):
            value = _integer(value, context, "raw", 1)
        metrics.append({
            "metric_id": profiler_record_id("metric", context, len(metrics) + 1),
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
            "confidence": "medium" if value is not None else "unknown",
            "missing_reason": (
                None if value is not None else "counter_absent_from_report"
            ),
        })
    missing_metrics = tuple((name, reason) for name, reason in EXPLICIT_MISSING_METRICS if name not in metric_names)
    if section_mode == _SCHEDULER_MODE:
        missing_metrics = (
            ("system_memory_throughput_pct_of_ceiling", "counter_absent_from_report"),
            ("system_memory_bytes", "counter_absent_from_report"),
        )
    elif section_mode == _WARP_MODE:
        missing_metrics = ()
    for metric_name, missing_reason in missing_metrics:
        spec = METRIC_REGISTRY[metric_name]
        metrics.append({
            "metric_id": profiler_record_id("metric", context, len(metrics) + 1),
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


def _telemetry(
    capture_id: str,
    run_id: str,
    source_id: str,
    operating_point: Mapping[str, object],
    context: ProfilerImportContext,
    policy: Mapping[str, object],
    values: Mapping[str, float | None],
) -> list[dict[str, object]]:
    policy_telemetry = policy.get("telemetry")
    if not isinstance(policy_telemetry, Mapping):
        return [{
            "telemetry_id": profiler_record_id("telemetry", context, 1),
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
        }]

    records: list[dict[str, object]] = []
    for metric_name in _TELEMETRY_UNITS:
        evidence = policy_telemetry[metric_name]
        assert isinstance(evidence, Mapping)
        missing_reason = evidence.get("missing_reason")
        if metric_name == "observed_gpu_frequency":
            gpc_hz = values.get("gpc__cycles_elapsed.avg.per_second")
            expected_mhz = gpc_hz / 1_000_000 if gpc_hz is not None else None
            reported_mhz = evidence.get("value")
            if (
                expected_mhz is None and missing_reason is None
                or expected_mhz is not None
                and (
                    not _nonnegative_number(reported_mhz)
                    or abs(float(reported_mhz) - expected_mhz) > 1e-6
                )
            ):
                raise SourceFormatError(
                    f"{context.source_label}: NCU telemetry does not match report"
                )
        record: dict[str, object] = {
            "telemetry_id": profiler_record_id(
                "telemetry", context, len(records) + 1
            ),
            "run_id": run_id,
            "capture_id": capture_id,
            "source_id": source_id,
            "operating_point_id": operating_point["operating_point_id"],
            "record_kind": "sampled_series",
            "alignment": "same_run_unaligned",
            "window": None,
            "metric_name": metric_name,
            "samples": [],
            "summary": None,
            "evidence_semantics": "observed_samples",
            "measurement_source": evidence["origin"],
            "missing_reason": missing_reason,
        }
        if missing_reason is None:
            record["record_kind"] = "sampled_summary"
            record["summary"] = {
                "statistic": evidence["statistic"],
                "value": evidence["value"],
                "unit": evidence["unit"],
                "sample_count": evidence["sample_count"],
            }
        records.append(record)
    return records
