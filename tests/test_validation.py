import copy
import unittest
from pathlib import Path

from tests.helpers import valid_model_document, valid_run
from tools.lib.contracts import validate_document
from tools.lib.comparison import assign_group_ids, ratio_eligibility


ROOT = Path(__file__).resolve().parents[1]


class ContractTests(unittest.TestCase):
    def test_valid_model_document_passes(self):
        self.assertEqual(validate_document("models", valid_model_document(), ROOT), [])

    def test_unknown_field_is_rejected(self):
        document = copy.deepcopy(valid_model_document())
        document["records"][0]["checkpoint_path"] = "/private/model"
        issues = validate_document("models", document, ROOT)
        self.assertEqual([issue.code for issue in issues], ["unknown_field"])

    def test_missing_required_field_is_rejected(self):
        document = copy.deepcopy(valid_model_document())
        del document["records"][0]["model_type"]
        issues = validate_document("models", document, ROOT)
        self.assertEqual([issue.code for issue in issues], ["required"])


class RunContractTests(unittest.TestCase):
    def validate_run(self, run: dict[str, object]):
        return validate_document(
            "runs",
            {"schema_version": "1.0.0", "dataset": "runs", "records": [run]},
            ROOT,
        )

    def test_valid_run_passes(self):
        self.assertEqual(self.validate_run(valid_run("run-valid")), [])

    def test_scale_zero_point_bytes_is_required_in_both_precision_copies(self):
        for path in (("precision",), ("comparison_context", "precision")):
            with self.subTest(path=path):
                run = valid_run("run-zero-point")
                precision = run
                for part in path:
                    precision = precision[part]
                del precision["scale_zero_point_bytes"]
                issues = self.validate_run(run)
                self.assertIn("required", [issue.code for issue in issues])

    def test_workload_requires_exactly_one_extension(self):
        run = valid_run("run-two-workloads")
        run["workload"]["world_model"] = {}
        run["comparison_context"]["workload"] = copy.deepcopy(run["workload"])
        issues = self.validate_run(run)
        self.assertEqual([issue.code for issue in issues], ["workload_extension"])

    def test_run_and_context_copies_must_match(self):
        run = valid_run("run-context-copy")
        run["comparison_context"]["platform"]["device_id"] = "another-device"
        issues = self.validate_run(run)
        self.assertEqual([issue.code for issue in issues], ["context_mismatch"])

    def test_measured_local_requires_a_system(self):
        run = valid_run("run-measured-system")
        run["system_id"] = None
        run["comparison_context"]["platform"]["system_id"] = None
        issues = self.validate_run(run)
        self.assertEqual([issue.code for issue in issues], ["system_required"])

    def test_analytical_null_system_requires_controlled_missing_reason(self):
        run = valid_run("run-analytical-system")
        run["evidence"] = "analytical"
        run["system_id"] = None
        run["comparison_context"]["evidence"] = "analytical"
        run["comparison_context"]["platform"]["system_id"] = None
        self.assertEqual(
            [issue.code for issue in self.validate_run(run)],
            ["system_missing_reason"],
        )
        run["missing"]["system_id"] = "analytical_no_physical_system"
        self.assertEqual(self.validate_run(run), [])

    def test_nullable_workload_number_requires_missing_entry(self):
        run = valid_run("run-null-workload")
        run["workload"]["vla"]["denoise_steps"] = None
        run["comparison_context"]["workload"] = copy.deepcopy(run["workload"])
        self.assertEqual(
            [issue.code for issue in self.validate_run(run)],
            ["missing_reason_required"],
        )
        run["missing"]["workload.vla.denoise_steps"] = "not_applicable"
        self.assertEqual(self.validate_run(run), [])


class MeasurementContractTests(unittest.TestCase):
    def validate(self, dataset: str, record: dict[str, object]):
        return validate_document(
            dataset,
            {"schema_version": "1.0.0", "dataset": dataset, "records": [record]},
            ROOT,
        )

    def test_end_to_end_distribution_passes(self):
        record = {
            "measurement_id": "e2e-flashrt-pi0-matrix-001",
            "run_id": "run-flashrt-pi0-matrix-001",
            "source_id": "source-local-thor",
            "evidence": "measured_local",
            "measurement_method": "wall_clock",
            "metric": "latency",
            "statistics": [
                {"statistic": "p50", "value": 40.1136125, "unit": "ms"},
                {"statistic": "p95", "value": 40.4523936, "unit": "ms"},
            ],
            "sample_count": 100,
            "percentile_method": "source_reported",
            "work_unit": "action_chunk",
            "timing_boundary_id": "predict_cached_graph_sync",
            "missing_reason": None,
        }
        self.assertEqual(self.validate("end_to_end", record), [])

    def test_stage_operator_and_roofline_records_pass(self):
        records = {
            "stages": {
                "measurement_id": "stage-001",
                "run_id": "run-001",
                "source_id": "source-test",
                "evidence": "measured_local",
                "measurement_method": "cuda_event",
                "metric": "latency",
                "statistics": [{"statistic": "mean", "value": 4.2, "unit": "ms"}],
                "sample_count": 10,
                "percentile_method": None,
                "work_unit": "action_chunk",
                "timing_boundary_id": "predict_cached_graph_sync",
                "missing_reason": None,
                "stage_id": "denoise",
                "parent_stage_id": None,
                "aggregation": "summary",
                "additive": False,
                "execution_count": 10,
            },
            "operators": {
                "operator_id": "operator-001",
                "run_id": "run-001",
                "source_id": "source-test",
                "evidence": "analytical",
                "module_id": "action",
                "granularity": "component",
                "operator_kind": "matmul",
                "shape": "M=10,N=32,K=64",
                "execution_count": 10,
                "work_gflop": 1.5,
                "traffic_gib": 0.2,
                "arithmetic_intensity_flop_per_byte": 6.9849193096,
                "source_method": "vla_perf",
                "missing": {},
            },
            "rooflines": {
                "roofline_id": "roofline-001",
                "run_id": "run-001",
                "source_id": "source-test",
                "evidence": "analytical",
                "operator_id": "operator-001",
                "device_id": "nvidia-jetson-agx-thor",
                "precision_id": "uniform-fp16",
                "memory_level": "dram",
                "compute_peak_gflop_per_s": 400000.0,
                "bandwidth_gib_per_s": 270.0,
                "peak_source": "analytical_assumption",
                "predicted_ms": 0.8,
                "limiter": "memory",
                "modeling_fidelity": "native",
                "missing": {},
            },
        }
        for dataset, record in records.items():
            with self.subTest(dataset=dataset):
                self.assertEqual(self.validate(dataset, record), [])


class ComparisonTests(unittest.TestCase):
    def test_precision_policy_allows_only_precision_to_change(self):
        fp16 = valid_run("run-fp16", precision_id="uniform-fp16", views=1)
        fp8 = valid_run("run-fp8", precision_id="uniform-fp8", views=1)
        groups = assign_group_ids([fp16, fp8], "precision")
        self.assertEqual(groups["run-fp16"], groups["run-fp8"])

    def test_precision_policy_rejects_second_changed_axis(self):
        fp16 = valid_run("run-fp16", precision_id="uniform-fp16", views=1)
        fp8 = valid_run("run-fp8", precision_id="uniform-fp8", views=2)
        groups = assign_group_ids([fp16, fp8], "precision")
        self.assertNotEqual(groups["run-fp16"], groups["run-fp8"])

    def test_failed_correctness_blocks_ratio(self):
        left = valid_run("left", correctness="passed")
        right = valid_run("right", correctness="failed")
        self.assertEqual(ratio_eligibility(left, right), "blocked_known_unequal")

    def test_workload_scale_removes_only_named_leaf(self):
        one_view = valid_run("one-view", views=1)
        two_views = valid_run("two-views", views=2)
        groups = assign_group_ids(
            [one_view, two_views], "workload_scale", "workload.vla.camera_views"
        )
        self.assertEqual(groups["one-view"], groups["two-views"])

        two_views["comparison_context"]["workload"]["vla"][
            "semantic_prompt_tokens"
        ] = 8
        groups = assign_group_ids(
            [one_view, two_views], "workload_scale", "workload.vla.camera_views"
        )
        self.assertNotEqual(groups["one-view"], groups["two-views"])
