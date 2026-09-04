from __future__ import annotations

import argparse
import copy
import sys
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path

from extractors.common import ImportContext, SourceFormatError, nonnegative_integer, record_id, source_record
from tools.lib.jsonio import write_json_atomic


FIDELITY = {
    "vla_perf_stock_pi0": "native",
    "vla_perf_stock_pi0_as_pi05_proxy": "proxy",
    "audited_smolvla_genz_roofline": "custom_operator_model",
}
COMPONENTS = ("vision", "vlm", "action")
_ARTIFACTS = {
    ("pi0", "vla_perf_stock_pi0"): "pi0-vla-perf-stock-01",
    ("pi05", "vla_perf_stock_pi0_as_pi05_proxy"): "pi05-vla-perf-proxy-01",
    ("smolvla", "audited_smolvla_genz_roofline"): "smolvla-vla-perf-custom-01",
}
_DEVICE_ID = "nvidia-jetson-agx-thor"
_TIMING_BOUNDARY = "vla_perf_analytical_e2e"


def import_vla_perf(records: Iterable[Mapping], context: ImportContext) -> dict[str, object]:
    assumptions: Mapping[str, object] | None = None
    estimates: list[Mapping] = []
    for raw_source in records:
        source = source_record(raw_source, context)
        if source.get("record") == "run":
            hardware = source.get("hardware_assumption")
            if not isinstance(hardware, Mapping):
                raise SourceFormatError(f"{context.source_label}: invalid run record")
            assumptions = hardware
        elif source.get("record") == "estimate":
            estimates.append(source)
    if assumptions is None:
        raise SourceFormatError(f"{context.source_label}: missing run record")

    runs: list[dict[str, object]] = []
    end_to_end: list[dict[str, object]] = []
    stages: list[dict[str, object]] = []
    operators: list[dict[str, object]] = []
    rooflines: list[dict[str, object]] = []
    for index, source in enumerate(estimates, start=1):
        run, e2e, components = _estimate(source, assumptions, context, index)
        runs.append(run)
        end_to_end.append(e2e)
        for stage, operator, roofline in components:
            stages.append(stage)
            operators.append(operator)
            rooflines.append(roofline)
    return {
        "bundle_version": "1.0.0",
        "source_label": context.source_label,
        "datasets": {
            "runs": runs,
            "end_to_end": end_to_end,
            "stages": stages,
            "operators": operators,
            "rooflines": rooflines,
        },
    }


def _estimate(
    source: Mapping[str, object], assumptions: Mapping[str, object], context: ImportContext,
    index: int,
) -> tuple[dict[str, object], dict[str, object], list[tuple[dict, dict, dict]]]:
    model_id = source.get("model_family")
    modeling_kind = source.get("modeling_kind")
    artifact_id = _ARTIFACTS.get((model_id, modeling_kind))
    fidelity = FIDELITY.get(modeling_kind)
    if artifact_id is None or fidelity is None or not isinstance(model_id, str):
        raise SourceFormatError(f"{context.source_label}: invalid estimate record")
    precision = _precision(source, context)
    workload = {
        "common": {
            "batch_size": 1,
            "input_contract_id": "deterministic-preprocessed-observation",
            "output_contract_id": "action-chunk",
        },
        "vla": {
            "camera_views": nonnegative_integer(source.get("num_views"), context, "estimate"),
            "image_height": None,
            "image_width": None,
            "semantic_prompt_tokens": nonnegative_integer(
                source.get("semantic_prompt_tokens"), context, "estimate"
            ),
            "executed_prompt_tokens": nonnegative_integer(
                source.get("executed_prompt_tokens"), context, "estimate"
            ),
            "action_dimension": nonnegative_integer(source.get("action_dim"), context, "estimate"),
            "action_chunk": nonnegative_integer(
                source.get("action_output_tokens"), context, "estimate"
            ),
            "denoise_steps": nonnegative_integer(source.get("denoising_steps"), context, "estimate"),
        },
    }
    timing = {
        "timing_boundary_id": _TIMING_BOUNDARY,
        "state_reuse": "analytical_model",
        "warm_policy": "not_applicable",
    }
    operating_point = {
        "operating_point_id": "analytical-assumption",
        "power_mode": None,
        "clock_policy": None,
        "throttle_status": None,
    }
    missing = {
        "workload.vla.image_height": "unavailable_from_source",
        "workload.vla.image_width": "unavailable_from_source",
        "operating_point.power_mode": "not_collected",
        "operating_point.clock_policy": "not_collected",
        "operating_point.throttle_status": "not_collected",
    }
    if context.system_id is None:
        missing["system_id"] = "analytical_no_physical_system"
    run_id = record_id("run", context, index)
    run = {
        "schema_version": "1.0.0",
        "configuration_id": record_id("cfg", context, index),
        "run_id": run_id,
        "model_id": model_id,
        "model_artifact_id": artifact_id,
        "runtime_id": "vla-perf",
        "device_id": _DEVICE_ID,
        "system_id": context.system_id,
        "source_id": context.source_id,
        "evidence": "analytical",
        "capture_method": "vla_perf",
        "workload": workload,
        "precision": precision,
        "timing": timing,
        "operating_point": operating_point,
        "correctness": {"status": "not_assessed", "criterion": "finite-only"},
        "comparison_context": {
            "model_id": model_id,
            "model_artifact_id": artifact_id,
            "runtime_id": "vla-perf",
            "evidence": "analytical",
            "platform": {
                "device_id": _DEVICE_ID,
                "system_id": context.system_id,
                "operating_point_id": "analytical-assumption",
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
            "runtime_overhead": "analytical_excluded",
        },
        "missing": missing,
    }
    e2e = {
        "measurement_id": record_id("e2e", context, index),
        "run_id": run_id,
        "source_id": context.source_id,
        "evidence": "analytical",
        "measurement_method": "vla_perf",
        "metric": "latency",
        "statistics": [{
            "statistic": "analytical_estimate",
            "value": _number(source, "e2e_ms", context, "estimate"),
            "unit": "ms",
        }],
        "sample_count": 0,
        "percentile_method": None,
        "work_unit": "action_chunk",
        "timing_boundary_id": _TIMING_BOUNDARY,
        "missing_reason": None,
    }
    components = [
        _component(source, assumptions, context, index, run_id, precision, fidelity, component)
        for component in COMPONENTS
    ]
    return run, e2e, components


def _precision(source: Mapping[str, object], context: ImportContext) -> dict[str, object]:
    requested = source.get("requested_precision")
    resolved = source.get("resolved_precision")
    if resolved == "fp16" and requested in {"bf16", "fp16"}:
        dtype = "fp16"
        precision_id = "uniform-fp16"
    elif resolved == "fp8" and requested == "fp8":
        dtype = "fp8"
        precision_id = "uniform-fp8"
    else:
        raise SourceFormatError(f"{context.source_label}: invalid estimate record")
    return {
        "precision_id": precision_id,
        "requested": requested,
        "weight_dtype": dtype,
        "activation_dtype": dtype,
        "accumulation_dtype": dtype,
        "execution_dtype": dtype,
        "quant_scheme": "none",
        "granularity": "none",
        "scale_zero_point_bytes": 0,
        "dequant_strategy": "none",
        "fused": False,
    }


def _component(
    source: Mapping[str, object], assumptions: Mapping[str, object], context: ImportContext,
    run_index: int, run_id: str, precision: Mapping[str, object], fidelity: str,
    component: str,
) -> tuple[dict, dict, dict]:
    component_index = COMPONENTS.index(component) + 1
    stage_id = component
    operator_id = record_id("operator", context, (run_index - 1) * len(COMPONENTS) + component_index)
    predicted_ms = _number(source, f"{component}_ms", context, "estimate")
    limiter = _limiter(source.get(f"{component}_boundness"), context)
    work_gflop, traffic_gib, intensity, source_method = _work(
        source, assumptions, component, predicted_ms, limiter, context
    )
    execution_count = (
        nonnegative_integer(source.get("denoising_steps"), context, "estimate")
        if component == "action" else 1
    )
    stage = {
        "measurement_id": record_id("stage", context, (run_index - 1) * len(COMPONENTS) + component_index),
        "run_id": run_id,
        "source_id": context.source_id,
        "evidence": "analytical",
        "measurement_method": "vla_perf",
        "metric": "latency",
        "statistics": [{"statistic": "analytical_estimate", "value": predicted_ms, "unit": "ms"}],
        "sample_count": 0,
        "percentile_method": None,
        "work_unit": "action_chunk",
        "timing_boundary_id": _TIMING_BOUNDARY,
        "missing_reason": None,
        "stage_id": stage_id,
        "parent_stage_id": None,
        "aggregation": "analytical",
        "additive": True,
        "execution_count": execution_count,
    }
    operator = {
        "operator_id": operator_id,
        "run_id": run_id,
        "source_id": context.source_id,
        "evidence": "analytical",
        "module_id": component,
        "granularity": "component",
        "operator_kind": "component_aggregate",
        "shape": "analytical-component-aggregate",
        "execution_count": execution_count,
        "work_gflop": work_gflop,
        "traffic_gib": traffic_gib,
        "arithmetic_intensity_flop_per_byte": intensity,
        "source_method": source_method,
        "missing": {},
    }
    resolved = precision["execution_dtype"]
    peak_key = "fp16_tflops" if resolved == "fp16" else "fp8_tflops"
    roofline = {
        "roofline_id": record_id("roofline", context, (run_index - 1) * len(COMPONENTS) + component_index),
        "run_id": run_id,
        "source_id": context.source_id,
        "evidence": "analytical",
        "operator_id": operator_id,
        "device_id": _DEVICE_ID,
        "precision_id": precision["precision_id"],
        "memory_level": "dram",
        "compute_peak_gflop_per_s": _number(assumptions, peak_key, context, "run") * 1000,
        "bandwidth_gib_per_s": _number(assumptions, "memory_bandwidth_gib_per_s", context, "run"),
        "peak_source": "analytical_assumption",
        "predicted_ms": predicted_ms,
        "limiter": limiter,
        "modeling_fidelity": fidelity,
        "missing": {},
    }
    return stage, operator, roofline


def _work(
    source: Mapping[str, object], assumptions: Mapping[str, object], component: str,
    predicted_ms: float, limiter: str, context: ImportContext,
) -> tuple[float, float, float, str]:
    intensity = _number(source, f"{component}_op_intensity", context, "estimate")
    work = source.get(f"{component}_gflop")
    traffic = source.get(f"{component}_gib")
    if isinstance(work, (int, float)) and not isinstance(work, bool) and work >= 0 and isinstance(traffic, (int, float)) and not isinstance(traffic, bool) and traffic >= 0:
        return float(work), float(traffic), intensity, "vla_perf_component_reported_v1"
    seconds = predicted_ms / 1000
    if limiter == "memory":
        traffic_gib = seconds * _number(assumptions, "memory_bandwidth_gib_per_s", context, "run")
        work_gflop = intensity * traffic_gib * (2**30) / 1_000_000_000
        return work_gflop, traffic_gib, intensity, "vla_perf_inverse_roofline_v1"
    peak_key = "fp16_tflops" if source.get("resolved_precision") == "fp16" else "fp8_tflops"
    work_gflop = seconds * _number(assumptions, peak_key, context, "run") * 1000
    traffic_gib = work_gflop * 1_000_000_000 / (intensity * (2**30))
    return work_gflop, traffic_gib, intensity, "vla_perf_inverse_roofline_v1"


def _limiter(value: object, context: ImportContext) -> str:
    if isinstance(value, str) and value.lower() in {"mem", "memory"}:
        return "memory"
    if isinstance(value, str) and value.lower() in {"comp", "compute"}:
        return "compute"
    raise SourceFormatError(f"{context.source_label}: invalid estimate record")


def _number(source: Mapping[str, object], key: str, context: ImportContext, record_type: str) -> float:
    value = source.get(key)
    if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
        raise SourceFormatError(f"{context.source_label}: invalid {record_type} record")
    return float(value)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stage sanitized VLA-Perf estimates")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--source-label", required=True)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--system-id")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    context = ImportContext(args.source_label, args.source_id, args.system_id)
    try:
        from extractors.benchmark import staging_output
        from extractors.common import read_jsonl

        output = staging_output(args.output, Path.cwd())
        bundle = import_vla_perf(read_jsonl(args.input, source_label=context.source_label), context)
        write_json_atomic(output, bundle)
    except (OSError, SourceFormatError, ValueError):
        print("import: rejected source or output", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
