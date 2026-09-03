import copy
import tempfile
import unittest
from pathlib import Path

from tests.helpers import valid_model_document, valid_run
from tools.lib.contracts import validate_document
from tools.lib.comparison import assign_group_ids, ratio_eligibility
from tools.lib.privacy import scan_json, scan_release_tree
from tools.validate import validate_references


ROOT = Path(__file__).resolve().parents[1]


class PrivacyTests(unittest.TestCase):
    def test_forbidden_key_and_local_path_are_rejected(self):
        issues = scan_json({"checkpoint_path": "/home/isrc/private/model"})
        self.assertEqual({issue.code for issue in issues}, {"forbidden_key", "local_path"})

    def test_public_url_is_allowed(self):
        self.assertEqual(scan_json({"url": "https://github.com/NVlabs/vla-perf"}), [])

    def test_public_url_paths_and_benign_queries_are_allowed(self):
        urls = (
            "https://example.com/home/docs",
            "https://example.com/releases/1.2.3.4",
            "https://example.com/report?author=alice&x-amz-date=20260903T000000Z",
        )
        for url in urls:
            with self.subTest(url=url):
                self.assertEqual(scan_json({"url": url}), [])

    def test_root_relative_html_link_is_not_a_local_path(self):
        self.assertEqual(scan_json('<a href="/models/pi0.html">Pi0</a>'), [])

    def test_nonpublic_or_credential_bearing_urls_are_rejected(self):
        urls = (
            "http://localhost/report",
            "https://127.0.0.1/report",
            "https://user:secret@example.com/report",
            "https://example.com/report?sig=secret",
            "https://example.com/report?AccessKey=secret",
        )
        for url in urls:
            with self.subTest(url=url):
                self.assertIn("invalid_url", [issue.code for issue in scan_json({"url": url})])
        self.assertIn("invalid_url", [issue.code for issue in scan_json({"url": 42})])

    def test_sensitive_string_patterns_are_rejected(self):
        values = (
            "/Users/alice/models/private",
            "/root/checkpoints/private",
            r"C:\\models\\private",
            r"\\server\share\private",
            ".local/staging/private.json",
            "connected to 192.168.1.10",
            "saved,/tmp/private/model",
            r"saved,C:\models\private",
            "-----BEGIN OPENSSH PRIVATE KEY-----",
            "https://user:secret@example.com/report",
        )
        for value in values:
            with self.subTest(value=value):
                self.assertTrue(scan_json({"note": value}))

    def test_release_tree_rejects_every_blocked_suffix_and_local_directory(self):
        suffixes = (
            ".nsys-rep", ".ncu-rep", ".sqlite", ".sqlite3", ".db", ".log",
            ".safetensors", ".gguf", ".onnx", ".engine", ".plan", ".pt",
            ".pth", ".jpg", ".jpeg", ".png", ".mp4", ".mov",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index, suffix in enumerate(suffixes):
                (root / f"blocked-{index}{suffix}").touch()
            local = root / ".local"
            local.mkdir()
            (local / "staging.json").write_text("{}\n", encoding="utf-8")

            issues = scan_release_tree(root)

        self.assertEqual(
            sum(issue.code == "blocked_suffix" for issue in issues), len(suffixes)
        )
        self.assertIn("forbidden_path", [issue.code for issue in issues])

    def test_release_tree_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "target.json"
            target.write_text("{}\n", encoding="utf-8")
            (root / "linked.json").symlink_to(target)
            issues = scan_release_tree(root)
        self.assertIn("symlink", [issue.code for issue in issues])


class ReferenceValidationTests(unittest.TestCase):
    @staticmethod
    def valid_records():
        return {
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
                "nodes": [{"node_id": "input"}, {"node_id": "output"}],
                "edges": [{"source": "input", "target": "output"}],
                "source_ids": ["source-test"],
            }],
            "devices": [{"device_id": "device-test"}],
            "systems": [{"system_id": "system-test", "device_ids": ["device-test"]}],
            "runtimes": [{
                "runtime_id": "runtime-test",
                "features": [{"source_id": "source-test"}],
                "model_support": [{
                    "model_id": "model-test", "source_id": "source-test"
                }],
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
            "end_to_end": [{
                "measurement_id": "e2e-test", "run_id": "run-test",
                "source_id": "source-test",
            }],
            "stages": [{
                "measurement_id": "stage-test", "run_id": "run-test",
                "source_id": "source-test",
            }],
            "operators": [{
                "operator_id": "operator-test", "run_id": "run-test",
                "source_id": "source-test",
            }],
            "rooflines": [{
                "roofline_id": "roofline-test", "run_id": "run-test",
                "operator_id": "operator-test", "device_id": "device-test",
                "source_id": "source-test",
            }],
        }

    def test_every_required_reference_relation_is_blocking(self):
        cases = (
            ("model_architecture", "models", (0, "architecture_id"), "missing"),
            ("model_source", "models", (0, "source_ids", 0), "missing"),
            ("architecture_model", "architectures", (0, "model_id"), "missing"),
            ("architecture_source", "architectures", (0, "source_ids", 0), "missing"),
            ("edge_source", "architectures", (0, "edges", 0, "source"), "missing"),
            ("edge_target", "architectures", (0, "edges", 0, "target"), "missing"),
            ("system_device", "systems", (0, "device_ids", 0), "missing"),
            ("runtime_model", "runtimes", (0, "model_support", 0, "model_id"), "missing"),
            ("runtime_feature_source", "runtimes", (0, "features", 0, "source_id"), "missing"),
            ("runtime_support_source", "runtimes", (0, "model_support", 0, "source_id"), "missing"),
            ("runtime_source", "runtimes", (0, "source_ids", 0), "missing"),
            ("run_model", "runs", (0, "model_id"), "missing"),
            ("run_artifact", "runs", (0, "model_artifact_id"), "missing"),
            ("run_runtime", "runs", (0, "runtime_id"), "missing"),
            ("run_device", "runs", (0, "device_id"), "missing"),
            ("run_system", "runs", (0, "system_id"), "missing"),
            ("run_source", "runs", (0, "source_id"), "missing"),
            ("e2e_run", "end_to_end", (0, "run_id"), "missing"),
            ("e2e_source", "end_to_end", (0, "source_id"), "missing"),
            ("stage_run", "stages", (0, "run_id"), "missing"),
            ("stage_source", "stages", (0, "source_id"), "missing"),
            ("operator_run", "operators", (0, "run_id"), "missing"),
            ("operator_source", "operators", (0, "source_id"), "missing"),
            ("roofline_run", "rooflines", (0, "run_id"), "missing"),
            ("roofline_operator", "rooflines", (0, "operator_id"), "missing"),
            ("roofline_device", "rooflines", (0, "device_id"), "missing"),
            ("roofline_source", "rooflines", (0, "source_id"), "missing"),
        )
        for name, dataset, path, value in cases:
            with self.subTest(name=name):
                records = copy.deepcopy(self.valid_records())
                target = records[dataset]
                for part in path[:-1]:
                    target = target[part]
                target[path[-1]] = value
                self.assertIn(
                    "broken_reference",
                    [issue.code for issue in validate_references(records)],
                )

    def test_null_run_system_does_not_require_a_target(self):
        records = self.valid_records()
        records["runs"][0]["system_id"] = None
        self.assertEqual(validate_references(records), [])

    def test_invalid_collection_shapes_do_not_crash_reference_validation(self):
        records = self.valid_records()
        records["architectures"][0]["nodes"] = None
        records["architectures"][0]["edges"] = None
        records["runtimes"][0]["features"] = None
        records["runtimes"][0]["model_support"] = None
        self.assertIsInstance(validate_references(records), list)


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

    def test_present_workload_number_rejects_missing_entry(self):
        run = valid_run("run-present-workload")
        run["missing"]["workload.vla.denoise_steps"] = "not_applicable"
        self.assertEqual(
            [issue.code for issue in self.validate_run(run)],
            ["unexpected_missing_reason"],
        )

    def test_present_precision_number_rejects_missing_entry(self):
        run = valid_run("run-present-zero-point")
        run["missing"]["precision.scale_zero_point_bytes"] = "not_applicable"
        self.assertEqual(
            [issue.code for issue in self.validate_run(run)],
            ["unexpected_missing_reason"],
        )

    def test_null_precision_number_requires_missing_entry(self):
        run = valid_run("run-null-zero-point")
        run["precision"]["scale_zero_point_bytes"] = None
        run["comparison_context"]["precision"] = copy.deepcopy(run["precision"])
        self.assertEqual(
            [issue.code for issue in self.validate_run(run)],
            ["missing_reason_required"],
        )
        run["missing"]["precision.scale_zero_point_bytes"] = "not_applicable"
        self.assertEqual(self.validate_run(run), [])

    def test_full_timing_object_must_match_context(self):
        run = valid_run("run-timing-copy")
        run["comparison_context"]["timing"]["state_reuse"] = "no_reuse"
        self.assertEqual(
            [issue.code for issue in self.validate_run(run)],
            ["context_mismatch"],
        )

    def test_non_vla_workloads_are_controlled_unsupported_cases(self):
        for extension in ("world_model", "world_action_model", "hybrid"):
            with self.subTest(extension=extension):
                run = valid_run(f"run-{extension}")
                workload = {"common": run["workload"]["common"], extension: {}}
                run["workload"] = workload
                run["comparison_context"]["workload"] = copy.deepcopy(workload)
                self.assertEqual(
                    [issue.code for issue in self.validate_run(run)],
                    ["unsupported_workload"],
                )

    def test_null_system_reason_must_match_evidence(self):
        cases = (
            ("analytical", "reported_external_no_physical_system"),
            ("reported_external", "analytical_no_physical_system"),
        )
        for evidence, reason in cases:
            with self.subTest(evidence=evidence):
                run = valid_run(f"run-{evidence}-wrong-system-reason")
                run["evidence"] = evidence
                run["system_id"] = None
                run["comparison_context"]["evidence"] = evidence
                run["comparison_context"]["platform"]["system_id"] = None
                run["missing"]["system_id"] = reason
                self.assertEqual(
                    [issue.code for issue in self.validate_run(run)],
                    ["system_missing_reason"],
                )

    def test_reported_external_null_system_accepts_matching_reason(self):
        run = valid_run("run-external-system")
        run["evidence"] = "reported_external"
        run["system_id"] = None
        run["comparison_context"]["evidence"] = "reported_external"
        run["comparison_context"]["platform"]["system_id"] = None
        run["missing"]["system_id"] = "reported_external_no_physical_system"
        self.assertEqual(self.validate_run(run), [])

    def test_non_null_system_rejects_missing_entry(self):
        run = valid_run("run-present-system")
        run["missing"]["system_id"] = "analytical_no_physical_system"
        self.assertEqual(
            [issue.code for issue in self.validate_run(run)],
            ["unexpected_missing_reason"],
        )


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
            "stages": self.valid_stage(),
            "operators": self.valid_operator(),
            "rooflines": self.valid_roofline(),
        }
        for dataset, record in records.items():
            with self.subTest(dataset=dataset):
                self.assertEqual(self.validate(dataset, record), [])

    def test_end_to_end_and_stage_missing_reason_matches_null_statistics(self):
        e2e = self.valid_end_to_end()
        stage = self.valid_stage()
        for dataset, record in (("end_to_end", e2e), ("stages", stage)):
            with self.subTest(dataset=dataset, direction="null_requires_reason"):
                record["statistics"][0]["value"] = None
                self.assertEqual(
                    [issue.code for issue in self.validate(dataset, record)],
                    ["missing_reason_required"],
                )
                record["missing_reason"] = "not_collected"
                self.assertEqual(self.validate(dataset, record), [])
            with self.subTest(dataset=dataset, direction="value_rejects_reason"):
                record["statistics"][0]["value"] = 4.2
                self.assertEqual(
                    [issue.code for issue in self.validate(dataset, record)],
                    ["unexpected_missing_reason"],
                )

    def test_operator_and_roofline_missing_maps_match_null_metrics(self):
        cases = (
            ("operators", self.valid_operator(), "work_gflop"),
            ("rooflines", self.valid_roofline(), "predicted_ms"),
        )
        for dataset, record, field in cases:
            with self.subTest(dataset=dataset, direction="null_requires_reason"):
                record[field] = None
                self.assertEqual(
                    [issue.code for issue in self.validate(dataset, record)],
                    ["missing_reason_required"],
                )
                record["missing"][field] = "not_collected"
                self.assertEqual(self.validate(dataset, record), [])
            with self.subTest(dataset=dataset, direction="value_rejects_reason"):
                record[field] = 1.0
                self.assertEqual(
                    [issue.code for issue in self.validate(dataset, record)],
                    ["unexpected_missing_reason"],
                )

    def test_analytical_end_to_end_requires_canonical_estimate_shape(self):
        valid = self.valid_end_to_end()
        valid.update(
            {
                "evidence": "analytical",
                "measurement_method": "vla_perf",
                "statistics": [
                    {"statistic": "analytical_estimate", "value": 4.2, "unit": "ms"}
                ],
                "sample_count": 0,
                "percentile_method": None,
            }
        )
        self.assertEqual(self.validate("end_to_end", valid), [])

        mutations = (
            ("sample_count", 1),
            ("percentile_method", "source_reported"),
            (
                "statistics",
                [{"statistic": "mean", "value": 4.2, "unit": "ms"}],
            ),
            (
                "statistics",
                [
                    {"statistic": "analytical_estimate", "value": 4.2, "unit": "ms"},
                    {"statistic": "analytical_estimate", "value": 4.3, "unit": "ms"},
                ],
            ),
        )
        for field, value in mutations:
            with self.subTest(field=field, value=value):
                record = copy.deepcopy(valid)
                record[field] = value
                self.assertEqual(
                    [issue.code for issue in self.validate("end_to_end", record)],
                    ["analytical_measurement"],
                )

    @staticmethod
    def valid_end_to_end():
        return {
            "measurement_id": "e2e-001",
            "run_id": "run-001",
            "source_id": "source-test",
            "evidence": "measured_local",
            "measurement_method": "wall_clock",
            "metric": "latency",
            "statistics": [{"statistic": "mean", "value": 4.2, "unit": "ms"}],
            "sample_count": 10,
            "percentile_method": None,
            "work_unit": "action_chunk",
            "timing_boundary_id": "predict_cached_graph_sync",
            "missing_reason": None,
        }

    @staticmethod
    def valid_stage():
        record = MeasurementContractTests.valid_end_to_end()
        record.update(
            {
                "measurement_id": "stage-001",
                "measurement_method": "cuda_event",
                "stage_id": "denoise",
                "parent_stage_id": None,
                "aggregation": "summary",
                "additive": False,
                "execution_count": 10,
            }
        )
        return record

    @staticmethod
    def valid_operator():
        return {
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
        }

    @staticmethod
    def valid_roofline():
        return {
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
        }


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

    def test_passed_correctness_allows_validated_speedup(self):
        left = valid_run("left", correctness="passed")
        right = valid_run("right", correctness="passed")
        self.assertEqual(ratio_eligibility(left, right), "validated_speedup")

    def test_unassessed_correctness_allows_only_unvalidated_ratio(self):
        left = valid_run("left", correctness="passed")
        right = valid_run("right", correctness="not_assessed")
        self.assertEqual(
            ratio_eligibility(left, right), "latency_ratio_unvalidated"
        )

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

    def test_workload_scale_rejects_subtree_paths(self):
        run = valid_run("one-view", views=1)
        for varying_field in ("workload.vla", "workload.common"):
            with self.subTest(varying_field=varying_field):
                with self.assertRaisesRegex(ValueError, "scalar leaf"):
                    assign_group_ids([run], "workload_scale", varying_field)
