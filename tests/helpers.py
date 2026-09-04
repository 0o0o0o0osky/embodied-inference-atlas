import copy


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
