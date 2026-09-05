import copy
import json
import unittest
from pathlib import Path

from extractors.common import SourceFormatError
from tests.helpers import valid_run
from tools.lib.contracts import validate_document
from tools.lib.privacy import scan_json


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = Path(__file__).parent / "fixtures" / "profiler-ncu-sanitization.json"


class ProfilerImporterTests(unittest.TestCase):
    def test_ncu_fixture_strips_local_identity_and_preserves_missing(self):
        try:
            from extractors.ncu import parse_ncu_exports
            from extractors.profiler_common import ProfilerImportContext
            from tools.lib.profiler import profiler_semantic_issues
            from tools.lib.profiler_privacy import scan_profiler_bundle
        except ImportError as error:
            self.fail(f"profiler importer contract is unavailable: {error}")

        fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        run = valid_run("run-fixture-profiler-001")
        run["configuration_id"] = "config-fixture-profiler-001"
        run["capture_method"] = "ncu"
        context = ProfilerImportContext(
            source_label="fixture-profiler",
            source_id="source-test",
            system_id="thor-unit-01",
            run=run,
            capture_label="fixture-ncu",
            signature_policy_id="fixture-signatures-v1",
            window_policy_id="not-applicable",
        )
        policy = {
            "policy_id": "fixture-signatures-v1",
            "section_mode": "custom_metric_set_12",
            "replay_mode": "kernel",
            "replay_passes": 10,
            "cache_control_request": "all",
            "clock_control_request": "base",
            "warmup_count": 3,
            "backing_store_bytes": None,
            "warnings": ["gpu_frequency_not_fixed"],
            "origins": {
                "selection_policy": "session_command",
                "replay_mode": "session_command",
                "replay_passes": "collection_log_manual_audit",
                "cache_control_request": "session_command",
                "clock_control_request": "session_command",
                "warmup_count": "harness_source_audit",
                "backing_store_bytes": "unavailable",
                "gpu_frequency_not_fixed": "collection_log_manual_audit",
            },
            "expected_result_identity": {
                "ID": "987654321980",
                "Process ID": "987654321987",
                "Process Name": "private-python",
                "Host Name": "private-host",
                "Kernel Name": "void private::mega_gemm<SecretTemplate>(float*)",
                "Context": "987654321985",
                "Stream": "987654321984",
                "Block Size": "128",
                "Grid Size": "32",
                "Device": "987654321983",
                "CC": "11.0",
            },
            "expected_geometry": {
                "grid": [4, 1, 8],
                "block": [128, 1, 1],
            },
            "signature": {
                "kernel_signature_id": "kernel-signature-fixture-large-gemm",
                "label_sanitized": "encoder large GEMM",
                "function_family": "gemm",
                "implementation_family": "cutlass-tensor-core",
                "precision_path": {
                    "input_dtype_class": None,
                    "accumulator_dtype_class": None,
                    "output_dtype_class": None,
                    "sparsity": "unknown",
                    "missing": {
                        "input_dtype_class": "precision_conflict",
                        "accumulator_dtype_class": "precision_conflict",
                        "output_dtype_class": "not_collected"
                    }
                },
                "classification_method": "source_audit",
                "classification_confidence": "high",
                "missing": {}
            }
        }

        try:
            bundle = parse_ncu_exports(
                fixture["session_csv"],
                fixture["details_csv"],
                fixture["raw_csv"],
                context,
                policy,
            )
        except SourceFormatError as error:
            self.fail(f"controlled fixture was rejected: {error}")

        self.assertEqual(bundle["source_label"], "fixture-profiler")
        self.assertEqual(
            set(bundle["datasets"]),
            {
                "runs",
                "profiler_captures",
                "timelines",
                "kernel_signatures",
                "kernel_observations",
                "profiler_metrics",
                "operator_kernel_links",
                "telemetry",
            },
        )
        self.assertEqual(bundle["datasets"]["runs"], [run])

        capture = bundle["datasets"]["profiler_captures"][0]
        observation = bundle["datasets"]["kernel_observations"][0]
        self.assertEqual(capture["capture_id"], "capture-fixture-profiler-001")
        self.assertEqual(capture["selection_policy"], "explicit_invocation")
        self.assertEqual(capture["ncu"]["origins"], policy["origins"])
        self.assertEqual(observation["calls"], 1)
        self.assertEqual(observation["duration"], {
            "statistic": "single", "value_ns": 125000, "sample_count": 1,
        })
        self.assertIsNone(observation["duration_share"])
        self.assertEqual(observation["missing"]["duration_share"], "not_applicable")

        short_session = fixture["session_csv"].replace(
            "--kernel-id ::private:77777 --launch-count 1",
            "-k regex:private_selected_symbol -s 314159 -c 1",
        )
        long_session = fixture["session_csv"].replace(
            "--kernel-id ::private:77777 --launch-count 1",
            "--kernel-name regex:private_selected_symbol --launch-skip 314159 --launch-count 1",
        )
        for session in (short_session, long_session):
            selected = parse_ncu_exports(
                session,
                fixture["details_csv"],
                fixture["raw_csv"],
                context,
                policy,
            )
            selected_capture = selected["datasets"]["profiler_captures"][0]
            selected_observation = selected["datasets"]["kernel_observations"][0]
            self.assertEqual(
                selected_capture["selection_policy"], "name_filter_selected_match"
            )
            self.assertEqual(
                selected_observation["population"],
                "one_name_filtered_selected_match_replayed_launch",
            )
            selected_payload = json.dumps(selected, sort_keys=True)
            self.assertNotIn("private_selected_symbol", selected_payload)
            self.assertNotIn("314159", selected_payload)

        metrics = {
            metric["metric_name"]: metric
            for metric in bundle["datasets"]["profiler_metrics"]
        }
        self.assertEqual(metrics["kernel_duration"]["basis"], "per_profiled_launch")
        expected_missing = {
            "system_memory_throughput_pct_of_ceiling": "counter_absent_from_report",
            "system_memory_bytes": "counter_absent_from_report",
            "scheduler_issue_active_percent": "section_not_collected",
            "warp_stall_long_scoreboard_percent": "section_not_collected",
            "warp_stall_short_scoreboard_percent": "section_not_collected",
        }
        for metric_name, reason in expected_missing.items():
            self.assertIsNone(metrics[metric_name]["value"])
            self.assertEqual(metrics[metric_name]["missing_reason"], reason)

        payload = json.dumps(bundle, sort_keys=True)
        for raw_value in (
            "/home/example/private/model.ncu-rep",
            "private-host",
            "private-python",
            "987654321987",
            "987654321986",
            "987654321985",
            "987654321984",
            "987654321983",
            "987654321982",
            "987654321981",
            "secret_runner.py",
            "secret-environment",
            "2026-09-02T19:42:15+08:00",
            "GPU-01234567-89ab-cdef-0123-456789abcdef",
            "0000:01:00.0",
            "void private::mega_gemm<SecretTemplate>(float*)",
            "::private:77777",
            "8f0c95e57301a9a94fd3167d765e5e4ae430db8266f81b0c337a81b32ed95070",
        ):
            self.assertNotIn(raw_value, payload)

        self.assertEqual(scan_json(bundle), [])
        self.assertEqual(scan_profiler_bundle(bundle), [])
        self.assertEqual(profiler_semantic_issues(bundle["datasets"]), [])

        wrong_identity = copy.deepcopy(policy)
        wrong_identity["expected_result_identity"]["Kernel Name"] = "private mismatch"
        with self.assertRaises(SourceFormatError):
            parse_ncu_exports(
                fixture["session_csv"], fixture["details_csv"], fixture["raw_csv"],
                context, wrong_identity,
            )
        wrong_geometry = copy.deepcopy(policy)
        wrong_geometry["expected_geometry"]["grid"] = [1, 1, 1]
        with self.assertRaises(SourceFormatError):
            parse_ncu_exports(
                fixture["session_csv"], fixture["details_csv"], fixture["raw_csv"],
                context, wrong_geometry,
            )

        bad_ids = copy.deepcopy(bundle)
        bad_ids["datasets"]["runs"][0]["run_id"] = 987654321
        bad_ids["datasets"]["runs"][0]["configuration_id"] = "report.ncu-rep"
        bad_ids["datasets"]["profiler_captures"][0]["capture_id"] = "raw::capture"
        id_issues = scan_profiler_bundle(bad_ids)
        self.assertIn("profiler_generated_id", {issue.code for issue in id_issues})

        bad_local_ids = {
            "datasets": {
                "timelines": [{
                    "timeline_id": "timeline-fixture-profiler-001",
                    "lanes": [{"lane_id": 123}],
                    "events": [{"event_id": "raw::event"}],
                }]
            }
        }
        local_id_issues = scan_profiler_bundle(bad_local_ids)
        self.assertIn("profiler_local_id", {issue.code for issue in local_id_issues})
        for dataset, records in bundle["datasets"].items():
            document = {
                "schema_version": "1.0.0",
                "dataset": dataset,
                "records": records,
            }
            self.assertEqual(validate_document(dataset, document, ROOT), [])


if __name__ == "__main__":
    unittest.main()
