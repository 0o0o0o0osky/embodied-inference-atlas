import tempfile
import unittest
from pathlib import Path

from tests.helpers import valid_model_document, valid_run
from tools.lib.comparison import assign_group_ids, ratio_eligibility
from tools.lib.contracts import validate_document
from tools.lib.privacy import scan_json, scan_release_tree
from tools.validate import validate_references


ROOT = Path(__file__).resolve().parents[1]


class ValidationTests(unittest.TestCase):
    def test_json_privacy_boundary(self):
        issues = scan_json({"checkpoint_path": "/home/isrc/private/model"})
        self.assertEqual({issue.code for issue in issues}, {"forbidden_key", "local_path"})
        self.assertEqual(scan_json({"url": "https://github.com/NVlabs/vla-perf"}), [])
        self.assertTrue(scan_json({"url": "https://user:secret@example.com/report"}))

    def test_release_tree_rejects_raw_profiler_report(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "capture.nsys-rep"
            report.touch()
            issues = scan_release_tree(Path(directory))
        self.assertIn("blocked_suffix", [issue.code for issue in issues])

    def test_closed_model_contract(self):
        document = valid_model_document()
        self.assertEqual(validate_document("models", document, ROOT), [])
        document["records"][0]["checkpoint_path"] = "/private/model"
        self.assertEqual(
            [issue.code for issue in validate_document("models", document, ROOT)],
            ["unknown_field"],
        )

    def test_run_context_must_match(self):
        run = valid_run("run-context")
        document = {"schema_version": "1.0.0", "dataset": "runs", "records": [run]}
        self.assertEqual(validate_document("runs", document, ROOT), [])
        run["comparison_context"]["platform"]["device_id"] = "another-device"
        self.assertIn(
            "context_mismatch",
            [issue.code for issue in validate_document("runs", document, ROOT)],
        )

    def test_end_to_end_contract(self):
        record = {
            "measurement_id": "e2e-test-001",
            "run_id": "run-test-001",
            "source_id": "source-test",
            "evidence": "measured_local",
            "measurement_method": "wall_clock",
            "metric": "latency",
            "statistics": [{"statistic": "p50", "value": 40.1, "unit": "ms"}],
            "sample_count": 100,
            "percentile_method": "source_reported",
            "work_unit": "action_chunk",
            "timing_boundary_id": "predict_cached_graph_sync",
            "missing_reason": None,
        }
        document = {
            "schema_version": "1.0.0",
            "dataset": "end_to_end",
            "records": [record],
        }
        self.assertEqual(validate_document("end_to_end", document, ROOT), [])

    def test_representative_reference_is_blocking(self):
        datasets = {
            "sources": [{"source_id": "source-test"}],
            "models": [{
                "model_id": "model-test",
                "architecture_id": "arch-test",
                "artifacts": [{"artifact_id": "artifact-test"}],
                "source_ids": ["source-test"],
            }],
            "architectures": [{
                "architecture_id": "arch-test",
                "model_id": "model-test",
                "nodes": [],
                "edges": [],
                "source_ids": ["source-test"],
            }],
            "devices": [{"device_id": "device-test"}],
            "systems": [{"system_id": "system-test", "device_ids": ["device-test"]}],
            "runtimes": [{
                "runtime_id": "runtime-test",
                "features": [],
                "model_support": [],
                "source_ids": ["source-test"],
            }],
            "runs": [{
                "run_id": "run-test",
                "model_id": "model-test",
                "model_artifact_id": "artifact-test",
                "runtime_id": "runtime-test",
                "device_id": "device-test",
                "system_id": "system-test",
                "source_id": "source-test",
            }],
            "end_to_end": [],
            "stages": [],
            "operators": [],
            "rooflines": [],
        }
        self.assertEqual(validate_references(datasets), [])
        datasets["runs"][0]["runtime_id"] = "missing-runtime"
        self.assertIn("broken_reference", [issue.code for issue in validate_references(datasets)])


class ComparisonTests(unittest.TestCase):
    def test_single_axis_grouping(self):
        fp16 = valid_run("run-fp16", precision_id="uniform-fp16", views=1)
        fp8 = valid_run("run-fp8", precision_id="uniform-fp8", views=1)
        groups = assign_group_ids([fp16, fp8], "precision")
        self.assertEqual(groups["run-fp16"], groups["run-fp8"])

        fp8["comparison_context"]["workload"]["vla"]["camera_views"] = 2
        groups = assign_group_ids([fp16, fp8], "precision")
        self.assertNotEqual(groups["run-fp16"], groups["run-fp8"])

        two_views = valid_run("two-views", views=2)
        groups = assign_group_ids(
            [fp16, two_views], "workload_scale", "workload.vla.camera_views"
        )
        self.assertEqual(groups["run-fp16"], groups["two-views"])

    def test_correctness_controls_ratio_kind(self):
        expected = {
            ("passed", "passed"): "validated_speedup",
            ("passed", "not_assessed"): "latency_ratio_unvalidated",
            ("passed", "failed"): "blocked_known_unequal",
        }
        for statuses, result in expected.items():
            with self.subTest(statuses=statuses):
                left = valid_run("left", correctness=statuses[0])
                right = valid_run("right", correctness=statuses[1])
                self.assertEqual(ratio_eligibility(left, right), result)


if __name__ == "__main__":
    unittest.main()
