from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from extractors.common import ImportContext, SourceFormatError, validate_source_label


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
