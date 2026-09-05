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
        run["configuration_id"] = "cfg-fixture-profiler-001"
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
            "selection_policy": "explicit_invocation",
            "section_mode": "custom_metric_set_12",
            "replay_mode": "kernel",
            "replay_passes": 10,
            "cache_control_request": "all",
            "clock_control_request": "base",
            "warmup_count": 3,
            "backing_store_bytes": None,
            "warnings": ["gpu_frequency_not_fixed"],
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
        self.assertEqual(observation["calls"], 1)
        self.assertEqual(observation["duration"], {
            "statistic": "single", "value_ns": 125000, "sample_count": 1,
        })
        self.assertIsNone(observation["duration_share"])
        self.assertEqual(observation["missing"]["duration_share"], "not_applicable")

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
            "8f0c95e57301a9a94fd3167d765e5e4ae430db8266f81b0c337a81b32ed95070",
        ):
            self.assertNotIn(raw_value, payload)

        self.assertEqual(scan_json(bundle), [])
        self.assertEqual(scan_profiler_bundle(bundle), [])
        self.assertEqual(profiler_semantic_issues(bundle["datasets"]), [])
        for dataset, records in bundle["datasets"].items():
            document = {
                "schema_version": "1.0.0",
                "dataset": dataset,
                "records": records,
            }
            self.assertEqual(validate_document(dataset, document, ROOT), [])


if __name__ == "__main__":
    unittest.main()
