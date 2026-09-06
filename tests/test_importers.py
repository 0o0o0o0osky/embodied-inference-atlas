import json
import unittest
from pathlib import Path

from extractors.common import ImportContext, SourceFormatError, read_jsonl
from extractors.flashrt import import_flashrt_shape
from extractors.lerobot import import_lerobot_shape
from extractors.vla_cpp import import_vla_cpp
from extractors.vla_perf import import_vla_perf
from tools.lib.contracts import validate_document
from tools.lib.privacy import scan_json


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).parent / "fixtures"


class MeasuredImporterTests(unittest.TestCase):
    def assert_valid_bundle(self, bundle):
        self.assertEqual(scan_json(bundle), [])
        for dataset, records in bundle["datasets"].items():
            document = {
                "schema_version": "1.0.0",
                "dataset": dataset,
                "records": records,
            }
            self.assertEqual(validate_document(dataset, document, ROOT), [])

    def test_flashrt_maps_one_timing_without_raw_fields(self):
        context = ImportContext("fixture-flashrt", "source-local-thor", "thor-unit-01")
        bundle = import_flashrt_shape(
            read_jsonl(FIXTURES / "flashrt-shape.jsonl"), context
        )
        run = bundle["datasets"]["runs"][0]
        self.assertEqual(run["model_artifact_id"], "pi0-flashrt-local-01")
        self.assertEqual(run["precision"]["precision_id"], "mixed-fp8-e4m3-fp16")
        self.assertEqual(run["correctness"]["status"], "not_assessed")
        payload = json.dumps(bundle)
        for raw_value in ("Go.", "secret", "checkpoint", "/home/example/pi0"):
            self.assertNotIn(raw_value, payload)
        self.assert_valid_bundle(bundle)

    def test_lerobot_emits_non_additive_stage_summaries(self):
        context = ImportContext("fixture-lerobot", "source-local-thor", "thor-unit-01")
        bundle = import_lerobot_shape(
            read_jsonl(FIXTURES / "lerobot-smolvla.jsonl"), context
        )
        stages = bundle["datasets"]["stages"]
        self.assertEqual([stage["stage_id"] for stage in stages], ["fixed-prefix", "denoise"])
        self.assertTrue(all(stage["aggregation"] == "summary" for stage in stages))
        self.assertTrue(all(stage["additive"] is False for stage in stages))
        self.assert_valid_bundle(bundle)


class AnalyticalAndQuantImporterTests(unittest.TestCase):
    def test_vla_perf_emits_distinct_precision_rooflines(self):
        context = ImportContext("fixture-vla-perf", "source-vla-perf", None)
        bundle = import_vla_perf(read_jsonl(FIXTURES / "vla-perf.jsonl"), context)
        precision_ids = {item["precision_id"] for item in bundle["datasets"]["rooflines"]}
        self.assertEqual(precision_ids, {"uniform-fp16", "uniform-fp8"})

    def test_q8_is_weight_only_and_not_int8_compute(self):
        context = ImportContext("fixture-vla-cpp", "source-local-thor", "thor-unit-01")
        bundle = import_vla_cpp(read_jsonl(FIXTURES / "vla-cpp.jsonl"), context)
        q8 = next(
            run for run in bundle["datasets"]["runs"]
            if run["precision"]["quant_scheme"] == "q8_0_weight_only"
        )
        self.assertEqual(q8["precision"]["weight_dtype"], "q8_0")
        self.assertEqual(q8["precision"]["activation_dtype"], "fp32")
        self.assertEqual(q8["precision"]["accumulation_dtype"], "fp32")
        self.assertEqual(q8["precision"]["execution_dtype"], "mixed-q8_0-fp32")
        self.assertNotIn(q8["precision"]["execution_dtype"], {"fp16", "int8", "int4"})
        self.assertEqual(scan_json(bundle), [])

    def test_vla_cpp_preserves_target_workload(self):
        context = ImportContext("fixture-vla-cpp", "source-local-thor", "thor-unit-01")
        bundle = import_vla_cpp(read_jsonl(FIXTURES / "vla-cpp.jsonl"), context)
        run = bundle["datasets"]["runs"][0]

        self.assertEqual(
            run["workload"]["vla"],
            {
                "camera_views": 1,
                "image_height": 224,
                "image_width": 224,
                "semantic_prompt_tokens": 48,
                "executed_prompt_tokens": 48,
                "action_dimension": 32,
                "action_chunk": 50,
                "denoise_steps": 10,
            },
        )
        self.assertEqual(run["comparison_context"]["workload"], run["workload"])
        self.assertNotIn("workload.vla.denoise_steps", run["missing"])

    def test_vla_cpp_rejects_configured_action_chunk_mismatch(self):
        context = ImportContext("fixture-vla-cpp", "source-local-thor", "thor-unit-01")
        records = [{
            "record": "timing",
            "model_family": "pi0",
            "variant": "source_bf16_f32",
            "views": 1,
            "input_side": 224,
            "synthetic_tokens": 48,
            "configured_action_chunk": 49,
            "denoise_steps": 10,
            "output_shape": [50, 32],
            "repetitions": 10,
            "min_ms": 1.0,
            "p50_ms": 2.0,
            "p95_ms": 3.0,
        }]

        with self.assertRaises(SourceFormatError):
            import_vla_cpp(records, context)

if __name__ == "__main__":
    unittest.main()
