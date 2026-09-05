from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass

from extractors.common import (
    ImportContext,
    SourceFormatError,
    record_id,
    validate_source_label,
)


@dataclass(frozen=True)
class ProfilerImportContext(ImportContext):
    run: dict
    capture_label: str
    signature_policy_id: str
    window_policy_id: str

    def __post_init__(self) -> None:
        validate_source_label(self.source_label)
        validate_source_label(self.capture_label)
        if not self.signature_policy_id or not self.window_policy_id:
            raise ValueError("profiler policy IDs must be non-empty")


def profiler_record_id(
    kind: str, context: ProfilerImportContext, index: int
) -> str:
    """Keep first-run IDs stable and scope later child IDs by run ordinal."""
    run_id = context.run.get("run_id") if isinstance(context.run, Mapping) else None
    match = re.fullmatch(
        rf"run-{re.escape(context.source_label)}-(\d{{3}})",
        run_id if isinstance(run_id, str) else "",
    )
    if match is None:
        raise SourceFormatError(f"{context.source_label}: invalid caller run")
    run_ordinal = match.group(1)
    if run_ordinal == "000":
        raise SourceFormatError(f"{context.source_label}: invalid caller run")
    if kind == "capture":
        if index != 1:
            raise ValueError("a profiler run has exactly one capture")
        return f"capture-{context.source_label}-{run_ordinal}"
    if run_ordinal == "001":
        return record_id(kind, context, index)
    if index < 1:
        raise ValueError("record index must be positive")
    return f"{kind}-{context.source_label}-{run_ordinal}-{index:03d}"


RAW_COUNTER_REGISTRY: dict[str, dict[str, str]] = {
    "gpu__time_duration.sum": {"unit": "ns", "kind": "metric"},
    "sm__throughput.avg.pct_of_peak_sustained_elapsed": {
        "unit": "percent", "kind": "metric",
    },
    "sm__pipe_tensor_cycles_active.avg.pct_of_peak_sustained_elapsed": {
        "unit": "percent", "kind": "metric",
    },
    "gpu__compute_memory_throughput.avg.pct_of_peak_sustained_elapsed": {
        "unit": "percent", "kind": "metric",
    },
    "l1tex__throughput.avg.pct_of_peak_sustained_active": {
        "unit": "percent", "kind": "metric",
    },
    "lts__throughput.avg.pct_of_peak_sustained_elapsed": {
        "unit": "percent", "kind": "metric",
    },
    "lts__d_sectors_fill_sysmem.avg.pct_of_peak_sustained_elapsed": {
        "unit": "percent", "kind": "metric",
    },
    "sm__maximum_warps_per_active_cycle_pct": {
        "unit": "percent", "kind": "metric",
    },
    "sm__warps_active.avg.pct_of_peak_sustained_active": {
        "unit": "percent", "kind": "metric",
    },
    "gpc__cycles_elapsed.avg.per_second": {"unit": "hz", "kind": "metric"},
    "sm__cycles_elapsed.avg.per_second": {"unit": "hz", "kind": "metric"},
    "sm__ops_path_tensor_op_utcqmma_src_fp4_fp6_fp8_dst_fp32_sparsity_off.avg.pct_of_peak_sustained_elapsed": {
        "unit": "percent", "kind": "metric",
    },
    "smsp__issue_active.avg.per_cycle_active": {
        "unit": "instruction_per_cycle", "kind": "metric",
    },
    "smsp__issue_active.avg.pct_of_peak_sustained_active": {
        "unit": "percent", "kind": "metric",
    },
    "smsp__issue_inst0.avg.pct_of_peak_sustained_active": {
        "unit": "percent", "kind": "metric",
    },
    "smsp__warps_active.avg.per_cycle_active": {
        "unit": "warp", "kind": "metric",
    },
    "smsp__warps_eligible.avg.per_cycle_active": {
        "unit": "warp", "kind": "metric",
    },
    "smsp__maximum_warps_avg_per_active_cycle": {
        "unit": "warp", "kind": "metric",
    },
    "smsp__warps_active.avg.peak_sustained": {
        "unit": "warp", "kind": "metric",
    },
    "lts__d_sectors_fill_sysmem.sum": {"unit": "sector", "kind": "metric"},
    "lts__t_sectors_aperture_sysmem_op_write.sum": {
        "unit": "sector", "kind": "metric",
    },
    "lts__t_sectors_srcunit_tex_aperture_sysmem_lookup_miss.sum": {
        "unit": "sector", "kind": "metric",
    },
    "smsp__average_warp_latency_per_inst_issued.ratio": {
        "unit": "cycles_per_instruction", "kind": "metric",
    },
    "smsp__average_warps_issue_stalled_long_scoreboard_per_issue_active.ratio": {
        "unit": "cycles_per_instruction", "kind": "metric",
    },
    "smsp__average_warps_issue_stalled_short_scoreboard_per_issue_active.ratio": {
        "unit": "cycles_per_instruction", "kind": "metric",
    },
    "launch__waves_per_multiprocessor": {"unit": "count", "kind": "launch"},
    "launch__grid_dim_x": {"unit": "count", "kind": "launch"},
    "launch__grid_dim_y": {"unit": "count", "kind": "launch"},
    "launch__grid_dim_z": {"unit": "count", "kind": "launch"},
    "launch__block_dim_x": {"unit": "count", "kind": "launch"},
    "launch__block_dim_y": {"unit": "count", "kind": "launch"},
    "launch__block_dim_z": {"unit": "count", "kind": "launch"},
    "launch__grid_size": {"unit": "count", "kind": "launch"},
    "launch__block_size": {"unit": "count", "kind": "launch"},
    "launch__registers_per_thread": {"unit": "count", "kind": "launch"},
    "launch__shared_mem_per_block": {"unit": "byte", "kind": "launch"},
    "launch__shared_mem_per_block_static": {"unit": "byte", "kind": "launch"},
    "launch__shared_mem_per_block_dynamic": {"unit": "byte", "kind": "launch"},
}


METRIC_REGISTRY: dict[str, dict[str, object]] = {
    "kernel_duration": {
        "unit": "ns",
        "basis": "per_profiled_launch",
        "raw_counter_name": "gpu__time_duration.sum",
        "sections": ("SpeedOfLight", "custom_metric_set_12"),
    },
    "sm_throughput_pct_of_peak_sustained_elapsed": {
        "unit": "percent",
        "basis": "per_profiled_launch",
        "raw_counter_name": "sm__throughput.avg.pct_of_peak_sustained_elapsed",
        "sections": ("SpeedOfLight", "custom_metric_set_12"),
    },
    "tensor_cycles_active_pct_of_peak_sustained_elapsed": {
        "unit": "percent",
        "basis": "per_profiled_launch",
        "raw_counter_name": "sm__pipe_tensor_cycles_active.avg.pct_of_peak_sustained_elapsed",
        "sections": (
            "SpeedOfLight_HierarchicalTensorRooflineChart",
            "custom_metric_set_12",
        ),
    },
    "memory_sol_pct_of_peak_sustained_elapsed": {
        "unit": "percent",
        "basis": "per_profiled_launch",
        "raw_counter_name": "gpu__compute_memory_throughput.avg.pct_of_peak_sustained_elapsed",
        "sections": ("SpeedOfLight", "custom_metric_set_12"),
    },
    "l1_throughput_pct_of_peak_sustained_active": {
        "unit": "percent",
        "basis": "per_profiled_launch",
        "raw_counter_name": "l1tex__throughput.avg.pct_of_peak_sustained_active",
        "sections": ("SpeedOfLight", "custom_metric_set_12"),
    },
    "l2_throughput_pct_of_peak_sustained_elapsed": {
        "unit": "percent",
        "basis": "per_profiled_launch",
        "raw_counter_name": "lts__throughput.avg.pct_of_peak_sustained_elapsed",
        "sections": ("SpeedOfLight", "custom_metric_set_12"),
    },
    "l2_sysmem_fill_pct_of_peak_sustained_elapsed": {
        "unit": "percent",
        "basis": "per_profiled_launch",
        "raw_counter_name": "lts__d_sectors_fill_sysmem.avg.pct_of_peak_sustained_elapsed",
        "sections": ("MemoryWorkloadAnalysis", "custom_metric_set_12"),
    },
    "theoretical_occupancy_percent": {
        "unit": "percent",
        "basis": "per_profiled_launch",
        "raw_counter_name": "sm__maximum_warps_per_active_cycle_pct",
        "sections": ("Occupancy", "custom_metric_set_12"),
    },
    "achieved_occupancy_percent": {
        "unit": "percent",
        "basis": "per_profiled_launch",
        "raw_counter_name": "sm__warps_active.avg.pct_of_peak_sustained_active",
        "sections": ("Occupancy", "custom_metric_set_12"),
    },
    "gpc_cycle_rate_hz": {
        "unit": "hz",
        "basis": "per_profiled_launch",
        "raw_counter_name": "gpc__cycles_elapsed.avg.per_second",
        "sections": ("SpeedOfLight",),
    },
    "sm_cycle_rate_hz": {
        "unit": "hz",
        "basis": "per_profiled_launch",
        "raw_counter_name": "sm__cycles_elapsed.avg.per_second",
        "sections": ("SpeedOfLight_HierarchicalTensorRooflineChart",),
    },
    "tensor_path_fp4_fp6_fp8_to_fp32_dense_pct_of_peak_elapsed": {
        "unit": "percent",
        "basis": "per_profiled_launch",
        "raw_counter_name": "sm__ops_path_tensor_op_utcqmma_src_fp4_fp6_fp8_dst_fp32_sparsity_off.avg.pct_of_peak_sustained_elapsed",
        "sections": ("SpeedOfLight_HierarchicalTensorRooflineChart",),
    },
    "system_memory_throughput_pct_of_ceiling": {
        "unit": "percent", "basis": "per_profiled_launch",
        "raw_counter_name": None, "sections": ("MemoryWorkloadAnalysis",),
    },
    "system_memory_bytes": {
        "unit": "byte", "basis": "per_profiled_launch",
        "raw_counter_name": None, "sections": ("MemoryWorkloadAnalysis",),
    },
    "scheduler_issue_active_percent": {
        "unit": "percent", "basis": "per_profiled_launch",
        "raw_counter_name": None, "sections": ("SchedulerStats",),
    },
    "scheduler_issue_active_per_active_cycle": {
        "unit": "instruction_per_cycle", "basis": "per_profiled_launch",
        "raw_counter_name": "smsp__issue_active.avg.per_cycle_active",
        "sections": ("SchedulerStats",),
    },
    "scheduler_issue_inst0_percent": {
        "unit": "percent", "basis": "per_profiled_launch",
        "raw_counter_name": "smsp__issue_inst0.avg.pct_of_peak_sustained_active",
        "sections": ("SchedulerStats",),
    },
    "scheduler_issue_active_pct_of_peak_sustained_active": {
        "unit": "percent", "basis": "per_profiled_launch",
        "raw_counter_name": "smsp__issue_active.avg.pct_of_peak_sustained_active",
        "sections": ("SchedulerStats",),
    },
    "scheduler_active_warps_per_active_cycle": {
        "unit": "warp", "basis": "per_profiled_launch",
        "raw_counter_name": "smsp__warps_active.avg.per_cycle_active",
        "sections": ("SchedulerStats",),
    },
    "scheduler_eligible_warps_per_active_cycle": {
        "unit": "warp", "basis": "per_profiled_launch",
        "raw_counter_name": "smsp__warps_eligible.avg.per_cycle_active",
        "sections": ("SchedulerStats",),
    },
    "scheduler_maximum_warps_per_active_cycle": {
        "unit": "warp", "basis": "per_profiled_launch",
        "raw_counter_name": "smsp__maximum_warps_avg_per_active_cycle",
        "sections": ("SchedulerStats",),
    },
    "scheduler_warps_active_peak_sustained": {
        "unit": "warp", "basis": "per_profiled_launch",
        "raw_counter_name": "smsp__warps_active.avg.peak_sustained",
        "sections": ("SchedulerStats",),
    },
    "l2_sysmem_fill_sectors": {
        "unit": "sector", "basis": "per_profiled_launch",
        "raw_counter_name": "lts__d_sectors_fill_sysmem.sum",
        "sections": ("explicit_sysmem_sector_metrics",),
    },
    "l2_sysmem_write_sectors": {
        "unit": "sector", "basis": "per_profiled_launch",
        "raw_counter_name": "lts__t_sectors_aperture_sysmem_op_write.sum",
        "sections": ("explicit_sysmem_sector_metrics",),
    },
    "l2_sysmem_lookup_miss_sectors": {
        "unit": "sector", "basis": "per_profiled_launch",
        "raw_counter_name": "lts__t_sectors_srcunit_tex_aperture_sysmem_lookup_miss.sum",
        "sections": ("explicit_sysmem_sector_metrics",),
    },
    "average_warp_latency_cycles_per_issued_instruction": {
        "unit": "cycles_per_instruction", "basis": "per_profiled_launch",
        "raw_counter_name": "smsp__average_warp_latency_per_inst_issued.ratio",
        "sections": ("WarpStateStats",),
    },
    "long_scoreboard_cycles_per_issued_instruction": {
        "unit": "cycles_per_instruction", "basis": "per_profiled_launch",
        "raw_counter_name": "smsp__average_warps_issue_stalled_long_scoreboard_per_issue_active.ratio",
        "sections": ("WarpStateStats",),
    },
    "short_scoreboard_cycles_per_issued_instruction": {
        "unit": "cycles_per_instruction", "basis": "per_profiled_launch",
        "raw_counter_name": "smsp__average_warps_issue_stalled_short_scoreboard_per_issue_active.ratio",
        "sections": ("WarpStateStats",),
    },
    "warp_stall_long_scoreboard_percent": {
        "unit": "percent", "basis": "per_profiled_launch",
        "raw_counter_name": None, "sections": ("WarpStateStats",),
    },
    "warp_stall_short_scoreboard_percent": {
        "unit": "percent", "basis": "per_profiled_launch",
        "raw_counter_name": None, "sections": ("WarpStateStats",),
    },
    "source_counter_attribution": {
        "unit": "count", "basis": "per_profiled_launch",
        "raw_counter_name": None, "sections": ("SourceCounters",),
    },
}


DIRECT_METRIC_NAMES = tuple(list(METRIC_REGISTRY)[:9])
SCHEDULER_METRIC_NAMES = (
    "scheduler_issue_active_per_active_cycle",
    "scheduler_issue_active_pct_of_peak_sustained_active",
    "scheduler_issue_inst0_percent",
    "scheduler_active_warps_per_active_cycle",
    "scheduler_eligible_warps_per_active_cycle",
    "scheduler_maximum_warps_per_active_cycle",
    "scheduler_warps_active_peak_sustained",
)
SYSMEM_SECTOR_METRIC_NAMES = (
    "l2_sysmem_fill_sectors",
    "l2_sysmem_write_sectors",
    "l2_sysmem_lookup_miss_sectors",
)
WARP_STATE_METRIC_NAMES = (
    "average_warp_latency_cycles_per_issued_instruction",
    "long_scoreboard_cycles_per_issued_instruction",
    "short_scoreboard_cycles_per_issued_instruction",
)
EXPLICIT_MISSING_METRICS: tuple[tuple[str, str], ...] = (
    ("system_memory_throughput_pct_of_ceiling", "counter_absent_from_report"),
    ("system_memory_bytes", "counter_absent_from_report"),
    ("scheduler_issue_active_percent", "section_not_collected"),
    ("warp_stall_long_scoreboard_percent", "section_not_collected"),
    ("warp_stall_short_scoreboard_percent", "section_not_collected"),
    ("source_counter_attribution", "section_not_collected"),
)


def require_profiler_run(context: ProfilerImportContext, tool: str) -> Mapping:
    run = context.run
    if not isinstance(run, Mapping):
        raise SourceFormatError(f"{context.source_label}: invalid caller run")
    if (
        run.get("capture_method") != tool
        or run.get("evidence") != "measured_local"
        or run.get("source_id") != context.source_id
        or run.get("system_id") != context.system_id
    ):
        raise SourceFormatError(f"{context.source_label}: invalid caller run")
    for field in ("run_id", "runtime_id", "model_id", "operating_point"):
        if field not in run:
            raise SourceFormatError(f"{context.source_label}: invalid caller run")
    return run
