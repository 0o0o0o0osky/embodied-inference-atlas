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
)


VARIANT_PRECISION = {
    "source_bf16_f32": "mixed-bf16-fp32",
    "bf16": "mixed-bf16-fp32",
    "q8_0_vlm_vit_weight_only": "q8_0-weight-only",
}

_ARTIFACTS = {
    ("pi0", "source_bf16_f32"): "pi0-vlacpp-source-01",
    ("pi0", "q8_0_vlm_vit_weight_only"): "pi0-vlacpp-q8-0-weight-only-01",
    ("smolvla", "source_bf16_f32"): "smolvla-vlacpp-source-01",
}
_DEVICE_ID = "nvidia-jetson-agx-thor"
_TIMING_BOUNDARY = "vlacpp_engine_predict_synthetic"


def import_vla_cpp(records: Iterable[Mapping], context: ImportContext) -> dict[str, object]:
    require_measured_system(context)
    artifacts: dict[tuple[str, str], object] = {}
    timings: list[Mapping] = []
    operating_point = _unknown_operating_point()
    for raw_source in records:
        source = source_record(raw_source, context)
        if source.get("record") == "artifact":
            model_id = source.get("model_family")
            variant = source.get("variant")
            if (model_id, variant) in _ARTIFACTS:
                artifacts[(model_id, variant)] = source.get("scale_zero_point_bytes")
        elif source.get("record") == "run_config":
            operating_point = _operating_point(source, context)
        elif source.get("record") == "timing":
            timings.append(source)

    runs: list[dict[str, object]] = []
    end_to_end: list[dict[str, object]] = []
    for index, timing_source in enumerate(timings, start=1):
        run, measurement = _timing(
            timing_source, artifacts, operating_point, context, index
        )
        runs.append(run)
        end_to_end.append(measurement)
    return {
        "bundle_version": "1.0.0",
        "source_label": context.source_label,
        "datasets": {"runs": runs, "end_to_end": end_to_end},
    }


def _timing(
    source: Mapping[str, object], artifacts: Mapping[tuple[str, str], object],
    operating_point: Mapping[str, object], context: ImportContext, index: int,
) -> tuple[dict[str, object], dict[str, object]]:
    model_id = source.get("model_family")
    variant = source.get("variant")
    precision_id = VARIANT_PRECISION.get(variant)
    if not isinstance(model_id, str) or precision_id is None:
        raise SourceFormatError(f"{context.source_label}: invalid timing record")
    artifact_variant = "source_bf16_f32" if variant == "bf16" else variant
    artifact_id = _ARTIFACTS.get((model_id, artifact_variant))
    if artifact_id is None:
        raise SourceFormatError(f"{context.source_label}: invalid timing record")

    output_shape = source.get("output_shape")
    if not isinstance(output_shape, list) or len(output_shape) < 2:
        raise SourceFormatError(f"{context.source_label}: invalid timing record")
    input_side = nonnegative_integer(source.get("input_side", 224), context, "timing")
    workload = {
        "common": {
            "batch_size": 1,
            "input_contract_id": "synthetic-vla-observation",
            "output_contract_id": "action-chunk",
        },
        "vla": {
            "camera_views": nonnegative_integer(source.get("views"), context, "timing"),
            "image_height": input_side,
            "image_width": input_side,
            "semantic_prompt_tokens": nonnegative_integer(
                source.get("synthetic_tokens"), context, "timing"
            ),
            "executed_prompt_tokens": nonnegative_integer(
                source.get("synthetic_tokens"), context, "timing"
            ),
            "action_dimension": nonnegative_integer(output_shape[-1], context, "timing"),
            "action_chunk": nonnegative_integer(output_shape[0], context, "timing"),
            "denoise_steps": None,
        },
    }
    precision, precision_missing = _precision(
        model_id, variant, artifacts.get((model_id, artifact_variant))
    )
    timing = {
        "timing_boundary_id": _TIMING_BOUNDARY,
        "state_reuse": "synthetic_inputs",
        "warm_policy": "steady_state",
    }
    run_id = record_id("run", context, index)
    missing = {
        "workload.vla.denoise_steps": "unavailable_from_source",
        "operating_point.throttle_status": "not_collected",
        **precision_missing,
    }
    if operating_point["power_mode"] is None:
        missing["operating_point.power_mode"] = "not_collected"
    if operating_point["clock_policy"] is None:
        missing["operating_point.clock_policy"] = "not_collected"
    run = {
        "schema_version": "1.0.0",
        "configuration_id": record_id("cfg", context, index),
        "run_id": run_id,
        "model_id": model_id,
        "model_artifact_id": artifact_id,
        "runtime_id": "vla-cpp",
        "device_id": _DEVICE_ID,
        "system_id": context.system_id,
        "source_id": context.source_id,
        "evidence": "measured_local",
        "capture_method": "wall_clock",
        "workload": workload,
        "precision": precision,
        "timing": timing,
        "operating_point": operating_point,
        "correctness": {"status": "not_assessed", "criterion": "finite-only"},
        "comparison_context": {
            "model_id": model_id,
            "model_artifact_id": artifact_id,
            "runtime_id": "vla-cpp",
            "evidence": "measured_local",
            "platform": {
                "device_id": _DEVICE_ID,
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
            "precision": copy.deepcopy(precision),
            "timing": copy.deepcopy(timing),
            "runtime_overhead": "included",
        },
        "missing": missing,
    }
    return run, {
        "measurement_id": record_id("e2e", context, index),
        "run_id": run_id,
        "source_id": context.source_id,
        "evidence": "measured_local",
        "measurement_method": "wall_clock",
        "metric": "latency",
        "statistics": _statistics(source, context),
        "sample_count": nonnegative_integer(source.get("repetitions"), context, "timing"),
        "percentile_method": None,
        "work_unit": "action_chunk",
        "timing_boundary_id": _TIMING_BOUNDARY,
        "missing_reason": None,
    }


def _precision(
    model_id: str, variant: object, source_overhead: object,
) -> tuple[dict[str, object], dict[str, str]]:
    if variant in {"source_bf16_f32", "bf16"}:
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
        }, {}
    if model_id != "pi0" or variant != "q8_0_vlm_vit_weight_only":
        raise ValueError("unsupported controlled variant")
    overhead = (
        source_overhead
        if isinstance(source_overhead, int) and not isinstance(source_overhead, bool)
        and source_overhead >= 0
        else None
    )
    missing = {} if overhead is not None else {
        "precision.scale_zero_point_bytes": "not_reported"
    }
    return {
        "precision_id": "q8_0-weight-only",
        "requested": "q8_0",
        "weight_dtype": "q8_0",
        "activation_dtype": "fp16",
        "accumulation_dtype": "fp32",
        "execution_dtype": "fp16",
        "quant_scheme": "q8_0_weight_only",
        "granularity": "blockwise",
        "scale_zero_point_bytes": overhead,
        "dequant_strategy": "matmul_path",
        "fused": False,
    }, missing


def _operating_point(source: Mapping[str, object], context: ImportContext) -> dict[str, object]:
    if source.get("power_mode") is None and source.get("clock_policy") is None:
        return _unknown_operating_point()
    if (
        source.get("power_mode") == "120W mode 1"
        and source.get("clock_policy") == "dynamic (jetson_clocks not forced)"
    ):
        return {
            "operating_point_id": "thor-120w-dynamic",
            "power_mode": "120w-mode-1",
            "clock_policy": "dynamic",
            "throttle_status": None,
        }
    raise SourceFormatError(f"{context.source_label}: invalid run_config record")


def _unknown_operating_point() -> dict[str, object]:
    return {
        "operating_point_id": "unknown",
        "power_mode": None,
        "clock_policy": None,
        "throttle_status": None,
    }


def _statistics(source: Mapping[str, object], context: ImportContext) -> list[dict[str, object]]:
    output: list[dict[str, object]] = []
    for source_key, statistic in (("min_ms", "min"), ("p50_ms", "p50"), ("p95_ms", "p95")):
        value = source.get(source_key)
        if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
            raise SourceFormatError(f"{context.source_label}: invalid timing record")
        output.append({"statistic": statistic, "value": value, "unit": "ms"})
    return output
