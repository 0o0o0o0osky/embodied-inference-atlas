from __future__ import annotations

import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from tools.lib.model_graph import materialize_model_graph
from tools.lib.roofline import RooflineProblem, attention_metrics, stage_lower_bound


VERSION = "2.0.0"
DEVICE = "nvidia-jetson-agx-thor"
CEILING = "thor-t5000-120w-1386mhz"
BANDWIDTH = "bw-thor-120w-conditional-273gbps"
COMPUTE_RATES = {
    "tensor_bf16_dense": 227.48e12,
    "tensor_fp16_dense": 227.48e12,
    "tensor_fp8_e4m3_dense": 454.96e12,
    "tensor_nvfp4_e2m1_dense": 910.8e12,
}


def obj(properties, required=None):
    return {
        "type": "object",
        "required": list(properties) if required is None else required,
        "additional_properties": False,
        "properties": properties,
    }


def string(max_length=240, enum=None, nullable=False):
    result = {"type": ["string", "null"] if nullable else "string", "min_length": 1, "max_length": max_length}
    if enum is not None:
        result["enum"] = enum
    return result


def number(nullable=False, minimum=0):
    return {"type": ["number", "null"] if nullable else "number", "minimum": minimum}


def integer(nullable=False, minimum=0):
    return {"type": ["integer", "null"] if nullable else "integer", "minimum": minimum}


def array(items):
    return {"type": "array", "items": items}


def enum(*values):
    result = string(enum=list(values), nullable=None in values)
    if None in values:
        result.pop("min_length", None)
        result.pop("max_length", None)
    return result


def provenance_schema():
    derivation = obj({
        "kind": enum("divide_sparse_peak", "scale_by_clock", "scale_by_emc", "legacy_copy", "formula"),
        "expression": string(500),
        "input_refs": array(string(300)),
    })
    derivation["type"] = ["object", "null"]
    return obj({
        "evidence": enum("measured_local", "analytical", "reported_external"),
        "class": enum("published_fact", "mode_scaled_analytical", "analytical_model", "legacy_tool_assumption", "measured_empirical", "missing"),
        "source_ids": array(string(80)),
        "derivation": derivation,
        "condition": string(500, nullable=True),
    })


def missing_schema():
    return obj({
        "field": string(300),
        "reason": enum("not_applicable", "not_collected", "not_reported", "unsupported", "unavailable_from_source", "incompatible_basis", "ambiguous_mapping", "missing_compute_ceiling", "missing_traffic", "missing_work", "unfrozen_dependency"),
        "detail": string(500),
    })


COMPUTE_CLASSES = [
    "tensor_bf16_dense", "tensor_fp16_dense", "tensor_fp8_e4m3_dense",
    "tensor_fp4_e2m1_dense", "tensor_nvfp4_e2m1_dense", "tensor_fp16_sparse",
    "tensor_fp4_e2m1_sparse", "tensor_nvfp4_e2m1_sparse", "scalar_fp32",
    "sfu_exp_reciprocal",
]


def write_schemas():
    provenance = provenance_schema()
    missing = missing_schema()
    encoding = obj({
        "format": enum("fp32", "bf16", "fp16", "fp8_e4m3", "nvfp4_e2m1", "int8_symmetric", "int4_symmetric", "q8_0"),
        "bits_per_value": {"type": "integer", "enum": [4, 8, 16, 32]},
        "block_values": integer(nullable=True, minimum=1),
        "packed_data_bytes_per_block": integer(nullable=True, minimum=1),
        "scale_format": enum("none", "fp16", "fp32", "fp8_e4m3", "bf16"),
        "scale_bytes_per_block": integer(),
        "zero_point_bytes_per_block": integer(),
        "tensor_scale_bytes": integer(),
        "padding": enum("none", "pad_to_block"),
        "provenance": provenance,
    })
    segment = obj({
        "segment_id": string(160),
        "selector": obj({
            "kind": enum("all", "logical_refs", "execution_groups"),
            "refs": array(string(300)),
        }),
        "weight": encoding,
        "activation": encoding,
        "output": encoding,
        "accumulator_dtype": enum("bf16", "fp16", "fp32"),
        "compute_class": enum(*COMPUTE_CLASSES),
        "dequantization": obj({
            "mode": enum("none", "fused_to_bf16", "materialized_bf16"),
            "floating_flop_per_weight": number(),
            "integer_op_per_weight": number(),
            "materialized_bytes_per_weight": number(),
        }),
    })
    ceiling_record = obj({
        "schema_version": enum(VERSION),
        "ceiling_id": string(120),
        "label": string(240),
        "device_id": string(80),
        "operating_point": obj({
            "operating_point_id": string(120),
            "power_mode": enum("120W", "maximum_specification", None),
            "gpu_clock_hz": number(nullable=True),
            "emc_clock_hz": number(nullable=True),
            "clock_basis": enum("published_max", "mode_assumption", "observed_locked", "unknown"),
            "sparsity_on": {"type": ["boolean", "null"]},
        }),
        "compute": array(obj({
            "compute_ceiling_id": string(160),
            "compute_class": enum(*COMPUTE_CLASSES),
            "flop_per_second": number(nullable=True),
            "requires_sparsity_on": {"type": "boolean"},
            "provenance": provenance,
        })),
        "bandwidth": array(obj({
            "bandwidth_ceiling_id": string(160),
            "memory_domain": enum("system_memory", "l2", "l1tex"),
            "byte_per_second": number(nullable=True),
            "required_emc_clock_hz": number(nullable=True),
            "provenance": provenance,
        })),
        "missing": array(missing),
    })
    scenario_record = obj({
        "schema_version": enum(VERSION),
        "scenario_id": string(160),
        "label": string(240),
        "origin": enum("default_precomputed", "interactive_analytical", "legacy_import"),
        "model_id": enum("pi0", "pi05", "smolvla"),
        "model_graph_id": string(120, nullable=True),
        "model_artifact_id": string(160),
        "workload": obj({
            "batch_size": integer(minimum=1),
            "active_camera_views": integer(minimum=1),
            "executed_camera_views": integer(minimum=1),
            "raw_image_height": integer(nullable=True, minimum=1),
            "raw_image_width": integer(nullable=True, minimum=1),
            "executed_image_height": integer(nullable=True, minimum=1),
            "executed_image_width": integer(nullable=True, minimum=1),
            "semantic_prompt_tokens": integer(nullable=True),
            "executed_prompt_tokens": integer(),
            "action_horizon": integer(minimum=1),
            "public_action_dimension": integer(nullable=True),
            "internal_action_dimension": integer(minimum=1),
            "denoise_steps": integer(minimum=1),
            "work_unit": enum("action_chunk"),
        }),
        "precision_path": obj({
            "precision_path_id": enum("bf16_dense", "fp16_dense", "fp8_w8a8", "nvfp4_w4a4", "w8a16_bf16_compute", "w4a16_bf16_compute", "q8_0_weight_only_bf16_compute", "runtime_mixed"),
            "kind": enum("uniform", "weight_only", "mapped_mixed"),
            "segments": array(segment),
            "runtime_support": enum("proven", "unproven", "unsupported", "unknown"),
            "realization_ids": array(string(160)),
        }),
        "modeling_scope": enum("ideal_analytical", "implementation_modeled", "legacy_component_envelope"),
        "provenance": provenance,
        "missing": array(missing),
    })
    basis_record = obj({
        "schema_version": enum(VERSION),
        "basis_id": string(200),
        "label": string(300),
        "level": enum("stage", "atomic", "fused", "kernel"),
        "scenario_id": string(160),
        "precision_path_id": enum("bf16_dense", "fp16_dense", "fp8_w8a8", "nvfp4_w4a4", "w8a16_bf16_compute", "w4a16_bf16_compute", "q8_0_weight_only_bf16_compute", "runtime_mixed"),
        "ceiling_id": string(160),
        "bandwidth_ceiling_id": string(160),
        "device_id": string(80),
        "operating_point_id": string(160),
        "work_unit": enum("action_chunk", "denoise_step", "operator_invocation", "execution_group", "kernel_launch"),
        "time_basis": enum("analytical_roof", "legacy_analytical_prediction", "wall_clock", "cuda_event", "nsys_interval", "ncu_kernel"),
        "traffic_basis": enum("atomic_materialized", "fused_boundary_modeled", "system_memory_measured", "l2_measured", "legacy_inverse_roofline", "legacy_custom_resident_score"),
        "work_basis": enum("logical_formula", "runtime_executed_formula", "hardware_counter", "legacy_component_aggregate"),
        "aggregation": enum("entity", "dag_resource_and_critical_path"),
        "runtime_overhead": enum("included", "excluded", "not_applicable", "unknown"),
        "runtime_id": string(80, nullable=True),
        "realization_id": string(160, nullable=True),
        "run_id": string(160, nullable=True),
        "capture_id": string(160, nullable=True),
        "comparison_mode": enum("inventory", "same_coverage_only"),
        "provenance": provenance,
        "missing": array(missing),
    })
    work_component = obj({
        "component_id": string(300),
        "kind": enum("gemm", "attention_score", "attention_scale_mask", "attention_softmax", "attention_value", "dequant", "runtime_extra", "curated_other"),
        "compute_class": enum(*COMPUTE_CLASSES, None),
        "flop": number(),
        "comparison_ops": number(),
        "transcendental_ops": number(),
        "integer_ops": number(),
        "provenance": provenance,
    })
    traffic_component = obj({
        "component_id": string(300),
        "kind": enum("input_read", "weight_read", "boundary_output_write", "scale_read", "zero_point_read", "padding_overfetch", "reformat_read", "reformat_write", "qdq_read", "qdq_write", "spill_read", "spill_write", "materialized_internal_read", "materialized_internal_write", "runtime_extra"),
        "byte": number(),
        "tensor_ref": string(300, nullable=True),
        "provenance": provenance,
    })
    point_record = obj({
        "schema_version": enum(VERSION),
        "point_id": string(300),
        "basis_id": string(200),
        "entity": obj({
            "kind": enum("model_total", "stage", "atomic_operator", "execution_group", "kernel", "legacy_component"),
            "entity_id": string(300),
            "label": string(300),
            "shape_or_coverage": string(500),
            "logical_refs": array(string(300)),
            "coverage_key": string(20000),
        }),
        "calls": integer(minimum=1),
        "values_scope": enum("all_calls"),
        "work": obj({"components": array(work_component), "total_flop": number()}),
        "traffic": obj({
            "memory_domain": enum("system_memory", "l2", "l1tex"),
            "value_kind": enum("modeled", "measured", "legacy_derived"),
            "components": array(traffic_component),
            "excluded_internal": array(obj({
                "tensor_ref": string(300), "byte_avoided": number(), "evidence_ref": string(300),
            })),
            "total_byte": number(),
        }),
        "timing": obj({
            "observed_second": number(nullable=True),
            "statistic": enum("analytical", "median", "mean", "single_observation", None),
            "sample_count": integer(nullable=True),
            "timing_boundary_id": string(200),
        }),
        "aggregation": obj({
            "member_point_ids": array(string(300)),
            "dependency_edges": array(obj({"source": string(300), "target": string(300)})),
            "dependency_lower_bound_second": number(nullable=True),
            "resource_compute_lower_bound_second": number(nullable=True),
            "resource_memory_lower_bound_second": number(nullable=True),
        }),
        "coverage": obj({
            "status": enum("complete", "partial", "proxy", "unmapped_legacy"),
            "included_refs": array(string(300)),
            "omitted": array(obj({"ref": string(300), "reason": string(500)})),
        }),
        "derived": obj({
            "status": enum("complete", "partial_lower_bound", "unavailable"),
            "arithmetic_intensity_flop_per_byte": number(nullable=True),
            "compute_second": number(nullable=True),
            "memory_second": number(nullable=True),
            "roof_second": number(nullable=True),
            "roof_flop_per_second": number(nullable=True),
            "achieved_flop_per_second": number(nullable=True),
            "efficiency": number(nullable=True),
            "gap": number(nullable=True),
            "limiter": enum("compute", "memory", "dependency", "tie", "unknown"),
        }),
        "legacy_record_refs": array(obj({
            "dataset": enum("operators", "rooflines"), "record_id": string(160),
        })),
        "provenance": provenance,
        "missing": array(missing),
    })
    schemas = {
        "roofline_ceilings.schema.json": ("roofline_ceilings", ceiling_record),
        "roofline_scenarios.schema.json": ("roofline_scenarios", scenario_record),
        "roofline_bases.schema.json": ("roofline_bases", basis_record),
        "roofline_points.schema.json": ("roofline_points", point_record),
    }
    output = ROOT / "schema" / "analysis"
    output.mkdir(parents=True, exist_ok=True)
    for name, (dataset, record) in schemas.items():
        write_json(output / name, {"dataset": dataset, "record": record})


def prov(evidence, klass, sources, kind=None, expression=None, inputs=(), condition=None):
    return {
        "evidence": evidence,
        "class": klass,
        "source_ids": list(sources),
        "derivation": None if kind is None else {"kind": kind, "expression": expression, "input_refs": list(inputs)},
        "condition": condition,
    }


def missing(field, reason, detail):
    return {"field": field, "reason": reason, "detail": detail}


PUBLISHED = lambda sources, condition: prov("reported_external", "published_fact", sources, condition=condition)
ANALYTICAL = lambda sources, expression, inputs=(), condition=None, kind="formula": prov("analytical", "analytical_model", sources, kind, expression, inputs, condition)
SCALED = lambda sources, expression, inputs=(), condition=None, kind="scale_by_clock": prov("analytical", "mode_scaled_analytical", sources, kind, expression, inputs, condition)
LEGACY = lambda condition=None: prov("analytical", "legacy_tool_assumption", ["source-vla-perf"], "legacy_copy", "copy pinned VLA-Perf GenZ assumptions and component envelope", ["vla-perf@1e2b9a7"], condition)


def compute_item(item_id, klass, rate, sparse, provenance):
    return {"compute_ceiling_id": item_id, "compute_class": klass, "flop_per_second": rate, "requires_sparsity_on": sparse, "provenance": provenance}


def bandwidth_item(item_id, rate, emc, provenance):
    return {"bandwidth_ceiling_id": item_id, "memory_domain": "system_memory", "byte_per_second": rate, "required_emc_clock_hz": emc, "provenance": provenance}


def ceilings():
    ds = "source-nvidia-thor-datasheet-v1-5"
    migration = "source-nvidia-thor-migration-note-v1-2"
    max_compute = [
        compute_item("compute-thor-maxn-fp8-dense", "tensor_fp8_e4m3_dense", 517e12, False, PUBLISHED([ds], "MAXN; Data Sheet v1.5 Table 1-1, printed p. 1 / PDF p. 8, dense FP8 up-to rate.")),
        compute_item("compute-thor-maxn-fp4-dense", "tensor_fp4_e2m1_dense", 1035e12, False, PUBLISHED([ds], "MAXN; Data Sheet v1.5 Table 1-1, printed p. 1 / PDF p. 8, generic dense FP4 up-to rate; not explicitly named NVFP4.")),
        compute_item("compute-thor-maxn-fp4-sparse", "tensor_fp4_e2m1_sparse", 2070e12, True, PUBLISHED([ds], "MAXN; Data Sheet v1.5 Table 1-1, printed p. 1 / PDF p. 8, structured-sparse FP4 up-to rate.")),
        compute_item("compute-thor-maxn-fp16-sparse", "tensor_fp16_sparse", 517e12, True, PUBLISHED([migration], "Migration Application Note v1.2 Table 1, printed p. 4 / PDF p. 8, sparse FP16 up-to rate.")),
        compute_item("compute-thor-maxn-scalar-fp32", "scalar_fp32", None, False, prov("analytical", "missing", [], condition="No source-backed scalar FP32 ceiling is available.")),
        compute_item("compute-thor-maxn-sfu", "sfu_exp_reciprocal", None, False, prov("analytical", "missing", [], condition="No source-backed SFU exp/reciprocal ceiling is available.")),
    ]
    max_missing = [
        missing("compute.compute-thor-maxn-scalar-fp32.flop_per_second", "missing_compute_ceiling", "Scalar FP32 throughput is not sourced."),
        missing("compute.compute-thor-maxn-sfu.flop_per_second", "missing_compute_ceiling", "SFU exp/reciprocal throughput is not sourced."),
    ]
    rounded = [
        compute_item("compute-thor-120w-fp8-dense-published-rounded", "tensor_fp8_e4m3_dense", 455e12, False, PUBLISHED([ds], "120W; Data Sheet v1.5 Table 1-1 prints rounded dense FP8 455 TFLOP/s.")),
        compute_item("compute-thor-120w-fp4-dense-published-rounded", "tensor_fp4_e2m1_dense", 910e12, False, PUBLISHED([ds], "120W; Data Sheet v1.5 Table 1-1 prints rounded generic dense FP4 910 TFLOP/s; not explicitly NVFP4.")),
    ]
    scaled_sources = [ds, migration]
    scaled = [
        compute_item("compute-thor-120w-bf16-dense-scaled", "tensor_bf16_dense", 227.48e12, False, SCALED(scaled_sources, "(517e12 / 2) * (1.386e9 / 1.575e9)", ["compute-thor-maxn-fp16-sparse", "clock-thor-maxn-1575mhz", "clock-thor-120w-1386mhz"], "Dense BF16 maps from half the published sparse FP16 peak, then linearly scales by clock; analytical, not a quoted NVIDIA peak.")),
        compute_item("compute-thor-120w-fp16-dense-scaled", "tensor_fp16_dense", 227.48e12, False, SCALED(scaled_sources, "(517e12 / 2) * (1.386e9 / 1.575e9)", ["compute-thor-maxn-fp16-sparse", "clock-thor-maxn-1575mhz", "clock-thor-120w-1386mhz"], "Dense FP16 maps from half the published sparse FP16 peak, then linearly scales by clock; analytical, not the sparse rate.")),
        compute_item("compute-thor-120w-fp8-dense-scaled", "tensor_fp8_e4m3_dense", 454.96e12, False, SCALED([ds], "517e12 * (1.386e9 / 1.575e9)", ["compute-thor-maxn-fp8-dense", "clock-thor-maxn-1575mhz", "clock-thor-120w-1386mhz"], "Exact clock-scaled analytical value; Data Sheet v1.5 separately publishes rounded 455 TFLOP/s.")),
        compute_item("compute-thor-120w-nvfp4-dense-mapped-scaled", "tensor_nvfp4_e2m1_dense", 910.8e12, False, SCALED([ds, "source-nvidia-nvfp4-format"], "1035e12 * (1.386e9 / 1.575e9)", ["compute-thor-maxn-fp4-dense", "clock-thor-maxn-1575mhz", "clock-thor-120w-1386mhz"], "Mapping inference: NVIDIA publishes generic FP4 peak and separately documents NVFP4 E2M1+FP8-scale support; it does not publish this peak specifically as NVFP4.")),
        compute_item("compute-thor-120w-scalar-fp32", "scalar_fp32", None, False, prov("analytical", "missing", [], condition="No source-backed scalar FP32 ceiling is available.")),
        compute_item("compute-thor-120w-sfu", "sfu_exp_reciprocal", None, False, prov("analytical", "missing", [], condition="No source-backed SFU exp/reciprocal ceiling is available.")),
    ]
    return [
        {"schema_version": VERSION, "ceiling_id": "thor-t5000-published-max", "label": "Thor T5000 published MAXN ceilings", "device_id": DEVICE, "operating_point": {"operating_point_id": "thor-maxn-published", "power_mode": "maximum_specification", "gpu_clock_hz": 1.575e9, "emc_clock_hz": 4.266e9, "clock_basis": "published_max", "sparsity_on": None}, "compute": max_compute, "bandwidth": [bandwidth_item("bw-thor-maxn-published-273gbps", 273e9, 4.266e9, PUBLISHED([ds], "Data Sheet v1.5 Table 1-1, printed p. 3 / PDF p. 10; decimal peak LPDDR5X bandwidth paired with 4266 MHz maximum."))], "missing": max_missing},
        {"schema_version": VERSION, "ceiling_id": "thor-t5000-published-120w-rounded", "label": "Thor T5000 published 120W rounded compute ceilings", "device_id": DEVICE, "operating_point": {"operating_point_id": "thor-120w-published-caps", "power_mode": "120W", "gpu_clock_hz": 1.386e9, "emc_clock_hz": 4.266e9, "clock_basis": "published_max", "sparsity_on": False}, "compute": rounded, "bandwidth": [bandwidth_item("bw-thor-120w-published-273gbps-conditional", 273e9, 4.266e9, PUBLISHED([ds], "The published 273 GB/s peak is conditional on the 4266 MHz maximum; it is not observed traffic."))], "missing": []},
        {"schema_version": VERSION, "ceiling_id": CEILING, "label": "Thor T5000 120W / 1.386 GHz analytical roof", "device_id": DEVICE, "operating_point": {"operating_point_id": "thor-120w-1386mhz-analytical", "power_mode": "120W", "gpu_clock_hz": 1.386e9, "emc_clock_hz": 4.266e9, "clock_basis": "mode_assumption", "sparsity_on": False}, "compute": scaled, "bandwidth": [bandwidth_item(BANDWIDTH, 273e9, 4.266e9, SCALED([ds], "273e9 * 4.266e9 / 4.266e9", ["bw-thor-maxn-published-273gbps"], "Conditional analysis curve. Without a matched observed EMC clock, measured efficiency and gap are prohibited.", "scale_by_emc"))], "missing": [missing("compute.compute-thor-120w-scalar-fp32.flop_per_second", "missing_compute_ceiling", "Scalar FP32 throughput is not sourced."), missing("compute.compute-thor-120w-sfu.flop_per_second", "missing_compute_ceiling", "SFU throughput is not sourced.")]},
        {"schema_version": VERSION, "ceiling_id": "thor-t5000-vla-perf-legacy", "label": "Legacy VLA-Perf Thor assumptions", "device_id": DEVICE, "operating_point": {"operating_point_id": "vla-perf-legacy-assumption", "power_mode": None, "gpu_clock_hz": None, "emc_clock_hz": None, "clock_basis": "unknown", "sparsity_on": False}, "compute": [compute_item("compute-vla-perf-fp16-400t", "tensor_fp16_dense", 400e12, False, LEGACY("Pinned VLA-Perf system config; not an official Thor operating point.")), compute_item("compute-vla-perf-fp8-800t", "tensor_fp8_e4m3_dense", 800e12, False, LEGACY("Pinned VLA-Perf system config; uniform FP8 model, not a FlashRT mixed path."))], "bandwidth": [bandwidth_item("bw-vla-perf-270gib", 270 * 2**30, None, LEGACY("Pinned VLA-Perf binary conversion of the configured value 270."))], "missing": [missing("operating_point.gpu_clock_hz", "not_reported", "VLA-Perf does not bind this assumption to an observed GPU clock."), missing("operating_point.emc_clock_hz", "not_reported", "VLA-Perf does not bind this assumption to an observed EMC clock.")]},
    ]


def raw_encoding(fmt, bits, provenance, tensor_scale=0):
    return {"format": fmt, "bits_per_value": bits, "block_values": None, "packed_data_bytes_per_block": None, "scale_format": "fp32" if tensor_scale else "none", "scale_bytes_per_block": 0, "zero_point_bytes_per_block": 0, "tensor_scale_bytes": tensor_scale, "padding": "none", "provenance": provenance}


def block_encoding(fmt, bits, block, data, scale_fmt, scale, provenance, tensor_scale=0):
    return {"format": fmt, "bits_per_value": bits, "block_values": block, "packed_data_bytes_per_block": data, "scale_format": scale_fmt, "scale_bytes_per_block": scale, "zero_point_bytes_per_block": 0, "tensor_scale_bytes": tensor_scale, "padding": "pad_to_block", "provenance": provenance}


def default_precision_specs(source_ids):
    hypothesis = ANALYTICAL(source_ids, "declared analytical tensor encoding and FMA=2 convention")
    nv_caveat = ANALYTICAL([*source_ids, "source-nvidia-nvfp4-format"], "map declared NVFP4 E2M1/FP8-block-scale layout to generic FP4 Tensor Core roof", ["compute-thor-120w-nvfp4-dense-mapped-scaled"], "The generic FP4 peak is not published verbatim as an NVFP4-specific rate.")
    bf16 = raw_encoding("bf16", 16, hypothesis)
    fp16 = raw_encoding("fp16", 16, hypothesis)
    fp8 = raw_encoding("fp8_e4m3", 8, hypothesis, 4)
    nv = block_encoding("nvfp4_e2m1", 4, 16, 8, "fp8_e4m3", 1, nv_caveat, 4)
    w8 = block_encoding("int8_symmetric", 8, 32, 32, "bf16", 2, hypothesis)
    w4 = block_encoding("int4_symmetric", 4, 32, 16, "bf16", 2, hypothesis)
    q8 = block_encoding("q8_0", 8, 32, 32, "fp16", 2, hypothesis)
    def segment(name, weight, activation, output, accumulator, compute_class, dequant=("none", 0, 0, 0)):
        return {"segment_id": f"segment-{name}", "selector": {"kind": "all", "refs": []}, "weight": weight, "activation": activation, "output": output, "accumulator_dtype": accumulator, "compute_class": compute_class, "dequantization": {"mode": dequant[0], "floating_flop_per_weight": dequant[1], "integer_op_per_weight": dequant[2], "materialized_bytes_per_weight": dequant[3]}}
    return {
        "bf16_dense": ("Dense BF16", "uniform", segment("bf16", bf16, bf16, bf16, "fp32", "tensor_bf16_dense")),
        "fp16_dense": ("Dense FP16", "uniform", segment("fp16", fp16, fp16, fp16, "fp32", "tensor_fp16_dense")),
        "fp8_w8a8": ("FP8 W8A8 · per-tensor FP32 scales", "uniform", segment("fp8", fp8, fp8, fp8, "fp32", "tensor_fp8_e4m3_dense")),
        "nvfp4_w4a4": ("NVFP4 W4A4 · block-16 FP8 scales", "uniform", segment("nvfp4", nv, nv, nv, "fp32", "tensor_nvfp4_e2m1_dense")),
        "w8a16_bf16_compute": ("W8A16 · block-32 · BF16 compute", "weight_only", segment("w8a16", w8, bf16, bf16, "fp32", "tensor_bf16_dense", ("fused_to_bf16", 1, 1, 0))),
        "w4a16_bf16_compute": ("W4A16 · block-32 · BF16 compute", "weight_only", segment("w4a16", w4, bf16, bf16, "fp32", "tensor_bf16_dense", ("fused_to_bf16", 1, 1, 0))),
        "q8_0_weight_only_bf16_compute": ("Q8_0 weight-only · BF16 compute", "weight_only", segment("q8-0", q8, bf16, bf16, "fp32", "tensor_bf16_dense", ("fused_to_bf16", 1, 1, 0))),
    }


MODEL_DEFAULTS = {
    "pi0": {"graph": "pi0-logical-v1", "artifact": "pi0-flashrt-local-01", "workload": {"batch_size": 1, "active_camera_views": 3, "executed_camera_views": 3, "raw_image_height": 224, "raw_image_width": 224, "executed_image_height": 224, "executed_image_width": 224, "semantic_prompt_tokens": None, "executed_prompt_tokens": 48, "action_horizon": 50, "public_action_dimension": None, "internal_action_dimension": 32, "denoise_steps": 10, "work_unit": "action_chunk"}, "runtime": "flashrt", "realization": "rr-flashrt-pi0-thor-fp8-v1"},
    "pi05": {"graph": "pi05-droid-logical-v1", "artifact": "pi05-droid-logical-01", "workload": {"batch_size": 1, "active_camera_views": 3, "executed_camera_views": 3, "raw_image_height": 224, "raw_image_width": 224, "executed_image_height": 224, "executed_image_width": 224, "semantic_prompt_tokens": None, "executed_prompt_tokens": 200, "action_horizon": 15, "public_action_dimension": 32, "internal_action_dimension": 32, "denoise_steps": 10, "work_unit": "action_chunk"}, "runtime": "flashrt", "realization": "rr-flashrt-pi05-thor-fp8-v1"},
    "smolvla": {"graph": "smolvla-base-logical-v1", "artifact": "smolvla-lerobot-local-01", "workload": {"batch_size": 1, "active_camera_views": 3, "executed_camera_views": 3, "raw_image_height": 256, "raw_image_width": 256, "executed_image_height": 512, "executed_image_width": 512, "semantic_prompt_tokens": None, "executed_prompt_tokens": 48, "action_horizon": 50, "public_action_dimension": 6, "internal_action_dimension": 32, "denoise_steps": 10, "work_unit": "action_chunk"}, "runtime": "lerobot", "realization": "rr-lerobot-smolvla-thor-eager-v1"},
}


def runtime_representative_run(realization, runs):
    """Pick a real bound configuration without importing any measured timing."""
    configuration_ids = set(realization["configuration_ids"])
    candidates = sorted(
        (run for run in runs if run.get("configuration_id") in configuration_ids),
        key=lambda run: run["run_id"],
    )
    if not candidates:
        raise ValueError(f"{realization['realization_id']} has no bound workload configuration")
    views = {run["workload"]["vla"]["camera_views"] for run in candidates}
    preferred_views = 3 if 3 in views else max(views)
    view_candidates = [
        run for run in candidates
        if run["workload"]["vla"]["camera_views"] == preferred_views
    ]
    prompts = sorted({
        run["workload"]["vla"]["executed_prompt_tokens"]
        for run in view_candidates
    })
    preferred_prompt = prompts[len(prompts) // 2]
    exact = [
        run for run in view_candidates
        if run["workload"]["vla"]["executed_prompt_tokens"] == preferred_prompt
    ]
    if any(
        not isinstance(run["workload"]["vla"].get("semantic_prompt_tokens"), int)
        or isinstance(run["workload"]["vla"].get("semantic_prompt_tokens"), bool)
        for run in exact
    ):
        raise ValueError(f"{realization['realization_id']} has no fully reported semantic prompt representative")
    exact.sort(key=lambda run: (
        run["workload"]["vla"]["semantic_prompt_tokens"],
        run["run_id"],
    ))
    return exact[len(exact) // 2]


def runtime_default_workload(logical_workload, realization, runs):
    """Bind a mapped-mixed default to its realization, not the logical default."""
    representative = runtime_representative_run(realization, runs)
    observed = representative["workload"]
    applicability = realization["workload_applicability"]
    required = (
        "runtime_action_horizon", "public_action_horizon",
        "public_action_dimension", "runtime_internal_action_dimension",
        "denoise_steps",
    )
    if any(not isinstance(applicability.get(field), int) for field in required):
        raise ValueError(f"{realization['realization_id']} lacks complete workload applicability")
    if applicability["runtime_action_horizon"] != applicability["public_action_horizon"]:
        raise ValueError(f"{realization['realization_id']} has incompatible public/runtime horizons")
    if representative.get("model_artifact_id") not in realization["model_artifact_ids"]:
        raise ValueError(f"{representative['run_id']} does not use an artifact bound to {realization['realization_id']}")
    workload = dict(logical_workload)
    workload.update({
        "batch_size": observed["common"]["batch_size"],
        "active_camera_views": observed["vla"]["camera_views"],
        "executed_camera_views": observed["vla"]["camera_views"],
        "semantic_prompt_tokens": observed["vla"]["semantic_prompt_tokens"],
        "executed_prompt_tokens": observed["vla"]["executed_prompt_tokens"],
        "action_horizon": applicability["runtime_action_horizon"],
        "public_action_dimension": applicability["public_action_dimension"],
        "internal_action_dimension": applicability["runtime_internal_action_dimension"],
        "denoise_steps": applicability["denoise_steps"],
    })
    return workload, representative


def runtime_scenario_segments(realization, source_ids):
    runtime_prov = ANALYTICAL(source_ids, "copy exact execution-group precision allocation from the selected Task 4 realization", [realization["realization_id"]], "Mapping coverage is partial; unmapped logical formulas remain omitted.")
    precision = {item["precision_path_id"]: item for item in realization["precision_paths"]}
    by_precision = defaultdict(list)
    for group in realization["execution_groups"]:
        by_precision[group["precision_path_id"]].append(group["execution_group_id"])
    segments = []
    for index, (precision_id, refs) in enumerate(sorted(by_precision.items())):
        item = precision[precision_id]
        dtype = " ".join(str(item.get(key) or "") for key in ("weight_dtype", "activation_dtype", "output_dtype"))
        if "fp8" in dtype:
            weight = activation = raw_encoding("fp8_e4m3", 8, runtime_prov, 4)
            output = raw_encoding("fp16", 16, runtime_prov)
            compute = "tensor_fp8_e4m3_dense"
            accumulator = "fp16"
        elif precision_id.endswith("attention-control") or "FP32 Q/K" in item["label"]:
            weight = activation = output = raw_encoding("fp32", 32, runtime_prov)
            compute = "scalar_fp32"
            accumulator = "fp32"
        elif "fp16" in dtype:
            weight = activation = output = raw_encoding("fp16", 16, runtime_prov)
            compute = "tensor_fp16_dense"
            accumulator = "fp16"
        else:
            weight = activation = output = raw_encoding("bf16", 16, runtime_prov)
            compute = "tensor_bf16_dense"
            accumulator = "fp32"
        segments.append({"segment_id": f"segment-runtime-{index+1}-{precision_id}", "selector": {"kind": "execution_groups", "refs": sorted(refs)}, "weight": weight, "activation": activation, "output": output, "accumulator_dtype": accumulator, "compute_class": compute, "dequantization": {"mode": "none", "floating_flop_per_weight": 0, "integer_op_per_weight": 0, "materialized_bytes_per_weight": 0}})
    return segments


def default_scenarios(graph_records, realizations, runs):
    result = []
    for model_id, config in MODEL_DEFAULTS.items():
        graph = graph_records[config["graph"]]
        source_ids = graph["source_ids"]
        specs = default_precision_specs(source_ids)
        for path_id, (label, kind, segment) in specs.items():
            scenario_missing = [missing("workload.semantic_prompt_tokens", "not_reported", "The selected logical default fixes executed post-tokenization length; semantic length is not asserted.")]
            if config["workload"]["public_action_dimension"] is None:
                scenario_missing.append(missing("workload.public_action_dimension", "not_reported", "The logical graph does not assert a public action dimension."))
            result.append({"schema_version": VERSION, "scenario_id": f"scenario-{model_id}-{path_id}-default", "label": f"{model_id} default · {label}", "origin": "default_precomputed", "model_id": model_id, "model_graph_id": config["graph"], "model_artifact_id": config["artifact"], "workload": config["workload"], "precision_path": {"precision_path_id": path_id, "kind": kind, "segments": [segment], "runtime_support": "unproven", "realization_ids": []}, "modeling_scope": "ideal_analytical", "provenance": ANALYTICAL(source_ids, "materialize the canonical logical graph at its artifact-native default with FMA=2", [config["graph"], CEILING]), "missing": scenario_missing})
        realization = realizations[config["realization"]]
        runtime_workload, representative = runtime_default_workload(config["workload"], realization, runs)
        runtime_source_ids = list(dict.fromkeys([
            *source_ids,
            *(item["source_id"] for item in realization["evidence"] if item.get("source_id")),
        ]))
        workload_key = (
            f"V={runtime_workload['executed_camera_views']},"
            f"L_PROMPT={runtime_workload['executed_prompt_tokens']},"
            f"T_ACTION={runtime_workload['action_horizon']},"
            f"N_DENOISE={runtime_workload['denoise_steps']}"
        )
        result.append({"schema_version": VERSION, "scenario_id": f"scenario-{model_id}-runtime_mixed-default", "label": f"{model_id} representative runtime matrix {workload_key} · evidenced mixed allocation", "origin": "default_precomputed", "model_id": model_id, "model_graph_id": config["graph"], "model_artifact_id": representative["model_artifact_id"], "workload": runtime_workload, "precision_path": {"precision_path_id": "runtime_mixed", "kind": "mapped_mixed", "segments": runtime_scenario_segments(realization, runtime_source_ids), "runtime_support": "proven", "realization_ids": [config["realization"]]}, "modeling_scope": "implementation_modeled", "provenance": ANALYTICAL(runtime_source_ids, "materialize source-backed representative runtime-matrix coordinates with realization-native action applicability and map formula-backed logical work to exact Task 4 execution groups", [config["graph"], config["realization"], representative["run_id"], CEILING], f"Coordinates {workload_key} are representative matrix values, distinct from logical BF16 defaults. Semantic/executed prompt lengths come verbatim from {representative['configuration_id']}; no conversion is inferred. Action horizon, public/internal dimensions, and NFE come from realization applicability. The run supplies workload only—never latency or telemetry. The curated graph may map across a runtime artifact; coverage remains partial."), "missing": []})
    return result


def legacy_scenarios_and_bases(runs):
    scenarios, bases = [], []
    for run in sorted((r for r in runs if r["runtime_id"] == "vla-perf"), key=lambda r: r["run_id"]):
        vla = run["workload"]["vla"]
        requested = run["precision"]["requested"]
        path_id = "fp8_w8a8" if run["precision"]["precision_id"] == "uniform-fp8" else "fp16_dense"
        bits = 8 if path_id == "fp8_w8a8" else 16
        fmt = "fp8_e4m3" if bits == 8 else "fp16"
        klass = "tensor_fp8_e4m3_dense" if bits == 8 else "tensor_fp16_dense"
        encoding = raw_encoding(fmt, bits, LEGACY("Legacy VLA-Perf uniform dtype; scale metadata is not modeled."))
        sid = f"scenario-legacy-{run['run_id']}"
        scenarios.append({"schema_version": VERSION, "scenario_id": sid, "label": f"Legacy VLA-Perf · {run['model_id']} · requested {requested} / resolved {fmt}", "origin": "legacy_import", "model_id": run["model_id"], "model_graph_id": None, "model_artifact_id": run["model_artifact_id"], "workload": {"batch_size": run["workload"]["common"]["batch_size"], "active_camera_views": vla["camera_views"], "executed_camera_views": vla["camera_views"], "raw_image_height": None, "raw_image_width": None, "executed_image_height": None, "executed_image_width": None, "semantic_prompt_tokens": vla["semantic_prompt_tokens"], "executed_prompt_tokens": vla["executed_prompt_tokens"], "action_horizon": vla["action_chunk"], "public_action_dimension": None, "internal_action_dimension": vla["action_dimension"], "denoise_steps": vla["denoise_steps"], "work_unit": "action_chunk"}, "precision_path": {"precision_path_id": path_id, "kind": "uniform", "segments": [{"segment_id": f"segment-legacy-{run['run_id']}", "selector": {"kind": "all", "refs": []}, "weight": encoding, "activation": encoding, "output": encoding, "accumulator_dtype": "fp16", "compute_class": klass, "dequantization": {"mode": "none", "floating_flop_per_weight": 0, "integer_op_per_weight": 0, "materialized_bytes_per_weight": 0}}], "runtime_support": "unknown", "realization_ids": []}, "modeling_scope": "legacy_component_envelope", "provenance": LEGACY(f"Requested precision {requested}; VLA-Perf resolved BF16 requests to FP16."), "missing": [missing("model_graph_id", "incompatible_basis", "Legacy component envelopes are intentionally not attached to the logical graph."), missing("workload.raw_image_height", "unavailable_from_source", "Legacy VLA-Perf component record omitted image size."), missing("workload.raw_image_width", "unavailable_from_source", "Legacy VLA-Perf component record omitted image size."), missing("workload.executed_image_height", "unavailable_from_source", "Legacy VLA-Perf component record omitted executed image size."), missing("workload.executed_image_width", "unavailable_from_source", "Legacy VLA-Perf component record omitted executed image size."), missing("workload.public_action_dimension", "not_reported", "Legacy component envelope does not establish the public action boundary.")]})
        traffic_basis = "legacy_custom_resident_score" if run["model_id"] == "smolvla" else "legacy_inverse_roofline"
        basis_id = f"basis-legacy-{run['run_id']}"
        bases.append({"schema_version": VERSION, "basis_id": basis_id, "label": f"Legacy VLA-Perf component envelope · {run['run_id']}", "level": "stage", "scenario_id": sid, "precision_path_id": path_id, "ceiling_id": "thor-t5000-vla-perf-legacy", "bandwidth_ceiling_id": "bw-vla-perf-270gib", "device_id": DEVICE, "operating_point_id": "vla-perf-legacy-assumption", "work_unit": "action_chunk", "time_basis": "legacy_analytical_prediction", "traffic_basis": traffic_basis, "work_basis": "legacy_component_aggregate", "aggregation": "entity", "runtime_overhead": "not_applicable", "runtime_id": None, "realization_id": None, "run_id": run["run_id"], "capture_id": None, "comparison_mode": "inventory", "provenance": LEGACY("One VLA-Perf run contributes exactly three non-mapped component envelopes."), "missing": [missing("runtime_id", "not_applicable", "VLA-Perf is an analytical tool here, not a selected runtime realization."), missing("realization_id", "not_applicable", "Legacy component envelopes have no Task 4 realization."), missing("capture_id", "not_collected", "No profiler capture belongs to this analytical basis.")]})
    return scenarios, bases


def default_bases(scenarios):
    bases = []
    for scenario in (s for s in scenarios if s["origin"] == "default_precomputed"):
        path_id = scenario["precision_path"]["precision_path_id"]
        runtime_mixed = path_id == "runtime_mixed"
        realization_id = scenario["precision_path"]["realization_ids"][0] if runtime_mixed else None
        config = MODEL_DEFAULTS[scenario["model_id"]]
        for level in ("stage", "atomic"):
            basis_id = f"basis-{scenario['model_id']}-{path_id}-{level}-default"
            bases.append({"schema_version": VERSION, "basis_id": basis_id, "label": f"{scenario['label']} · {level.title()}", "level": level, "scenario_id": scenario["scenario_id"], "precision_path_id": path_id, "ceiling_id": CEILING, "bandwidth_ceiling_id": BANDWIDTH, "device_id": DEVICE, "operating_point_id": "thor-120w-1386mhz-analytical", "work_unit": "action_chunk" if level == "stage" else "operator_invocation", "time_basis": "analytical_roof", "traffic_basis": "atomic_materialized", "work_basis": "runtime_executed_formula" if runtime_mixed else "logical_formula", "aggregation": "dag_resource_and_critical_path" if level == "stage" else "entity", "runtime_overhead": "excluded", "runtime_id": config["runtime"] if runtime_mixed else None, "realization_id": realization_id, "run_id": None, "capture_id": None, "comparison_mode": "same_coverage_only", "provenance": scenario["provenance"], "missing": [missing("run_id", "not_applicable", "Analytical basis has no observed run."), missing("capture_id", "not_collected", "No profiler capture is bound to this analytical basis."), *([] if runtime_mixed else [missing("runtime_id", "not_applicable", "Ideal analytical what-if is runtime-independent."), missing("realization_id", "not_applicable", "Ideal analytical what-if has no realization.")])]})
        if runtime_mixed:
            bases.append({"schema_version": VERSION, "basis_id": f"basis-{scenario['model_id']}-runtime_mixed-fused-default", "label": f"{scenario['label']} · Fused boundary evidence pending", "level": "fused", "scenario_id": scenario["scenario_id"], "precision_path_id": path_id, "ceiling_id": CEILING, "bandwidth_ceiling_id": BANDWIDTH, "device_id": DEVICE, "operating_point_id": "thor-120w-1386mhz-analytical", "work_unit": "execution_group", "time_basis": "analytical_roof", "traffic_basis": "fused_boundary_modeled", "work_basis": "runtime_executed_formula", "aggregation": "entity", "runtime_overhead": "excluded", "runtime_id": config["runtime"], "realization_id": realization_id, "run_id": None, "capture_id": None, "comparison_mode": "same_coverage_only", "provenance": scenario["provenance"], "missing": [missing("points", "missing_traffic", "Task 4 proves exact group mappings but not boundary-global materialization/exclusion traffic; no fused point is emitted."), missing("run_id", "not_applicable", "No observed run is basis-compatible."), missing("capture_id", "not_collected", "No profiler capture supplies fused boundary traffic.")]})
    return bases


def safe_id(value):
    return re.sub(r"[^a-zA-Z0-9_.-]+", "--", value)


def tensor_values(shape):
    result = 1
    for value in shape:
        result *= value
    return result


def encoding_components(values, encoding, base_kind, tensor_ref, prefix, provenance, calls=1):
    bits = encoding["bits_per_value"]
    components = []
    if encoding["padding"] == "none":
        data = math.ceil(values * bits / 8) * calls
        components.append({"component_id": f"{prefix}-data", "kind": base_kind, "byte": data, "tensor_ref": tensor_ref, "provenance": provenance})
        scale = encoding["tensor_scale_bytes"] * calls
        if scale:
            components.append({"component_id": f"{prefix}-tensor-scale", "kind": "scale_read", "byte": scale, "tensor_ref": tensor_ref, "provenance": provenance})
        return components
    block = encoding["block_values"]
    blocks = math.ceil(values / block)
    valid_data = math.ceil(values * bits / 8)
    packed_data = blocks * encoding["packed_data_bytes_per_block"]
    components.append({"component_id": f"{prefix}-packed-data", "kind": base_kind, "byte": valid_data * calls, "tensor_ref": tensor_ref, "provenance": provenance})
    if packed_data > valid_data:
        components.append({"component_id": f"{prefix}-padding", "kind": "padding_overfetch", "byte": (packed_data - valid_data) * calls, "tensor_ref": tensor_ref, "provenance": provenance})
    scale = (blocks * encoding["scale_bytes_per_block"] + encoding["tensor_scale_bytes"]) * calls
    if scale:
        components.append({"component_id": f"{prefix}-scales", "kind": "scale_read", "byte": scale, "tensor_ref": tensor_ref, "provenance": provenance})
    zero = blocks * encoding["zero_point_bytes_per_block"] * calls
    if zero:
        components.append({"component_id": f"{prefix}-zero-points", "kind": "zero_point_read", "byte": zero, "tensor_ref": tensor_ref, "provenance": provenance})
    return components


def point_derived(work_components, traffic_components, status="complete", stage_terms=None):
    total_flop = sum(item["flop"] for item in work_components)
    total_byte = sum(item["byte"] for item in traffic_components)
    allocations = defaultdict(float)
    missing_compute = False
    for item in work_components:
        if not item["flop"]:
            continue
        klass = item["compute_class"]
        if klass is None or klass not in COMPUTE_RATES:
            missing_compute = True
        else:
            allocations[klass] += item["flop"]
    compute = None if missing_compute else sum(flop / COMPUTE_RATES[klass] for klass, flop in allocations.items())
    memory = total_byte / 273e9
    if stage_terms is not None:
        compute = stage_terms["resource_compute_second"]
        memory = stage_terms["resource_memory_second"]
        roof = stage_terms["roof_second"]
        limiter = stage_terms["limiter"]
    elif compute is None:
        roof = None
        limiter = "unknown"
    else:
        roof = max(compute, memory)
        limiter = "tie" if math.isclose(compute, memory, rel_tol=1e-9, abs_tol=1e-12) else "compute" if compute > memory else "memory"
    return {"status": "unavailable" if roof is None else status, "arithmetic_intensity_flop_per_byte": total_flop / total_byte, "compute_second": compute, "memory_second": memory, "roof_second": roof, "roof_flop_per_second": total_flop / roof if roof else None, "achieved_flop_per_second": None, "efficiency": None, "gap": None, "limiter": limiter}


def work_component(component_id, kind, klass, flop, provenance, comparison=0, transcendental=0, integer_ops=0):
    return {"component_id": component_id, "kind": kind, "compute_class": klass, "flop": flop, "comparison_ops": comparison, "transcendental_ops": transcendental, "integer_ops": integer_ops, "provenance": provenance}


def make_point(point_id, basis_id, entity, calls, work_components, traffic_components, coverage, provenance, derived_status="complete", aggregation=None, extra_missing=()):
    derived = point_derived(work_components, traffic_components, derived_status)
    misses = [missing("timing.observed_second", "not_applicable", "Analytical envelope has no observed duration.")]
    if derived["compute_second"] is None:
        misses.extend([missing("derived.compute_second", "missing_compute_ceiling", "At least one nonzero work class has no defensible ceiling."), missing("derived.roof_second", "missing_compute_ceiling", "A complete composite roof cannot be formed without every work-class ceiling."), missing("derived.roof_flop_per_second", "missing_compute_ceiling", "A complete composite roof rate is unavailable.")])
    misses.extend(extra_missing)
    return {"schema_version": VERSION, "point_id": point_id, "basis_id": basis_id, "entity": entity, "calls": calls, "values_scope": "all_calls", "work": {"components": work_components, "total_flop": sum(item["flop"] for item in work_components)}, "traffic": {"memory_domain": "system_memory", "value_kind": "modeled", "components": traffic_components, "excluded_internal": [], "total_byte": sum(item["byte"] for item in traffic_components)}, "timing": {"observed_second": None, "statistic": "analytical", "sample_count": 0, "timing_boundary_id": "analytical-envelope-all-calls"}, "aggregation": aggregation or {"member_point_ids": [], "dependency_edges": [], "dependency_lower_bound_second": None, "resource_compute_lower_bound_second": None, "resource_memory_lower_bound_second": None}, "coverage": coverage, "derived": derived, "legacy_record_refs": [], "provenance": provenance, "missing": misses}


def iter_operators(materialized):
    for stage in materialized["stages"]:
        for module in stage["modules"]:
            template = module["template"]
            prefix = f"{stage['stage_id']}/{module['module_id']}"
            for operator in template.get("operators", []):
                yield stage["stage_id"], f"{prefix}/{operator['operator_id']}", operator, module["bindings"]
            for component in template.get("components", []):
                for operator in component["template"].get("operators", []):
                    yield stage["stage_id"], f"{prefix}/{component['component_id']}/{operator['operator_id']}", operator, component["bindings"]


def runtime_ref_map(realization):
    result = defaultdict(list)
    for mapping in realization["mappings"]:
        if mapping["certainty"] != "exact" or mapping["path"] != "primary":
            continue
        for target in mapping["logical_targets"]:
            for group_id in mapping["execution_group_ids"]:
                result[target["ref"]].append(group_id)
    return result


def attention_shape(env):
    if "T" in env:
        return {"batch": env["B"] * env.get("V", 1), "query_heads": env["H"], "kv_heads": env.get("KVH", env["H"]), "query_length": env["T"], "key_length": env["T"], "head_width": env["HD"]}
    if "S" in env:
        return {"batch": env["B"], "query_heads": env["H"], "kv_heads": env.get("KVH", env["H"]), "query_length": env["S"], "key_length": env["S"], "head_width": env["HD"]}
    return {"batch": env["B"], "query_heads": env["H"], "kv_heads": env.get("KVH", env["H"]), "query_length": env["SQ"], "key_length": env.get("SKV", env["SP"]), "head_width": env["HD"]}


def linear_point(model_id, path_id, scenario, basis_id, stage_id, ref, operator, segment, provenance):
    bindings = operator["bindings"]
    calls = operator["effective_repeat"]
    m, k, n = bindings["M"], bindings["K"], bindings["N"]
    main_flop = 2 * m * k * n * calls
    work = [work_component(f"{ref}:gemm", "gemm", segment["compute_class"], main_flop, provenance)]
    dequant = segment["dequantization"]
    weight_values = k * n
    if dequant["floating_flop_per_weight"]:
        work.append(work_component(f"{ref}:dequant", "dequant", "tensor_bf16_dense", weight_values * calls * dequant["floating_flop_per_weight"], provenance, integer_ops=weight_values * calls * dequant["integer_op_per_weight"]))
    traffic = []
    traffic.extend(encoding_components(m * k, segment["activation"], "input_read", f"{ref}:input", f"{safe_id(ref)}-input", provenance, calls))
    traffic.extend(encoding_components(k * n, segment["weight"], "weight_read", f"{ref}:weight", f"{safe_id(ref)}-weight", provenance, calls))
    traffic.extend(encoding_components(m * n, segment["output"], "boundary_output_write", f"{ref}:output", f"{safe_id(ref)}-output", provenance, calls))
    partial = bool(dequant["integer_op_per_weight"])
    point_id = f"point-{model_id}-{path_id}-atomic-{safe_id(ref)}"
    entity = {"kind": "atomic_operator", "entity_id": ref, "label": operator["label"], "shape_or_coverage": f"[{m},{k}] @ [{k},{n}] × {calls} calls", "logical_refs": [ref], "coverage_key": f"logical:{ref}|shape:{m}x{k}x{n}|calls:{calls}"}
    coverage = {"status": "partial" if partial else "complete", "included_refs": [ref], "omitted": ([{"ref": f"{ref}:integer-unpack", "reason": "Integer unpack operations have no separate execution-rate ceiling."}] if partial else [])}
    return make_point(point_id, basis_id, entity, calls, work, traffic, coverage, provenance, "partial_lower_bound" if partial else "complete", extra_missing=([missing("work.integer_unpack_second", "missing_compute_ceiling", "Packed weight unpack operations remain counted but un-timed.")] if partial else []))


def attention_points(model_id, path_id, basis_id, stage_id, ref, operator, env, segment, provenance, part_segments=None):
    shape = attention_shape(env)
    calls = operator["effective_repeat"]
    base = attention_metrics(shape["batch"], shape["query_heads"], shape["kv_heads"], shape["query_length"], shape["key_length"], shape["head_width"], 2)
    scores = shape["batch"] * shape["query_heads"] * shape["query_length"] * shape["key_length"]
    rows = shape["batch"] * shape["query_heads"] * shape["query_length"]
    score_segment = part_segments[0] if part_segments else segment
    value_segment = part_segments[-1] if part_segments else segment
    q_values = shape["batch"] * shape["query_heads"] * shape["query_length"] * shape["head_width"]
    kv_values = shape["batch"] * shape["kv_heads"] * shape["key_length"] * shape["head_width"]
    score_values = scores
    def traffic_for(part, active_segment):
        values = []
        prefix = f"{safe_id(ref)}-{part}"
        if part == "score":
            values += encoding_components(q_values, active_segment["activation"], "input_read", f"{ref}:Q", f"{prefix}-q", provenance, calls)
            values += encoding_components(kv_values, active_segment["activation"], "input_read", f"{ref}:K", f"{prefix}-k", provenance, calls)
            values += encoding_components(score_values, active_segment["output"], "boundary_output_write", f"{ref}:logits", f"{prefix}-logits", provenance, calls)
        elif part == "softmax":
            values += encoding_components(score_values, active_segment["activation"], "input_read", f"{ref}:logits", f"{prefix}-logits", provenance, calls)
            values += encoding_components(score_values, active_segment["output"], "boundary_output_write", f"{ref}:probabilities", f"{prefix}-prob", provenance, calls)
        else:
            values += encoding_components(score_values, active_segment["activation"], "input_read", f"{ref}:probabilities", f"{prefix}-prob", provenance, calls)
            values += encoding_components(kv_values, active_segment["activation"], "input_read", f"{ref}:V", f"{prefix}-v", provenance, calls)
            values += encoding_components(q_values, active_segment["output"], "boundary_output_write", f"{ref}:O", f"{prefix}-o", provenance, calls)
        return values
    score_work = [work_component(f"{ref}:score", "attention_score", score_segment["compute_class"], base["score_flop"] * calls, provenance)]
    soft_work = [work_component(f"{ref}:scale", "attention_scale_mask", None, base["scale_scalar_flop"] * calls, provenance), work_component(f"{ref}:softmax", "attention_softmax", None, base["softmax_scalar_flop"] * calls, provenance, comparison=base["comparison_ops"] * calls, transcendental=base["transcendental_ops"] * calls)]
    value_work = [work_component(f"{ref}:value", "attention_value", value_segment["compute_class"], base["value_flop"] * calls, provenance)]
    score_traffic, soft_traffic, value_traffic = traffic_for("score", score_segment), traffic_for("softmax", score_segment), traffic_for("value", value_segment)
    shape_label = f"B{shape['batch']} Hq{shape['query_heads']}/Hkv{shape['kv_heads']} Lq{shape['query_length']} Lk{shape['key_length']} Dh{shape['head_width']} × {calls}"
    result = []
    for part, label, work, traffic in (("score", "Q @ Kᵀ score", score_work, score_traffic), ("softmax", "Scale / mask / softmax", soft_work, soft_traffic), ("value", "P @ V value", value_work, value_traffic)):
        point_id = f"point-{model_id}-{path_id}-atomic-{safe_id(ref)}-{part}"
        partial = part == "softmax" or point_derived(work, traffic)["roof_second"] is None
        entity = {"kind": "atomic_operator", "entity_id": f"{ref}#{part}", "label": f"{operator['label']} · {label}", "shape_or_coverage": shape_label, "logical_refs": [ref], "coverage_key": f"logical:{ref}|part:{part}|shape:{shape_label}"}
        coverage = {"status": "partial" if partial else "complete", "included_refs": [f"{ref}#{part}"], "omitted": ([{"ref": f"{ref}#scalar-sfu-ceiling", "reason": "Scalar comparison and SFU ceilings are unavailable."}] if part == "softmax" else [])}
        result.append(make_point(point_id, basis_id, entity, calls, work, traffic, coverage, provenance, "partial_lower_bound" if partial else "complete"))
    composite_work = score_work + soft_work + value_work
    composite_traffic = score_traffic + soft_traffic + value_traffic
    point_id = f"point-{model_id}-{path_id}-atomic-{safe_id(ref)}-composite"
    entity = {"kind": "atomic_operator", "entity_id": f"{ref}#composite", "label": f"{operator['label']} · Partial envelope", "shape_or_coverage": shape_label, "logical_refs": [ref], "coverage_key": f"logical:{ref}|part:composite|shape:{shape_label}"}
    coverage = {"status": "partial", "included_refs": [f"{ref}#score", f"{ref}#softmax", f"{ref}#value"], "omitted": [{"ref": f"{ref}#scalar-sfu-ceiling", "reason": "Scalar/SFU work remains explicit but cannot form a complete composite roof."}]}
    result.append(make_point(point_id, basis_id, entity, calls, composite_work, composite_traffic, coverage, provenance, "partial_lower_bound"))
    return result


def flat_edges(materialized):
    edges = set()
    module_context = {}
    def tensor(template, tensor_id):
        return next((item for item in template.get("tensors", []) if item["tensor_id"] == tensor_id), None)
    def component(template, component_id):
        return next((item for item in template.get("components", []) if item["component_id"] == component_id), None)
    def producers(template, endpoint, prefix):
        if endpoint is None:
            return []
        if endpoint["node_kind"] == "operator":
            return [f"{prefix}/{endpoint['node_id']}"]
        if endpoint["node_kind"] != "component":
            return []
        child = component(template, endpoint["node_id"])
        port = next((item for item in child["template"]["output_ports"] if item["port"] == endpoint["port"]), None)
        return producers(child["template"], tensor(child["template"], port["tensor_id"])["producer"], f"{prefix}/{child['component_id']}") if port else []
    def consumers(template, endpoint, prefix):
        if endpoint["node_kind"] == "operator":
            return [f"{prefix}/{endpoint['node_id']}"]
        if endpoint["node_kind"] != "component":
            return []
        child = component(template, endpoint["node_id"])
        port = next((item for item in child["template"]["input_ports"] if item["port"] == endpoint["port"]), None)
        local = tensor(child["template"], port["tensor_id"]) if port else None
        return sum((consumers(child["template"], item, f"{prefix}/{child['component_id']}") for item in local["consumers"]), []) if local else []
    for stage in materialized["stages"]:
        for module in stage["modules"]:
            prefix = f"{stage['stage_id']}/{module['module_id']}"
            module_context[module["module_id"]] = (stage["stage_id"], module)
            def visit(template, local_prefix):
                for item in template.get("tensors", []):
                    sources = producers(template, item["producer"], local_prefix)
                    targets = sum((consumers(template, target, local_prefix) for target in item["consumers"]), [])
                    edges.update((source, target) for source in sources for target in targets if source != target)
                for child in template.get("components", []):
                    visit(child["template"], f"{local_prefix}/{child['component_id']}")
            visit(module["template"], prefix)
    for item in materialized["graph_tensors"]:
        endpoint = item["producer"]
        sources = []
        if endpoint and endpoint["node_kind"] == "module":
            stage_id, module = module_context[endpoint["node_id"]]
            port = next((value for value in module["template"]["output_ports"] if value["port"] == endpoint["port"]), None)
            local = tensor(module["template"], port["tensor_id"]) if port else None
            sources = producers(module["template"], local["producer"], f"{stage_id}/{module['module_id']}") if local else []
        targets = []
        for endpoint in item["consumers"]:
            if endpoint["node_kind"] != "module":
                continue
            stage_id, module = module_context[endpoint["node_id"]]
            port = next((value for value in module["template"]["input_ports"] if value["port"] == endpoint["port"]), None)
            local = tensor(module["template"], port["tensor_id"]) if port else None
            if local:
                targets += sum((consumers(module["template"], target, f"{stage_id}/{module['module_id']}") for target in local["consumers"]), [])
        edges.update((source, target) for source in sources for target in targets if source != target)
    return edges


def projected_edges(edges, selected):
    adjacency = defaultdict(list)
    for source, target in edges:
        adjacency[source].append(target)
    result = set()
    for source in selected:
        pending = list(adjacency[source])
        seen = set()
        while pending:
            target = pending.pop()
            if target in seen:
                continue
            seen.add(target)
            if target in selected:
                result.add((source, target))
            else:
                pending.extend(adjacency[target])
    return result


def stage_point(model_id, path_id, basis_id, stage_id, graph_id, all_ops, atomic_points, graph_edges, provenance):
    eligible = [point for point in atomic_points if point["entity"]["logical_refs"] and point["entity"]["logical_refs"][0].startswith(f"{stage_id}/") and point["derived"]["roof_second"] is not None and not point["entity"]["entity_id"].endswith(("#composite", "#softmax"))]
    if not eligible:
        return None
    by_ref = defaultdict(list)
    for point in eligible:
        by_ref[point["entity"]["logical_refs"][0]].append(point)
    selected_refs = set(by_ref)
    logical_dependencies = projected_edges(graph_edges, selected_refs)
    nodes, dependencies = [], []
    member_by_id = {}
    for ref, ref_points in by_ref.items():
        ordered = sorted(ref_points, key=lambda item: 0 if item["entity"]["entity_id"].endswith("#score") else 1)
        for point in ordered:
            member_by_id[point["point_id"]] = point
            nodes.append({"id": point["point_id"], "roof_second": point["derived"]["roof_second"], "compute_second": point["derived"]["compute_second"], "memory_second": point["derived"]["memory_second"]})
        if len(ordered) > 1:
            dependencies.extend({"source": ordered[index]["point_id"], "target": ordered[index+1]["point_id"]} for index in range(len(ordered)-1))
    for source, target in logical_dependencies:
        dependencies.append({"source": sorted(by_ref[source], key=lambda item: item["point_id"])[-1]["point_id"], "target": sorted(by_ref[target], key=lambda item: item["point_id"])[0]["point_id"]})
    terms = stage_lower_bound(nodes, dependencies)
    work = []
    traffic = []
    for point in eligible:
        work.extend({**item, "component_id": f"{point['point_id']}--member--{item['component_id']}"} for item in point["work"]["components"])
        traffic.extend({**item, "component_id": f"{point['point_id']}--member--{item['component_id']}"} for item in point["traffic"]["components"])
    included = sorted(selected_refs)
    omitted = [{"ref": ref, "reason": "No approved complete tensor-core formula/ceiling pair is available for this logical operation."} for ref in sorted(set(all_ops) - selected_refs) if ref.startswith(f"{stage_id}/")]
    stage_key = "model_total" if stage_id == "model_total" else stage_id
    point_id = f"point-{model_id}-{path_id}-stage-{safe_id(stage_key)}"
    entity = {"kind": "model_total" if stage_id == "model_total" else "stage", "entity_id": f"{graph_id}/{stage_key}", "label": "Model total" if stage_id == "model_total" else stage_id.replace("-", " ").title(), "shape_or_coverage": f"{len(eligible)} formula-backed atomic components; partial lower bound", "logical_refs": [f"{graph_id}/{stage_key}"], "coverage_key": f"stage:{graph_id}/{stage_key}|members:{'|'.join(included)}"}
    coverage = {"status": "partial", "included_refs": included, "omitted": omitted}
    aggregation = {"member_point_ids": sorted(member_by_id), "dependency_edges": sorted(dependencies, key=lambda item: (item["source"], item["target"])), "dependency_lower_bound_second": terms["dependency_second"], "resource_compute_lower_bound_second": terms["resource_compute_second"], "resource_memory_lower_bound_second": terms["resource_memory_second"]}
    point = make_point(point_id, basis_id, entity, 1, work, traffic, coverage, provenance, "partial_lower_bound", aggregation, [missing("coverage", "missing_work", "Formula-less logical operations and scalar/SFU timing remain omitted from this lower bound.")])
    point["derived"] = point_derived(work, traffic, "partial_lower_bound", terms)
    return point


def logical_points(graph_records, scenarios, bases, realizations):
    points = []
    basis_by = {(basis["scenario_id"], basis["level"]): basis for basis in bases if basis["level"] in {"atomic", "stage"}}
    for scenario in (item for item in scenarios if item["origin"] == "default_precomputed"):
        model_id = scenario["model_id"]
        path_id = scenario["precision_path"]["precision_path_id"]
        graph = graph_records[scenario["model_graph_id"]]
        overrides = {"V": scenario["workload"]["executed_camera_views"], "L_PROMPT": scenario["workload"]["executed_prompt_tokens"], "T_ACTION": scenario["workload"]["action_horizon"], "N_DENOISE": scenario["workload"]["denoise_steps"]}
        materialized = materialize_model_graph(graph, overrides)
        provenance = scenario["provenance"]
        atomic_basis = basis_by[(scenario["scenario_id"], "atomic")]["basis_id"]
        stage_basis = basis_by[(scenario["scenario_id"], "stage")]["basis_id"]
        operators = list(iter_operators(materialized))
        all_refs = [ref for _, ref, _, _ in operators]
        runtime_map = runtime_ref_map(realizations[scenario["precision_path"]["realization_ids"][0]]) if path_id == "runtime_mixed" else None
        uniform_segment = scenario["precision_path"]["segments"][0] if path_id != "runtime_mixed" else None
        segment_by_group = {
            group_id: segment
            for segment in scenario["precision_path"]["segments"]
            for group_id in segment["selector"]["refs"]
        } if runtime_map is not None else {}
        atomic = []
        for stage_id, ref, operator, env in operators:
            if operator["definition_id"] not in {"linear", "attention-core"}:
                continue
            part_segments = None
            if runtime_map is not None:
                mapped = [segment_by_group[group_id] for group_id in runtime_map.get(ref, []) if group_id in segment_by_group]
                if not mapped:
                    continue
                segment = mapped[0]
                if operator["definition_id"] == "attention-core" and len(mapped) > 1:
                    part_segments = mapped
            else:
                segment = uniform_segment
            if operator["definition_id"] == "linear":
                atomic.append(linear_point(model_id, path_id, scenario, atomic_basis, stage_id, ref, operator, segment, provenance))
            else:
                atomic.extend(attention_points(model_id, path_id, atomic_basis, stage_id, ref, operator, env, segment, provenance, part_segments))
        points.extend(atomic)
        edges = flat_edges(materialized)
        for stage in materialized["stages"]:
            point = stage_point(model_id, path_id, stage_basis, stage["stage_id"], graph["model_graph_id"], all_refs, atomic, edges, provenance)
            if point:
                points.append(point)
        total = stage_point(model_id, path_id, stage_basis, "model_total", graph["model_graph_id"], all_refs, atomic, edges, provenance)
        if total is None:
            # Model-total uses every stage rather than a synthetic stage prefix.
            eligible = [point for point in atomic if point["derived"]["roof_second"] is not None and not point["entity"]["entity_id"].endswith(("#composite", "#softmax"))]
            original_stages = {ref.split("/", 1)[0] for point in eligible for ref in point["entity"]["logical_refs"]}
            shadow_ops = [ref.replace(ref.split("/", 1)[0], "model_total", 1) for ref in all_refs]
            shadow_points = []
            for point in eligible:
                clone = json.loads(json.dumps(point))
                ref = clone["entity"]["logical_refs"][0]
                clone["entity"]["logical_refs"] = [ref.replace(ref.split("/", 1)[0], "model_total", 1)]
                shadow_points.append(clone)
            shadow_edges = {(source.replace(source.split("/", 1)[0], "model_total", 1), target.replace(target.split("/", 1)[0], "model_total", 1)) for source, target in edges}
            total = stage_point(model_id, path_id, stage_basis, "model_total", graph["model_graph_id"], shadow_ops, shadow_points, shadow_edges, provenance)
            if total:
                total["coverage"]["included_refs"] = sorted(ref for point in eligible for ref in point["entity"]["logical_refs"])
                total["entity"]["coverage_key"] = f"stage:{graph['model_graph_id']}/model_total|members:" + "|".join(total["coverage"]["included_refs"])
        if total:
            points.append(total)
    return points


def legacy_points(operators, rooflines, bases, runs):
    operator_by = {item["operator_id"]: item for item in operators}
    roof_by_run = defaultdict(list)
    for roof in rooflines:
        roof_by_run[roof["run_id"]].append(roof)
    basis_by_run = {basis["run_id"]: basis for basis in bases if basis["run_id"]}
    run_by = {run["run_id"]: run for run in runs}
    result = []
    for run_id, run_roofs in sorted(roof_by_run.items()):
        if run_id not in basis_by_run:
            continue
        run = run_by[run_id]
        basis = basis_by_run[run_id]
        for roof in sorted(run_roofs, key=lambda item: item["operator_id"]):
            operator = operator_by[roof["operator_id"]]
            component = operator["module_id"]
            total_flop = operator["work_gflop"] * 1e9
            total_byte = operator["traffic_gib"] * 2**30
            compute_class = "tensor_fp8_e4m3_dense" if roof["precision_id"] == "uniform-fp8" else "tensor_fp16_dense"
            work = [work_component(f"{operator['operator_id']}:legacy-component", "curated_other", compute_class, total_flop, LEGACY(f"Preserves old modeling_fidelity={roof['modeling_fidelity']} and source_method={operator['source_method']}."))]
            traffic = [{"component_id": f"{operator['operator_id']}:legacy-derived-traffic", "kind": "runtime_extra", "byte": total_byte, "tensor_ref": None, "provenance": LEGACY("Algebraic legacy component traffic; not independently measured DRAM bytes.")}]
            coverage_status = "proxy" if run["model_id"] == "pi05" else "unmapped_legacy"
            point_id = f"point-legacy-{roof['roofline_id']}"
            entity = {"kind": "legacy_component", "entity_id": point_id, "label": f"Legacy VLA-Perf component envelope · {component}", "shape_or_coverage": f"{run['model_id']} {component}; {roof['modeling_fidelity']} legacy model", "logical_refs": [], "coverage_key": f"legacy:{run_id}|component:{component}|precision:{roof['precision_id']}"}
            compute = total_flop / roof["compute_peak_gflop_per_s"] / 1e9
            memory = total_byte / (roof["bandwidth_gib_per_s"] * 2**30)
            predicted = roof["predicted_ms"] / 1000
            assert math.isclose(max(compute, memory), predicted, rel_tol=1e-9, abs_tol=1e-12)
            limiter = "tie" if math.isclose(compute, memory, rel_tol=1e-9, abs_tol=1e-12) else "compute" if compute > memory else "memory"
            derived = {"status": "partial_lower_bound", "arithmetic_intensity_flop_per_byte": total_flop / total_byte, "compute_second": compute, "memory_second": memory, "roof_second": predicted, "roof_flop_per_second": total_flop / predicted, "achieved_flop_per_second": None, "efficiency": None, "gap": None, "limiter": limiter}
            result.append({"schema_version": VERSION, "point_id": point_id, "basis_id": basis["basis_id"], "entity": entity, "calls": 10 if component == "action" else 1, "values_scope": "all_calls", "work": {"components": work, "total_flop": total_flop}, "traffic": {"memory_domain": "system_memory", "value_kind": "legacy_derived", "components": traffic, "excluded_internal": [], "total_byte": total_byte}, "timing": {"observed_second": None, "statistic": "analytical", "sample_count": 0, "timing_boundary_id": "vla-perf-component-analytical-prediction"}, "aggregation": {"member_point_ids": [], "dependency_edges": [], "dependency_lower_bound_second": None, "resource_compute_lower_bound_second": None, "resource_memory_lower_bound_second": None}, "coverage": {"status": coverage_status, "included_refs": [], "omitted": [{"ref": "logical_mapping", "reason": "Legacy component envelope is intentionally not mapped to Task 2–4 logical/runtime entities."}]}, "derived": derived, "legacy_record_refs": [{"dataset": "operators", "record_id": operator["operator_id"]}, {"dataset": "rooflines", "record_id": roof["roofline_id"]}], "provenance": LEGACY(f"One-to-one migration; modeling_fidelity={roof['modeling_fidelity']}; source_method={operator['source_method']}."), "missing": [missing("timing.observed_second", "not_applicable", "Legacy predicted duration is analytical, not an observed time."), missing("mapping.logical_refs", "incompatible_basis", "No logical/runtime mapping is claimed."), missing("efficiency", "incompatible_basis", "No measured basis-compatible duration/telemetry exists.")]})
    return result


def add_sources():
    path = ROOT / "data" / "catalog" / "sources.json"
    document = load(path)
    by_id = {item["source_id"]: item for item in document["records"]}
    additions = [
        {"source_id": "source-nvidia-thor-datasheet-v1-5", "evidence": "reported_external", "title": "NVIDIA Jetson Thor Series Modules Data Sheet DS-11945-001 v1.5", "url": "https://developer.nvidia.com/downloads/assets/embedded/secure/jetson/thor/docs/jetson-thor-series-modules-datasheet_ds-11945-001.pdf", "published_date": "2026-06", "accessed_date": "2026-09-05", "summary": "Table 1-1: dense/sparse FP4/FP8 on printed p.1/PDF p.8; GPU caps printed pp.2,8; 273 GB/s and 4266 MHz printed p.3/PDF p.10. Values are up-to specification facts."},
        {"source_id": "source-nvidia-thor-migration-note-v1-2", "evidence": "reported_external", "title": "NVIDIA Jetson T5000 and Jetson AGX Orin Migration Application Note DA-11926-001 v1.2", "url": "https://developer.nvidia.com/downloads/assets/embedded/secure/jetson/thor/docs/jetson-orin-thor-migration-application-note_da.pdf", "published_date": "2025-09", "accessed_date": "2026-09-05", "summary": "Table 1, printed p.4/PDF p.8 explicitly labels the T5000 517 FP16 TFLOP/s value as sparse and up to."},
        {"source_id": "source-nvidia-nvfp4-format", "evidence": "reported_external", "title": "NVIDIA NVFP4 format and Jetson Thor support documentation", "url": "https://docs.nvidia.com/deeplearning/transformer-engine-releases/release-2.15/user-guide/features/low_precision_training/nvfp4/nvfp4.html", "published_date": None, "accessed_date": "2026-09-05", "summary": "Defines NVFP4 as E2M1 with FP8 E4M3 scale per 16 values and global FP32 scale. Used only for a labeled mapping inference; it does not publish a T5000 NVFP4 peak."},
    ]
    by_id.update({item["source_id"]: item for item in additions})
    document["records"] = list(by_id.values())
    write_json(path, document)


def update_manifest():
    path = ROOT / "schema" / "manifest.json"
    document = load(path)
    document["datasets"].update({
        "roofline_ceilings": {"data": "data/analysis/roofline_ceilings.json", "schema": "schema/analysis/roofline_ceilings.schema.json", "schema_version": VERSION, "primary_key": "ceiling_id"},
        "roofline_scenarios": {"data": "data/analysis/roofline_scenarios.json", "schema": "schema/analysis/roofline_scenarios.schema.json", "schema_version": VERSION, "primary_key": "scenario_id"},
        "roofline_bases": {"data": "data/analysis/roofline_bases.json", "schema": "schema/analysis/roofline_bases.schema.json", "schema_version": VERSION, "primary_key": "basis_id"},
        "roofline_points": {"data": "data/analysis/roofline_points.json", "schema": "schema/analysis/roofline_points.schema.json", "schema_version": VERSION, "primary_key": "point_id"},
    })
    write_json(path, document)


def load(path):
    return json.loads(path.read_text())


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def logical_snapshot_problems(datasets):
    """Re-materialize logical traffic from scenarios, graphs, and realizations."""
    graph_records = {
        item["model_graph_id"]: item
        for item in datasets.get("model_graphs", [])
        if isinstance(item.get("model_graph_id"), str)
    }
    realizations = {
        item["realization_id"]: item
        for item in datasets.get("runtime_realizations", [])
        if isinstance(item.get("realization_id"), str)
    }
    scenarios = list(datasets.get("roofline_scenarios", []))
    bases = list(datasets.get("roofline_bases", []))
    expected = logical_points(graph_records, scenarios, bases, realizations)
    canonical = {
        item["point_id"]: (index, item)
        for index, item in enumerate(datasets.get("roofline_points", []))
        if isinstance(item.get("point_id"), str)
    }
    problems = []
    for expected_point in expected:
        point_id = expected_point["point_id"]
        indexed = canonical.get(point_id)
        if indexed is None:
            problems.append(RooflineProblem("$.roofline_points", "logical_snapshot_missing", f"scenario materialization did not find {point_id}"))
            continue
        index, actual = indexed
        base = f"$.roofline_points[{index}]"
        expected_components = [
            (item["component_id"], item["kind"], item["byte"], item["tensor_ref"])
            for item in expected_point["traffic"]["components"]
        ]
        actual_components = [
            (item.get("component_id"), item.get("kind"), item.get("byte"), item.get("tensor_ref"))
            for item in actual.get("traffic", {}).get("components", [])
        ]
        if actual_components != expected_components:
            problems.append(RooflineProblem(f"{base}.traffic.components", "scenario_traffic_mismatch", "logical traffic must re-materialize from scenario role encodings"))
        if actual.get("traffic", {}).get("total_byte") != expected_point["traffic"]["total_byte"]:
            problems.append(RooflineProblem(f"{base}.traffic.total_byte", "scenario_traffic_mismatch", "logical total traffic must re-materialize from its scenario"))
        if actual.get("entity", {}).get("coverage_key") != expected_point["entity"]["coverage_key"]:
            problems.append(RooflineProblem(f"{base}.entity.coverage_key", "scenario_coverage_mismatch", "coverage key must re-materialize from the logical shape and call count"))
    return problems


def main():
    write_schemas()
    add_sources()
    update_manifest()
    graph_records = {}
    for path in (ROOT / "data" / "model_graphs").glob("*.json"):
        graph_records.update({item["model_graph_id"]: item for item in load(path)["records"]})
    realizations = {}
    for path in (ROOT / "data" / "runtime_realizations").glob("*.json"):
        realizations.update({item["realization_id"]: item for item in load(path)["records"]})
    runs = load(ROOT / "data" / "measurements" / "runs.json")["records"]
    old_operators = load(ROOT / "data" / "measurements" / "operators.json")["records"]
    old_rooflines = load(ROOT / "data" / "measurements" / "rooflines.json")["records"]
    scenarios = default_scenarios(graph_records, realizations, runs)
    legacy_scenarios, legacy_bases = legacy_scenarios_and_bases(runs)
    scenarios.extend(legacy_scenarios)
    bases = default_bases(scenarios) + legacy_bases
    points = logical_points(graph_records, scenarios, bases, realizations)
    points.extend(legacy_points(old_operators, old_rooflines, bases, runs))
    documents = {
        "roofline_ceilings": ceilings(),
        "roofline_scenarios": sorted(scenarios, key=lambda item: item["scenario_id"]),
        "roofline_bases": sorted(bases, key=lambda item: item["basis_id"]),
        "roofline_points": sorted(points, key=lambda item: item["point_id"]),
    }
    for dataset, records in documents.items():
        write_json(ROOT / "data" / "analysis" / f"{dataset}.json", {"schema_version": VERSION, "dataset": dataset, "records": records})
    print({name: len(records) for name, records in documents.items()})


if __name__ == "__main__":
    main()
