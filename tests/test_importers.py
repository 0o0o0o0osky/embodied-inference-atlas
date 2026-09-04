import json
import unittest
from pathlib import Path

from extractors.common import ImportContext, read_jsonl
from extractors.flashrt import import_flashrt_shape
from extractors.lerobot import import_lerobot_shape
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


if __name__ == "__main__":
    unittest.main()
