import copy
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

from extractors.benchmark import main as benchmark_main
from extractors.common import ImportContext, SourceFormatError, read_jsonl
from extractors.flashrt import import_flashrt_shape
from extractors.lerobot import import_lerobot_shape
from tools.lib.comparison import ratio_eligibility
from tools.lib.contracts import validate_document
from tools.lib.privacy import scan_json


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).parent / "fixtures"


class MeasuredImporterTests(unittest.TestCase):
    def assert_contract_valid(self, bundle):
        for dataset, records in bundle["datasets"].items():
            document = {
                "schema_version": "1.0.0",
                "dataset": dataset,
                "records": records,
            }
            self.assertEqual(validate_document(dataset, document, ROOT), [])

    def test_flashrt_maps_one_timing_without_raw_fields(self):
        context = ImportContext("fixture-flashrt", "source-local-thor", "thor-unit-01")
        bundle = import_flashrt_shape(read_jsonl(FIXTURES / "flashrt-shape.jsonl"), context)
        run = bundle["datasets"]["runs"][0]
        self.assertEqual(len(bundle["datasets"]["runs"]), 1)
        self.assertEqual(run["evidence"], "measured_local")
        self.assertEqual(run["model_artifact_id"], "pi0-flashrt-local-01")
        self.assertEqual(run["precision"]["precision_id"], "mixed-fp8-e4m3-fp16")
        self.assertEqual(run["precision"]["scale_zero_point_bytes"], 0)
        self.assertEqual(run["comparison_context"]["precision"]["scale_zero_point_bytes"], 0)
        self.assertEqual(run["correctness"], {"status": "not_assessed", "criterion": "finite-only"})
        self.assertEqual(run["missing"]["workload.vla.denoise_steps"], "not_applicable")
        self.assertEqual(scan_json(bundle), [])
        self.assert_contract_valid(bundle)
        payload = json.dumps(bundle)
        for raw_value in ("Go.", "secret", "checkpoint", "/home/example/pi0"):
            self.assertNotIn(raw_value, payload)

    def test_lerobot_stage_summaries_are_not_additive(self):
        context = ImportContext("fixture-lerobot", "source-local-thor", "thor-unit-01")
        bundle = import_lerobot_shape(read_jsonl(FIXTURES / "lerobot-smolvla.jsonl"), context)
        run = bundle["datasets"]["runs"][0]
        stages = bundle["datasets"]["stages"]
        self.assertTrue(stages)
        self.assertTrue(all(stage["aggregation"] == "summary" for stage in stages))
        self.assertTrue(all(stage["additive"] is False for stage in stages))
        self.assertEqual([stage["stage_id"] for stage in stages], ["fixed-prefix", "denoise"])
        self.assertEqual(
            [stage["measurement_id"] for stage in stages],
            ["stage-fixture-lerobot-001", "stage-fixture-lerobot-002"],
        )
        self.assertEqual(run["workload"]["vla"]["executed_prompt_tokens"], 48)
        self.assertEqual(run["precision"]["precision_id"], "mixed-bf16-fp32")
        self.assert_contract_valid(bundle)

    def test_ids_are_deterministic_and_timing_requires_active_run(self):
        context = ImportContext("fixture-flashrt", "source-local-thor", "thor-unit-01")
        records = list(read_jsonl(FIXTURES / "flashrt-shape.jsonl"))
        second_timing = copy.deepcopy(records[1])
        records.insert(2, second_timing)
        bundle = import_flashrt_shape(records, context)
        self.assertEqual(
            [run["run_id"] for run in bundle["datasets"]["runs"]],
            ["run-fixture-flashrt-001", "run-fixture-flashrt-002"],
        )
        self.assertEqual(
            [measurement["measurement_id"] for measurement in bundle["datasets"]["end_to_end"]],
            ["e2e-fixture-flashrt-001", "e2e-fixture-flashrt-002"],
        )
        with self.assertRaisesRegex(SourceFormatError, "fixture-flashrt: timing before run"):
            import_flashrt_shape([records[1]], context)
        with self.assertRaisesRegex(SourceFormatError, "fixture-flashrt: timing before run"):
            import_flashrt_shape([records[0], records[-1], records[1]], context)

    def test_flashrt_rejects_timing_that_conflicts_with_active_run(self):
        context = ImportContext("fixture-flashrt", "source-local-thor", "thor-unit-01")
        records = list(read_jsonl(FIXTURES / "flashrt-shape.jsonl"))
        records[1]["model_family"] = "pi05"
        with self.assertRaisesRegex(SourceFormatError, "fixture-flashrt: invalid timing record"):
            import_flashrt_shape(records, context)

    def test_unassessed_finite_only_correctness_allows_only_unvalidated_ratio(self):
        context = ImportContext("fixture-flashrt", "source-local-thor", "thor-unit-01")
        run = import_flashrt_shape(read_jsonl(FIXTURES / "flashrt-shape.jsonl"), context)["datasets"]["runs"][0]
        self.assertEqual(ratio_eligibility(run, run), "latency_ratio_unvalidated")

    def test_reader_errors_use_controlled_label_and_line_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "private-input.jsonl"
            source.write_text('{"record":"run"}\nnot-json /home/private\n', encoding="utf-8")
            with self.assertRaises(SourceFormatError) as caught:
                list(read_jsonl(source, source_label="fixture-source"))
        message = str(caught.exception)
        self.assertIn("fixture-source: invalid JSON at line 2", message)
        self.assertNotIn("private-input", message)
        self.assertNotIn("/home/private", message)

    def test_reader_rejects_an_uncontrolled_source_label_before_reading(self):
        with self.assertRaisesRegex(ValueError, "source_label must be lowercase kebab-case"):
            list(read_jsonl(Path("not-read.jsonl"), source_label="../private-source"))

    def test_cli_refuses_traversal_and_symlink_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            staging = repo / ".local" / "staging"
            staging.mkdir(parents=True)
            data = repo / "data"
            data.mkdir()
            (staging / "redirect").symlink_to(data, target_is_directory=True)
            arguments = [
                "--format", "flashrt-shape", "--input", str(FIXTURES / "flashrt-shape.jsonl"),
                "--source-label", "fixture-cli", "--source-id", "source-local-thor",
                "--system-id", "thor-unit-01",
            ]
            previous = Path.cwd()
            try:
                os.chdir(repo)
                for output in (staging / ".." / ".." / "data" / "escape.json", staging / "redirect" / "escape.json"):
                    errors = io.StringIO()
                    with redirect_stderr(errors):
                        self.assertEqual(benchmark_main([*arguments, "--output", str(output)]), 1)
                    self.assertNotIn(str(output), errors.getvalue())
            finally:
                os.chdir(previous)


if __name__ == "__main__":
    unittest.main()
