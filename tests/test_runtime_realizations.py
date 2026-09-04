import copy
import unittest
from pathlib import Path

from tools.lib.jsonio import load_json
from tools.lib.privacy import scan_json
from tools.validate import validate_references


ROOT = Path(__file__).resolve().parents[1]


class RuntimeRealizationValidationTests(unittest.TestCase):
    def test_mapping_semantics_and_graph_local_references(self):
        pi0 = load_json(ROOT / "data/model_graphs/pi0.json")["records"][0]
        pi05 = load_json(ROOT / "data/model_graphs/pi05.json")["records"][0]
        refs = [
            f"vision-encoder/vision-blocks/self-attention/{operator}"
            for operator in (
                "query-projection", "key-projection", "value-projection", "attention",
                "output-projection", "attention-residual",
            )
        ] + ["action-flow-decoder/action-suffix-builder/time-embedding"]

        def group(group_id, kind="custom_op"):
            return {
                "execution_group_id": group_id, "label": group_id, "kind": kind,
                "implementation": group_id, "precision_path_id": "p-fp16", "repeat_selectors": [],
                "dependency_group_ids": [], "kernel_signature_ids": [], "kernel_resolution": "not_collected",
                "unmapped_reason_code": None, "evidence_ids": ["e-source"],
            }

        def mapping(mapping_id, logical, groups, relation, path="primary", certainty="exact"):
            needs_reason = certainty == "ambiguous" or path == "fallback" or relation == "eliminated"
            return {
                "mapping_id": mapping_id,
                "logical_targets": [{"ref": ref, "repeat_selectors": []} for ref in logical],
                "execution_group_ids": groups, "relation": relation, "path": path, "certainty": certainty,
                "method": "source_audit", "confidence": "medium" if certainty == "ambiguous" else "high",
                "reason_code": "fixture_reason" if needs_reason else None, "evidence_ids": ["e-source"],
            }

        realization = {
            "realization_id": "rr-fixture", "model_id": "pi0", "model_graph_id": "pi0-logical-v1",
            "runtime_id": "fixture-runtime", "runtime_revision": "fixture-revision",
            "availability": "source_audited", "model_artifact_ids": [], "device_ids": ["fixture-device"],
            "precision_paths": [{
                "precision_path_id": "p-fp16", "label": "FP16", "weight_dtype": "fp16",
                "activation_dtype": "fp16", "accumulation_dtype": "fp16", "output_dtype": "fp16",
                "quant_scheme": "none", "missing_fields": [], "missing_reason_code": None,
                "evidence_ids": ["e-source"],
            }],
            "evidence": [{
                "evidence_id": "e-source", "kind": "source_code", "source_id": "source-fixture",
                "revision": "fixture-revision", "locator": "runtime/source.cpp#Type::method",
                "run_ids": [], "observation_ids": [],
            }],
            "execution_groups": [
                group("g-preserved"), group("g-fused"), group("g-split-a"), group("g-split-b"),
                group("g-opaque", "opaque_region"), group("g-ambiguous-a"),
                group("g-ambiguous-b"), group("g-fallback"),
            ],
            "mappings": [
                mapping("m-preserved", refs[0:1], ["g-preserved"], "preserved"),
                mapping("m-fused", refs[1:3], ["g-fused"], "fused"),
                mapping("m-split", refs[3:4], ["g-split-a", "g-split-b"], "split"),
                mapping("m-eliminated", refs[6:7], [], "eliminated"),
                mapping("m-opaque", refs[4:5], ["g-opaque"], "opaque"),
                mapping("m-ambiguous", refs[4:6], ["g-ambiguous-a", "g-ambiguous-b"], "preserved", certainty="ambiguous"),
                mapping("m-fallback", refs[5:6], ["g-fallback"], "preserved", path="fallback"),
            ],
        }
        source_ids = {*pi0["source_ids"], *pi05["source_ids"], "source-fixture"}
        datasets = {
            "models": [{"model_id": model_id, "architecture_id": None, "source_ids": [], "artifacts": []} for model_id in ("pi0", "pi05")],
            "model_graphs": [pi0, pi05],
            "runtimes": [{"runtime_id": "fixture-runtime", "public_commit": "fixture-revision", "source_ids": [], "features": [], "model_support": []}],
            "devices": [{"device_id": "fixture-device"}],
            "sources": [{"source_id": source_id} for source_id in source_ids],
            "runtime_realizations": [realization],
        }

        self.assertEqual(validate_references(datasets), [])
        invalid_nm = copy.deepcopy(datasets)
        invalid_nm["runtime_realizations"][0]["mappings"][5].update(
            certainty="exact", confidence="high", reason_code=None
        )
        self.assertIn("invalid_many_to_many", {issue.code for issue in validate_references(invalid_nm)})
        foreign_ref = copy.deepcopy(datasets)
        foreign_ref["runtime_realizations"][0]["mappings"][0]["logical_targets"][0]["ref"] = (
            "public-output/public-action-slice/public-action-slice"
        )
        self.assertIn("broken_logical_reference", {issue.code for issue in validate_references(foreign_ref)})
        self.assertIn("ip_address", {
            issue.code for issue in scan_json({"locator": "10.0.0.1/src/foo.cpp#Type::method"})
        })
        self.assertEqual(scan_json({"locator": "runtime/source.cpp#Type::method"}), [])


if __name__ == "__main__":
    unittest.main()
