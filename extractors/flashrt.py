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


_MODEL_ARTIFACTS = {
    "pi0": "pi0-flashrt-local-01",
    "pi05": "pi05-flashrt-local-01",
}
_FP8_SEMANTICS = "fp8_e4m3_gemms_with_fp16_attention_residuals_and_buffers"
_FP16_SEMANTICS = "full_fp16_nonquantized"


def import_flashrt_shape(
    records: Iterable[Mapping], context: ImportContext
) -> dict[str, object]:
    require_measured_system(context)
    active: dict[str, object] | None = None
    runs: list[dict[str, object]] = []
    end_to_end: list[dict[str, object]] = []
    for raw_source in records:
        source = source_record(raw_source, context)
        record_type = source.get("record")
        if record_type == "run":
            active = normalize_flashrt_context(source, context)
        elif record_type == "timing":
            if active is None:
                raise SourceFormatError(f"{context.source_label}: timing before run")
            run, measurement = normalize_flashrt_timing(
                active, source, context, len(runs) + 1
            )
            runs.append(run)
            end_to_end.append(measurement)
        elif record_type == "complete":
            active = None
    return {
        "bundle_version": "1.0.0",
        "source_label": context.source_label,
        "datasets": {"runs": runs, "end_to_end": end_to_end},
    }


def normalize_flashrt_context(
    source: Mapping[str, object], context: ImportContext
) -> dict[str, object]:
    model_id = source.get("model_family")
    if model_id not in _MODEL_ARTIFACTS:
        raise SourceFormatError(f"{context.source_label}: invalid run record")
    requested = source.get("requested_precision")
    semantics = source.get("precision_semantics")
    if requested == "fp8" and semantics == _FP8_SEMANTICS:
        precision = _precision_fp8()
    elif requested == "fp16" and semantics == _FP16_SEMANTICS:
        precision = _precision_fp16()
    else:
        raise SourceFormatError(f"{context.source_label}: invalid run record")
    return {
        "model_id": model_id,
        "model_artifact_id": _MODEL_ARTIFACTS[model_id],
        "requested_precision": requested,
        "precision": precision,
    }


def normalize_flashrt_timing(
    active: Mapping[str, object], source: Mapping[str, object], context: ImportContext,
    index: int,
) -> tuple[dict[str, object], dict[str, object]]:
    if (
        source.get("model_family") != active["model_id"]
        or source.get("requested_precision") != active["requested_precision"]
    ):
        raise SourceFormatError(f"{context.source_label}: invalid timing record")
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
            "action_chunk": nonnegative_integer(
                source.get("action_chunk_size"), context, "timing"
            ),
            "denoise_steps": None,
        },
    }
    timing = {
        "timing_boundary_id": "predict_cached_graph_sync",
        "state_reuse": "cached_prompt_and_graph",
        "warm_policy": "steady_state",
        "warmup_iterations": nonnegative_integer(
            source.get("warmups"), context, "timing"
        ),
    }
    operating_point = _unknown_operating_point()
    run_id = record_id("run", context, index)
    precision = copy.deepcopy(active["precision"])
    run = _run(
        run_id, active, context, workload, precision, timing, operating_point,
        missing={
            "workload.vla.denoise_steps": "not_applicable",
            **(
                {"precision.scale_zero_point_bytes": "not_reported"}
                if precision["scale_zero_point_bytes"] is None else {}
            ),
            "operating_point.power_mode": "not_collected",
            "operating_point.clock_policy": "not_collected",
            "operating_point.throttle_status": "not_collected",
        },
        runtime_id="flashrt",
    )
    measurement = {
        "measurement_id": record_id("e2e", context, index),
        "run_id": run_id,
        "source_id": context.source_id,
        "evidence": "measured_local",
        "measurement_method": "wall_clock",
        "metric": "latency",
        "statistics": statistics(source.get("latency_ms"), context),
        "sample_count": nonnegative_integer(source.get("repetitions"), context, "timing"),
        "percentile_method": "source_reported",
        "work_unit": "action_chunk",
        "timing_boundary_id": timing["timing_boundary_id"],
        "missing_reason": None,
    }
    return run, measurement


def _precision_fp8() -> dict[str, object]:
    return {
        "precision_id": "mixed-fp8-e4m3-fp16",
        "requested": "fp8",
        "weight_dtype": "mixed-fp8-e4m3-fp16",
        "activation_dtype": "mixed-fp8-e4m3-fp16",
        "accumulation_dtype": "fp16",
        "execution_dtype": "mixed-fp8-e4m3-fp16",
        "quant_scheme": "selective_fp8_e4m3_gemm",
        "granularity": "operator_path",
        "scale_zero_point_bytes": None,
        "dequant_strategy": "none",
        "fused": False,
    }


def _precision_fp16() -> dict[str, object]:
    return {
        "precision_id": "uniform-fp16",
        "requested": "fp16",
        "weight_dtype": "fp16",
        "activation_dtype": "fp16",
        "accumulation_dtype": "fp16",
        "execution_dtype": "fp16",
        "quant_scheme": "none",
        "granularity": "none",
        "scale_zero_point_bytes": 0,
        "dequant_strategy": "none",
        "fused": False,
    }


def _unknown_operating_point() -> dict[str, object]:
    return {
        "operating_point_id": "unknown",
        "power_mode": None,
        "clock_policy": None,
        "throttle_status": None,
    }


def _run(
    run_id: str, active: Mapping[str, object], context: ImportContext,
    workload: dict[str, object], precision: dict[str, object], timing: dict[str, object],
    operating_point: dict[str, object], missing: dict[str, str], runtime_id: str,
) -> dict[str, object]:
    assert context.system_id is not None
    model_id = active["model_id"]
    artifact_id = active["model_artifact_id"]
    context_precision = copy.deepcopy(precision)
    comparison_context = {
        "model_id": model_id,
        "model_artifact_id": artifact_id,
        "runtime_id": runtime_id,
        "evidence": "measured_local",
        "platform": {
            "device_id": "nvidia-jetson-agx-thor",
            "system_id": context.system_id,
            "operating_point_id": operating_point["operating_point_id"],
        },
        "task": {
            "task_id": "vla-action-chunk-inference",
            "input_contract_id": workload["common"]["input_contract_id"],
            "output_contract_id": workload["common"]["output_contract_id"],
            "correctness_policy_id": "finite-only",
        },
        "workload": copy.deepcopy(workload),
        "precision": context_precision,
        "timing": copy.deepcopy(timing),
        "runtime_overhead": "included",
    }
    return {
        "schema_version": "1.0.0",
        "configuration_id": record_id("cfg", context, int(run_id.rsplit("-", 1)[1])),
        "run_id": run_id,
        "model_id": model_id,
        "model_artifact_id": artifact_id,
        "runtime_id": runtime_id,
        "device_id": "nvidia-jetson-agx-thor",
        "system_id": context.system_id,
        "source_id": context.source_id,
        "evidence": "measured_local",
        "capture_method": "wall_clock",
        "workload": workload,
        "precision": precision,
        "timing": timing,
        "operating_point": operating_point,
        "correctness": {"status": "not_assessed", "criterion": "finite-only"},
        "comparison_context": comparison_context,
        "missing": missing,
    }
