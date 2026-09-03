from __future__ import annotations

import copy
from collections.abc import Iterable, Mapping

from extractors.common import (
    ImportContext,
    SourceFormatError,
    nonnegative_integer,
    record_id,
    require_measured_system,
    source_record,
    statistics,
)
from extractors.flashrt import _run, _unknown_operating_point


STAGE_KEYS = {
    "fixed_prefix_span_ms": "fixed-prefix",
    "prefix_prefill_ms": "prefix-prefill",
    "denoise_aggregate_ms": "denoise",
    "outside_fixed_prefix_and_denoise_ms": "outside-prefix-denoise",
}


def import_lerobot_shape(
    records: Iterable[Mapping], context: ImportContext
) -> dict[str, object]:
    require_measured_system(context)
    active: dict[str, object] | None = None
    runs: list[dict[str, object]] = []
    end_to_end: list[dict[str, object]] = []
    stages: list[dict[str, object]] = []
    for raw_source in records:
        source = source_record(raw_source, context)
        record_type = source.get("record")
        if record_type == "run":
            active = normalize_lerobot_context(source, context)
        elif record_type == "timing":
            if active is None:
                raise SourceFormatError(f"{context.source_label}: timing before run")
            run, e2e, normalized_stages = normalize_lerobot_timing(
                active, source, context, len(runs) + 1, len(stages) + 1
            )
            runs.append(run)
            end_to_end.append(e2e)
            stages.extend(normalized_stages)
        elif record_type == "complete":
            active = None
    return {
        "bundle_version": "1.0.0",
        "source_label": context.source_label,
        "datasets": {"runs": runs, "end_to_end": end_to_end, "stages": stages},
    }


def normalize_lerobot_context(
    source: Mapping[str, object], context: ImportContext
) -> dict[str, object]:
    if source.get("model_family") != "smolvla":
        raise SourceFormatError(f"{context.source_label}: invalid run record")
    return {
        "model_id": "smolvla",
        "model_artifact_id": "smolvla-lerobot-local-01",
        "num_steps": nonnegative_integer(source.get("num_steps"), context, "run"),
        "action_chunk": nonnegative_integer(source.get("action_chunk_size"), context, "run"),
        "repetitions": nonnegative_integer(source.get("repetitions_per_case"), context, "run"),
        "precision": _precision_bf16_fp32(),
    }


def normalize_lerobot_timing(
    active: Mapping[str, object], source: Mapping[str, object], context: ImportContext,
    run_index: int, stage_index: int,
) -> tuple[dict[str, object], dict[str, object], list[dict[str, object]]]:
    output_shape = source.get("output_shape")
    if not isinstance(output_shape, list) or not output_shape:
        raise SourceFormatError(f"{context.source_label}: invalid timing record")
    workload = {
        "common": {
            "batch_size": 1,
            "input_contract_id": "deterministic-preprocessed-observation",
            "output_contract_id": "action-chunk",
        },
        "vla": {
            "camera_views": nonnegative_integer(source.get("num_views"), context, "timing"),
            "image_height": 224,
            "image_width": 224,
            "semantic_prompt_tokens": nonnegative_integer(
                source.get("semantic_prompt_tokens"), context, "timing"
            ),
            "executed_prompt_tokens": nonnegative_integer(
                source.get("executed_prompt_tokens"), context, "timing"
            ),
            "action_dimension": nonnegative_integer(output_shape[-1], context, "timing"),
            "action_chunk": active["action_chunk"],
            "denoise_steps": active["num_steps"],
        },
    }
    timing = {
        "timing_boundary_id": "predict_action_chunk_preprocessed",
        "state_reuse": "fixed_prompt_and_noise",
        "warm_policy": "steady_state",
    }
    run_id = record_id("run", context, run_index)
    run = _run(
        run_id, active, context, workload, copy.deepcopy(active["precision"]), timing,
        _unknown_operating_point(),
        missing={
            "operating_point.power_mode": "not_collected",
            "operating_point.clock_policy": "not_collected",
            "operating_point.throttle_status": "not_collected",
        },
        runtime_id="lerobot",
    )
    e2e = {
        "measurement_id": record_id("e2e", context, run_index),
        "run_id": run_id,
        "source_id": context.source_id,
        "evidence": "measured_local",
        "measurement_method": "wall_clock",
        "metric": "latency",
        "statistics": statistics(_latency(source, "total_wall_ms", context), context),
        "sample_count": active["repetitions"],
        "percentile_method": None,
        "work_unit": "action_chunk",
        "timing_boundary_id": timing["timing_boundary_id"],
        "missing_reason": None,
    }
    normalized_stages: list[dict[str, object]] = []
    latency = source.get("latency_ms")
    if not isinstance(latency, Mapping):
        raise SourceFormatError(f"{context.source_label}: invalid timing record")
    for source_key, stage_id in STAGE_KEYS.items():
        if source_key not in latency:
            continue
        execution_count = active["num_steps"] if stage_id == "denoise" else 1
        normalized_stages.append({
            "measurement_id": record_id(
                "stage", context, stage_index + len(normalized_stages)
            ),
            "run_id": run_id,
            "source_id": context.source_id,
            "evidence": "measured_local",
            "measurement_method": "cuda_event",
            "metric": "latency",
            "statistics": statistics(latency[source_key], context),
            "sample_count": active["repetitions"],
            "percentile_method": None,
            "work_unit": "action_chunk",
            "timing_boundary_id": timing["timing_boundary_id"],
            "missing_reason": None,
            "stage_id": stage_id,
            "parent_stage_id": None,
            "aggregation": "summary",
            "additive": False,
            "execution_count": execution_count,
        })
    return run, e2e, normalized_stages


def _latency(source: Mapping[str, object], key: str, context: ImportContext) -> object:
    latency = source.get("latency_ms")
    if not isinstance(latency, Mapping) or key not in latency:
        raise SourceFormatError(f"{context.source_label}: invalid timing record")
    return latency[key]


def _precision_bf16_fp32() -> dict[str, object]:
    return {
        "precision_id": "mixed-bf16-fp32",
        "requested": "bf16",
        "weight_dtype": "mixed-bf16-fp32",
        "activation_dtype": "mixed-bf16-fp32",
        "accumulation_dtype": "fp32",
        "execution_dtype": "mixed-bf16-fp32",
        "quant_scheme": "none",
        "granularity": "none",
        "scale_zero_point_bytes": 0,
        "dequant_strategy": "none",
        "fused": False,
    }
