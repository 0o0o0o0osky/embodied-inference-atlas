import copy


def valid_model_graph_document() -> dict[str, object]:
    return {
        "schema_version": "1.0.0",
        "dataset": "model_graphs",
        "records": [{
            "model_graph_id": "graph-test",
            "model_id": "pi0",
            "label": "Test graph",
            "version": "1",
            "source_ids": ["source-test"],
            "shape_symbols": [
                {
                    "symbol": "B", "label": "Batch", "semantic": "batch",
                    "editable": False, "default": 1, "minimum": 1, "maximum": 1,
                    "expression": None,
                },
                {
                    "symbol": "V", "label": "Views", "semantic": "views",
                    "editable": True, "default": 3, "minimum": 1, "maximum": 4,
                    "expression": None,
                },
                {
                    "symbol": "S", "label": "Tokens", "semantic": "tokens",
                    "editable": False, "default": None, "minimum": None, "maximum": None,
                    "expression": {"op": "mul", "args": [{"symbol": "V"}, 256]},
                },
            ],
            "operator_definitions": [{
                "definition_id": "linear", "label": "Linear", "category": "linear",
                "formula_display": "Y = XW", "visualizer": "gemm",
                "parameters": ["M", "N", "K"],
                "input_ports": ["input"], "output_ports": ["output"],
                "analysis": [{
                    "metric": "flops", "unit": "operations", "scope": "operator",
                    "expression": {"op": "mul", "args": [2, {"symbol": "M"}, {"symbol": "N"}, {"symbol": "K"}]},
                }],
            }],
            "component_templates": [{
                "template_id": "linear-component", "label": "Linear component",
                "parameters": ["B", "M", "N", "K"],
                "input_ports": [{"port": "input", "tensor_id": "input"}],
                "output_ports": [{"port": "output", "tensor_id": "output"}],
                "tensors": [
                    {
                        "tensor_id": "input", "label": "Input", "semantic_role": "input",
                        "axes": [{"axis": "batch", "expression": {"symbol": "B"}}, {"axis": "tokens", "expression": {"symbol": "M"}}, {"axis": "width", "expression": {"symbol": "K"}}],
                        "producer": None,
                        "consumers": [{"node_kind": "operator", "node_id": "linear-op", "port": "input"}],
                    },
                    {
                        "tensor_id": "output", "label": "Output", "semantic_role": "output",
                        "axes": [{"axis": "batch", "expression": {"symbol": "B"}}, {"axis": "tokens", "expression": {"symbol": "M"}}, {"axis": "width", "expression": {"symbol": "N"}}],
                        "producer": {"node_kind": "operator", "node_id": "linear-op", "port": "output"},
                        "consumers": [],
                    },
                ],
                "operators": [{
                    "operator_id": "linear-op", "label": "Linear", "definition_id": "linear",
                    "multiplicity": 1,
                    "inputs": [{"port": "input", "tensor_id": "input"}],
                    "outputs": [{"port": "output", "tensor_id": "output"}],
                    "bindings": [
                        {"symbol": "M", "expression": {"symbol": "M"}},
                        {"symbol": "N", "expression": {"symbol": "N"}},
                        {"symbol": "K", "expression": {"symbol": "K"}},
                    ],
                }],
            }],
            "block_templates": [{
                "template_id": "linear-block", "label": "Linear block",
                "parameters": ["B", "M", "N", "K"],
                "input_ports": [{"port": "input", "tensor_id": "input"}],
                "output_ports": [{"port": "output", "tensor_id": "output"}],
                "tensors": [
                    {
                        "tensor_id": "input", "label": "Input", "semantic_role": "input",
                        "axes": [{"axis": "batch", "expression": {"symbol": "B"}}, {"axis": "tokens", "expression": {"symbol": "M"}}, {"axis": "width", "expression": {"symbol": "K"}}],
                        "producer": None,
                        "consumers": [{"node_kind": "component", "node_id": "linear", "port": "input"}],
                    },
                    {
                        "tensor_id": "output", "label": "Output", "semantic_role": "output",
                        "axes": [{"axis": "batch", "expression": {"symbol": "B"}}, {"axis": "tokens", "expression": {"symbol": "M"}}, {"axis": "width", "expression": {"symbol": "N"}}],
                        "producer": {"node_kind": "component", "node_id": "linear", "port": "output"},
                        "consumers": [],
                    },
                ],
                "operators": [],
                "components": [{
                    "component_id": "linear", "label": "Linear", "template_id": "linear-component",
                    "inputs": [{"port": "input", "tensor_id": "input"}],
                    "outputs": [{"port": "output", "tensor_id": "output"}],
                    "bindings": [
                        {"symbol": "B", "expression": {"symbol": "B"}},
                        {"symbol": "M", "expression": {"symbol": "M"}},
                        {"symbol": "N", "expression": {"symbol": "N"}},
                        {"symbol": "K", "expression": {"symbol": "K"}},
                    ],
                }],
            }],
            "graph_tensors": [
                {
                    "tensor_id": "graph-input", "label": "Input", "semantic_role": "input",
                    "axes": [{"axis": "batch", "expression": {"symbol": "B"}}, {"axis": "tokens", "expression": {"symbol": "S"}}, {"axis": "width", "expression": 8}],
                    "producer": None,
                    "consumers": [{"node_kind": "module", "node_id": "module", "port": "input"}],
                },
                {
                    "tensor_id": "graph-output", "label": "Output", "semantic_role": "output",
                    "axes": [{"axis": "batch", "expression": {"symbol": "B"}}, {"axis": "tokens", "expression": {"symbol": "S"}}, {"axis": "width", "expression": 8}],
                    "producer": {"node_kind": "module", "node_id": "module", "port": "output"},
                    "consumers": [],
                },
            ],
            "stages": [{
                "stage_id": "stage", "label": "Stage", "description": "Test stage",
                "repeat": 1, "loop_carried": None,
                "modules": [{
                    "module_id": "module", "label": "Module", "template_id": "linear-block",
                    "repeat": 1,
                    "bindings": [
                        {"symbol": "B", "expression": {"symbol": "B"}},
                        {"symbol": "M", "expression": {"symbol": "S"}},
                        {"symbol": "N", "expression": 8},
                        {"symbol": "K", "expression": 8},
                    ],
                    "inputs": [{"port": "input", "tensor_id": "graph-input"}],
                    "outputs": [{"port": "output", "tensor_id": "graph-output"}],
                    "indexed_inputs": [],
                }],
            }],
            "graph_inputs": ["graph-input"],
            "graph_outputs": ["graph-output"],
        }],
    }


def valid_model_document() -> dict[str, object]:
    return {
        "schema_version": "1.0.0",
        "dataset": "models",
        "records": [{
            "model_id": "pi0",
            "display_name": "Pi0",
            "model_type": "vla",
            "artifacts": [{
                "artifact_id": "pi0-test-01",
                "label": "sanitized test artifact",
                "public_model_id": None,
                "public_revision": None,
            }],
            "parameter_count": None,
            "architecture_id": "arch-pi0",
            "input_modalities": ["image", "language", "state"],
            "output_modalities": ["action_chunk"],
            "execution_modes": ["flow_matching"],
            "source_ids": ["source-test"],
        }],
    }


def valid_run(
    run_id: str,
    *,
    precision_id: str = "uniform-fp16",
    views: int = 1,
    correctness: str = "not_assessed",
) -> dict[str, object]:
    workload = {
        "common": {
            "batch_size": 1,
            "input_contract_id": "deterministic-preprocessed-observation",
            "output_contract_id": "action-chunk",
        },
        "vla": {
            "camera_views": views,
            "image_height": 224,
            "image_width": 224,
            "semantic_prompt_tokens": 4,
            "executed_prompt_tokens": 4,
            "action_dimension": 32,
            "action_chunk": 10,
            "denoise_steps": 10,
        },
    }
    precision = {
        "precision_id": precision_id,
        "requested": precision_id,
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
    timing = {
        "timing_boundary_id": "predict_cached_graph_sync",
        "state_reuse": "cached_prompt_and_graph",
        "warm_policy": "steady_state",
        "warmup_iterations": 30,
    }
    operating_point = {
        "operating_point_id": "thor-120w-dynamic",
        "power_mode": "120w-mode-1",
        "clock_policy": "dynamic",
        "throttle_status": "unknown",
    }
    comparison_context = {
        "model_id": "pi0",
        "model_artifact_id": "pi0-test-01",
        "runtime_id": "flashrt",
        "evidence": "measured_local",
        "platform": {
            "device_id": "nvidia-jetson-agx-thor",
            "system_id": "thor-unit-01",
            "operating_point_id": "thor-120w-dynamic",
        },
        "task": {
            "task_id": "synthetic-vla-inference",
            "input_contract_id": "deterministic-preprocessed-observation",
            "output_contract_id": "action-chunk",
            "correctness_policy_id": "finite-only",
        },
        "workload": copy.deepcopy(workload),
        "precision": copy.deepcopy(precision),
        "timing": copy.deepcopy(timing),
        "runtime_overhead": "included",
    }
    return {
        "schema_version": "1.0.0",
        "configuration_id": f"cfg-{run_id}",
        "run_id": run_id,
        "model_id": "pi0",
        "model_artifact_id": "pi0-test-01",
        "runtime_id": "flashrt",
        "device_id": "nvidia-jetson-agx-thor",
        "system_id": "thor-unit-01",
        "source_id": "source-test",
        "evidence": "measured_local",
        "capture_method": "wall_clock",
        "workload": workload,
        "precision": precision,
        "timing": timing,
        "operating_point": operating_point,
        "correctness": {"status": correctness, "criterion": "finite-only"},
        "comparison_context": comparison_context,
        "missing": {},
    }
