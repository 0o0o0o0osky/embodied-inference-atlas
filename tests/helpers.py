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
