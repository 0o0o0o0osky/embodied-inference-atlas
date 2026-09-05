import copy
import csv
import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from extractors.common import SourceFormatError
from tests.helpers import valid_run
from tools.lib.contracts import validate_document
from tools.lib.privacy import scan_json


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = Path(__file__).parent / "fixtures" / "profiler-ncu-sanitization.json"


def _raw_with_metrics(payload, metrics):
    rows = list(csv.reader(io.StringIO(payload)))
    rows[0].extend(metrics)
    rows[1].extend(unit for unit, _ in metrics.values())
    rows[2].extend(value for _, value in metrics.values())
    output = io.StringIO()
    csv.writer(output, lineterminator="\n").writerows(rows)
    return output.getvalue()


def _task7_session(payload, sections, metrics=()):
    section_flags = " ".join(f"--section {name}" for name in sections)
    metric_flags = f" --metrics {','.join(metrics)}" if metrics else ""
    return payload.replace(
        "--clock-control base --metrics gpu__time_duration.sum",
        f"--clock-control none {section_flags}{metric_flags} "
        "--disable-extra-suffixes",
    )


def _raw_without_metric(payload, metric):
    rows = list(csv.reader(io.StringIO(payload)))
    column = rows[0].index(metric)
    for row in rows:
        row.pop(column)
    output = io.StringIO()
    csv.writer(output, lineterminator="\n").writerows(rows)
    return output.getvalue()


def _canonical_record(relative_path, key, value):
    records = json.loads((ROOT / relative_path).read_text(encoding="utf-8"))[
        "records"
    ]
    return next(record for record in records if record[key] == value)


class ProfilerImporterTests(unittest.TestCase):
    def test_ncu_fixture_strips_local_identity_and_preserves_missing(self):
        try:
            from extractors.ncu import parse_ncu_exports
            from extractors.profiler import import_profiler_job
            from extractors.profiler_common import ProfilerImportContext
            from tools.lib.profiler import profiler_semantic_issues
            from tools.lib.profiler_privacy import scan_profiler_bundle
            from tools.lib.promotion import PromotionError, plan_promotion
        except ImportError as error:
            self.fail(f"profiler importer contract is unavailable: {error}")

        fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        safe_label = "pi0-flashrt-ncu-encoder-large-gemm"
        run = valid_run(f"run-{safe_label}-001")
        run["configuration_id"] = f"config-{safe_label}-001"
        run["model_artifact_id"] = "pi0-flashrt-local-01"
        run["comparison_context"]["model_artifact_id"] = "pi0-flashrt-local-01"
        run["capture_method"] = "ncu"
        context = ProfilerImportContext(
            source_label=safe_label,
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
                "kernel_signature_id": "kernel-signature-pi0-encoder-large-gemm",
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

        self.assertEqual(bundle["source_label"], safe_label)
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
        self.assertEqual(capture["capture_id"], f"capture-{safe_label}-001")
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

        canonical_run = _canonical_record(
            "data/measurements/runs.json",
            "run_id",
            f"run-{safe_label}-001",
        )
        canonical_signature = _canonical_record(
            "data/profiler/kernel_signatures.json",
            "kernel_signature_id",
            "kernel-signature-pi0-encoder-large-gemm",
        )
        signature_policy = copy.deepcopy(canonical_signature)
        signature_policy.pop("model_id")
        signature_policy.pop("runtime_id")

        second_run = copy.deepcopy(canonical_run)
        second_run["run_id"] = f"run-{safe_label}-002"
        second_run["configuration_id"] = f"config-{safe_label}-002"
        second_run["operating_point"] = {
            "operating_point_id": "thor-120w-jetson-clocks",
            "power_mode": "120w-mode-1",
            "clock_policy": "jetson_clocks_locked",
            "throttle_status": "unknown",
        }
        second_run["comparison_context"]["platform"][
            "operating_point_id"
        ] = "thor-120w-jetson-clocks"
        for field in (
            "operating_point.clock_policy",
            "operating_point.power_mode",
            "operating_point.throttle_status",
        ):
            second_run["missing"].pop(field)
        second_context = ProfilerImportContext(
            source_label=safe_label,
            source_id="source-local-thor",
            system_id="thor-unit-01",
            run=second_run,
            capture_label="fixture-ncu-locked",
            signature_policy_id="fixture-signatures-v1",
            window_policy_id="not-applicable",
        )
        locked_policy = copy.deepcopy(policy)
        locked_policy.update({
            "section_mode": "scheduler_stats_with_sysmem_sectors",
            "clock_control_request": "none",
            "disable_extra_suffixes": True,
            "warnings": [],
            "external_clock_control": {
                "controller": "jetson_clocks",
                "state": "locked",
            },
            "telemetry": {
                "observed_gpu_frequency": {
                    "statistic": "mean", "value": 1386.0,
                    "unit": "MHz", "sample_count": 1,
                    "origin": "ncu_gpc_cycle_rate",
                },
                "observed_emc_frequency": {
                    "missing_reason": "unavailable_from_tool",
                    "origin": "jetson_clocks_show",
                },
                "observed_junction_temperature": {
                    "statistic": "max", "value": 47.5,
                    "unit": "celsius", "sample_count": 2,
                    "origin": "tegrastats_tj",
                },
                "observed_gpu_power": {
                    "statistic": "mean", "value": 61250,
                    "unit": "mW", "sample_count": 2,
                    "origin": "tegrastats_vdd_gpu",
                },
                "throttle_status": {
                    "missing_reason": "unavailable_from_tool",
                    "origin": "clock_event_audit",
                },
            },
        })
        locked_policy["signature"] = signature_policy
        locked_policy["origins"].pop("gpu_frequency_not_fixed")
        locked_policy["origins"][
            "external_clock_control"
        ] = "collection_wrapper_observed"
        locked_policy["origins"]["disable_extra_suffixes"] = "session_command"

        scheduler_sections = (
            "SpeedOfLight", "ComputeWorkloadAnalysis", "MemoryWorkloadAnalysis",
            "LaunchStats", "Occupancy", "SchedulerStats",
        )
        sysmem_counters = (
            "lts__d_sectors_fill_sysmem.sum",
            "lts__t_sectors_aperture_sysmem_op_write.sum",
            "lts__t_sectors_srcunit_tex_aperture_sysmem_lookup_miss.sum",
        )
        locked_session = _task7_session(
            fixture["session_csv"], scheduler_sections, sysmem_counters
        )
        added_raw = {
            "gpc__cycles_elapsed.avg.per_second": ("hz", "1386000000"),
            "smsp__issue_active.avg.per_cycle_active": (
                "instruction/cycle", "0.55",
            ),
            "smsp__issue_active.avg.pct_of_peak_sustained_active": ("%", "55"),
            "smsp__warps_active.avg.per_cycle_active": ("warp", "8"),
            "smsp__warps_eligible.avg.per_cycle_active": ("warp", "0.5"),
            "smsp__maximum_warps_avg_per_active_cycle": ("warp", "48"),
            "smsp__warps_active.avg.peak_sustained": ("warp", "48"),
            sysmem_counters[0]: ("sector", "1000"),
            sysmem_counters[1]: ("sector", "250"),
            sysmem_counters[2]: ("sector", "75"),
        }
        locked_raw = _raw_with_metrics(fixture["raw_csv"], added_raw)

        second_bundle = parse_ncu_exports(
            locked_session,
            fixture["details_csv"],
            locked_raw,
            second_context,
            locked_policy,
        )
        second_capture = second_bundle["datasets"]["profiler_captures"][0]
        second_observation = second_bundle["datasets"]["kernel_observations"][0]
        self.assertEqual(second_capture["capture_id"], f"capture-{safe_label}-002")
        self.assertEqual(
            second_observation["observation_id"],
            f"kernel-observation-{safe_label}_r002_001",
        )
        self.assertEqual(second_capture["ncu"]["clock_control_request"], "none")
        self.assertEqual(second_capture["ncu"]["sections"], list(scheduler_sections))
        self.assertEqual(
            second_capture["ncu"]["explicit_metrics"], list(sysmem_counters)
        )
        self.assertTrue(second_capture["ncu"]["disable_extra_suffixes"])
        self.assertEqual(
            second_capture["ncu"]["external_clock_control"],
            {"controller": "jetson_clocks", "state": "locked"},
        )
        self.assertNotIn("gpu_frequency_not_fixed", second_capture["warnings"])
        self.assertNotIn("gpu_frequency_not_fixed", second_observation["quality"])

        second_metrics = {
            metric["metric_name"]: metric
            for metric in second_bundle["datasets"]["profiler_metrics"]
        }
        self.assertEqual(
            {
                metric["raw_counter_name"]
                for metric in second_metrics.values()
                if metric["unit"] == "sector"
            },
            set(sysmem_counters),
        )
        self.assertEqual(
            second_metrics["scheduler_issue_active_per_active_cycle"]["unit"],
            "instruction_per_cycle",
        )
        self.assertEqual(
            second_metrics["scheduler_eligible_warps_per_active_cycle"]["value"],
            0.5,
        )
        self.assertIsNone(second_metrics["scheduler_issue_inst0_percent"]["value"])
        self.assertEqual(
            second_metrics["scheduler_issue_inst0_percent"]["missing_reason"],
            "counter_absent_from_report",
        )
        self.assertIsNone(
            second_metrics[
                "tensor_cycles_active_pct_of_peak_sustained_active"
            ]["value"]
        )
        self.assertEqual(
            second_metrics[
                "tensor_cycles_active_pct_of_peak_sustained_active"
            ]["section_name"],
            "ComputeWorkloadAnalysis",
        )
        self.assertEqual(
            second_metrics[
                "tensor_cycles_active_pct_of_peak_sustained_active"
            ]["raw_counter_name"],
            "sm__pipe_tensor_cycles_active.avg.pct_of_peak_sustained_active",
        )
        self.assertNotIn(
            "tensor_cycles_active_pct_of_peak_sustained_elapsed", second_metrics
        )

        telemetry = {
            item["metric_name"]: item
            for item in second_bundle["datasets"]["telemetry"]
        }
        self.assertEqual(len(telemetry), 5)
        self.assertEqual(telemetry["observed_gpu_frequency"]["summary"]["unit"], "MHz")
        self.assertEqual(
            telemetry["observed_emc_frequency"]["missing_reason"],
            "unavailable_from_tool",
        )
        self.assertEqual(
            telemetry["observed_junction_temperature"]["measurement_source"],
            "tegrastats_tj",
        )
        self.assertEqual(
            telemetry["observed_junction_temperature"]["summary"]["unit"],
            "celsius",
        )
        self.assertEqual(telemetry["observed_gpu_power"]["summary"]["unit"], "mW")
        self.assertEqual(
            telemetry["throttle_status"]["missing_reason"],
            "unavailable_from_tool",
        )

        with self.assertRaises(SourceFormatError):
            parse_ncu_exports(
                locked_session.replace("ncu --import", "ncu --set full --import"),
                fixture["details_csv"], locked_raw, second_context, locked_policy,
            )
        missing_sysmem = _raw_without_metric(locked_raw, sysmem_counters[0])
        with self.assertRaises(SourceFormatError):
            parse_ncu_exports(
                locked_session, fixture["details_csv"], missing_sysmem,
                second_context, locked_policy,
            )
        unknown_power_run = copy.deepcopy(second_run)
        unknown_power_run["operating_point"]["power_mode"] = "unknown"
        unknown_power_context = ProfilerImportContext(
            source_label=safe_label,
            source_id="source-local-thor",
            system_id="thor-unit-01",
            run=unknown_power_run,
            capture_label="fixture-ncu-locked",
            signature_policy_id="fixture-signatures-v1",
            window_policy_id="not-applicable",
        )
        with self.assertRaises(SourceFormatError):
            parse_ncu_exports(
                locked_session, fixture["details_csv"], locked_raw,
                unknown_power_context, locked_policy,
            )

        third_run = copy.deepcopy(second_run)
        third_run["run_id"] = f"run-{safe_label}-003"
        third_run["configuration_id"] = f"config-{safe_label}-003"
        third_context = ProfilerImportContext(
            source_label=safe_label,
            source_id="source-local-thor",
            system_id="thor-unit-01",
            run=third_run,
            capture_label="fixture-ncu-warp",
            signature_policy_id="fixture-signatures-v1",
            window_policy_id="not-applicable",
        )
        warp_policy = copy.deepcopy(locked_policy)
        warp_policy["section_mode"] = "warp_state_stats"
        warp_policy["warp_trigger"] = {
            "scheduler_capture_id": f"capture-{safe_label}-002",
            "scheduler_observation_id": (
                f"kernel-observation-{safe_label}_r002_001"
            ),
            "origin": "reviewed_scheduler_evidence",
            "criteria": [
                {
                    "metric_name": "scheduler_issue_active_per_active_cycle",
                    "operator": "lt",
                    "threshold": 0.6,
                    "observed_value": 0.55,
                },
                {
                    "metric_name": "scheduler_active_warps_per_active_cycle",
                    "operator": "gte",
                    "threshold": 1.0,
                    "observed_value": 8.0,
                },
                {
                    "metric_name": "scheduler_eligible_warps_per_active_cycle",
                    "operator": "lt",
                    "threshold": 1.0,
                    "observed_value": 0.5,
                },
            ],
            "launch_occupancy_review": {
                "conclusion": (
                    "launch_and_occupancy_do_not_explain_issue_gap"
                ),
                "basis": "manual_review_of_same_capture_evidence",
                "evidence_fields": [
                    "kernel_observation.launch",
                    "theoretical_occupancy_percent",
                    "achieved_occupancy_percent",
                ],
            },
        }
        warp_sections = ("SpeedOfLight", "LaunchStats", "WarpStateStats")
        warp_session = _task7_session(fixture["session_csv"], warp_sections)
        warp_raw = _raw_with_metrics(fixture["raw_csv"], {
            "gpc__cycles_elapsed.avg.per_second": ("hz", "1386000000"),
            "smsp__average_warp_latency_per_inst_issued.ratio": (
                "cycle/instruction", "20",
            ),
            "smsp__average_warps_issue_stalled_long_scoreboard_per_issue_active.ratio": (
                "cycle/instruction", "8",
            ),
        })
        warp_bundle = parse_ncu_exports(
            warp_session, fixture["details_csv"], warp_raw,
            third_context, warp_policy,
        )
        warp_capture = warp_bundle["datasets"]["profiler_captures"][0]
        self.assertEqual(warp_capture["ncu"]["sections"], list(warp_sections))
        self.assertEqual(warp_capture["ncu"]["explicit_metrics"], [])
        warp_metrics = {
            metric["metric_name"]: metric
            for metric in warp_bundle["datasets"]["profiler_metrics"]
        }
        self.assertNotIn("l2_sysmem_fill_sectors", warp_metrics)
        self.assertEqual(
            warp_metrics[
                "long_scoreboard_cycles_per_issued_instruction"
            ]["unit"],
            "cycles_per_instruction",
        )
        self.assertEqual(
            warp_metrics[
                "short_scoreboard_cycles_per_issued_instruction"
            ]["missing_reason"],
            "counter_absent_from_report",
        )
        missing_review_policy = copy.deepcopy(warp_policy)
        missing_review_policy["warp_trigger"].pop("launch_occupancy_review")
        with self.assertRaises(SourceFormatError):
            parse_ncu_exports(
                warp_session, fixture["details_csv"], warp_raw,
                third_context, missing_review_policy,
            )

        job_policy = copy.deepcopy(locked_policy)
        job_policy.pop("signature")
        job_policy["signature_id"] = "encoder-large-gemm"
        warp_job_policy = copy.deepcopy(warp_policy)
        warp_job_policy.pop("signature")
        warp_job_policy["signature_id"] = "encoder-large-gemm"
        incremental_job = {
            "job_version": "1.0.0",
            "source_label": "task-7-incremental-ncu",
            "policy_file": "/ignored/by-library-call.json",
            "inputs": [
                {
                    "input": "/ignored/second.ncu-rep",
                    "source_label": safe_label,
                    "source_id": "source-local-thor",
                    "system_id": "thor-unit-01",
                    "capture_label": "fixture-ncu-locked",
                    "signature_policy_id": "fixture-signatures-v1",
                    "window_policy_id": "not-applicable",
                    "tool": "ncu",
                    "policy_key": "scheduler",
                    "run": second_run,
                },
                {
                    "input": "/ignored/third.ncu-rep",
                    "source_label": safe_label,
                    "source_id": "source-local-thor",
                    "system_id": "thor-unit-01",
                    "capture_label": "fixture-ncu-warp",
                    "signature_policy_id": "fixture-signatures-v1",
                    "window_policy_id": "not-applicable",
                    "tool": "ncu",
                    "policy_key": "warp",
                    "run": third_run,
                },
            ],
        }
        incremental_policy = {
            "policy_version": "1.0.0",
            "signatures": {"encoder-large-gemm": signature_policy},
            "ncu": {"scheduler": job_policy, "warp": warp_job_policy},
            "nsys": {},
        }
        with patch(
            "extractors.profiler.import_ncu_report",
            side_effect=[second_bundle, warp_bundle],
        ):
            incremental = import_profiler_job(
                incremental_job, incremental_policy, ROOT
            )
        self.assertEqual(
            incremental["datasets"]["runs"][0]["run_id"],
            f"run-{safe_label}-002",
        )
        promotion = plan_promotion(incremental, ROOT)
        self.assertEqual(promotion.updates, 0)
        self.assertNotIn(
            "kernel_signatures", {change.dataset for change in promotion.changes}
        )
        self.assertEqual(
            promotion.additions,
            sum(
                len(records)
                for dataset, records in incremental["datasets"].items()
                if dataset != "kernel_signatures"
            ),
        )

        skipped_ordinal = json.loads(
            json.dumps(second_bundle)
            .replace(f"-{safe_label}-002", f"-{safe_label}-003")
            .replace(f"-{safe_label}_r002_", f"-{safe_label}_r003_")
        )
        with self.assertRaises(PromotionError) as ordinal_error:
            plan_promotion(skipped_ordinal, ROOT)
        self.assertIn(
            "profiler_generated_id",
            {issue.code for issue in ordinal_error.exception.issues},
        )

        signature_drift = copy.deepcopy(incremental)
        signature_drift["datasets"]["kernel_signatures"][0][
            "classification_method"
        ] = "manual"
        with self.assertRaises(PromotionError) as drift_error:
            plan_promotion(signature_drift, ROOT)
        self.assertIn(
            "profiler_signature_drift",
            {issue.code for issue in drift_error.exception.issues},
        )

        for dataset, record in (
            ("runs", canonical_run),
            (
                "kernel_observations",
                _canonical_record(
                    "data/profiler/kernel_observations.json",
                    "observation_id",
                    f"kernel-observation-{safe_label}-001",
                ),
            ),
        ):
            reused = copy.deepcopy(incremental)
            reused["datasets"][dataset].append(record)
            with self.assertRaises(PromotionError) as reuse_error:
                plan_promotion(reused, ROOT)
            self.assertIn(
                "profiler_evidence_overwrite",
                {issue.code for issue in reuse_error.exception.issues},
            )

        reversed_job = copy.deepcopy(incremental_job)
        reversed_job["inputs"].reverse()
        with self.assertRaises(SourceFormatError):
            import_profiler_job(reversed_job, incremental_policy, ROOT)

        duplicate_warp_job = copy.deepcopy(incremental_job)
        extra_warp = copy.deepcopy(duplicate_warp_job["inputs"][-1])
        extra_warp["input"] = "/ignored/fourth.ncu-rep"
        extra_warp["run"]["run_id"] = f"run-{safe_label}-004"
        extra_warp["run"]["configuration_id"] = f"config-{safe_label}-004"
        duplicate_warp_job["inputs"].append(extra_warp)
        with self.assertRaises(SourceFormatError):
            import_profiler_job(duplicate_warp_job, incremental_policy, ROOT)

        ambiguous_ids = copy.deepcopy(second_bundle)
        ambiguous_ids["datasets"]["kernel_observations"][0][
            "observation_id"
        ] = f"kernel-observation-{safe_label}-002-001"
        self.assertIn(
            "profiler_generated_id",
            {
                issue.code for issue in scan_profiler_bundle(
                    ambiguous_ids, allow_partial_run_sequence=True
                )
            },
        )

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

        catalog_models = json.loads(
            (ROOT / "data/catalog/models.json").read_text(encoding="utf-8")
        )["records"]
        ownership_datasets = copy.deepcopy(bundle["datasets"])
        ownership_datasets["models"] = catalog_models
        self.assertEqual(profiler_semantic_issues(ownership_datasets), [])

        wrong_artifact = copy.deepcopy(ownership_datasets)
        wrong_artifact["runs"][0]["model_artifact_id"] = "pi0-private-artifact"
        self.assertIn(
            "broken_reference",
            {issue.code for issue in profiler_semantic_issues(wrong_artifact)},
        )
        for dataset, field in (("runs", "profiler_run_evidence"),
                               ("profiler_captures", "profiler_capture_evidence")):
            wrong_evidence = copy.deepcopy(ownership_datasets)
            wrong_evidence[dataset][0]["evidence"] = "reported_external"
            self.assertIn(
                field,
                {issue.code for issue in profiler_semantic_issues(wrong_evidence)},
            )

        private_signature = copy.deepcopy(bundle)
        private_signature_id = "kernel-signature-pi0-private-label"
        private_signature["datasets"]["kernel_signatures"][0][
            "kernel_signature_id"
        ] = private_signature_id
        private_signature["datasets"]["kernel_observations"][0][
            "kernel_signature_id"
        ] = private_signature_id
        self.assertIn(
            "profiler_generated_id",
            {issue.code for issue in scan_profiler_bundle(private_signature)},
        )

        private_run = copy.deepcopy(bundle)
        private_run["datasets"]["runs"][0]["device_id"] = (
            "/home/example/private-device"
        )
        self.assertIn(
            "profiler_local_path",
            {issue.code for issue in scan_profiler_bundle(private_run)},
        )

        gapped_run_ids = json.loads(
            json.dumps(bundle)
            .replace(f"run-{safe_label}-001", f"run-{safe_label}-042")
            .replace(f"capture-{safe_label}-001", f"capture-{safe_label}-042")
        )
        gapped_run_ids["datasets"]["runs"][0]["configuration_id"] = (
            f"config-{safe_label}-042"
        )
        self.assertIn(
            "profiler_generated_id",
            {issue.code for issue in scan_profiler_bundle(gapped_run_ids)},
        )

        gapped_ids = copy.deepcopy(bundle)
        gapped_metric = copy.deepcopy(
            gapped_ids["datasets"]["profiler_metrics"][0]
        )
        gapped_metric["metric_id"] = f"metric-{safe_label}-042"
        gapped_ids["datasets"]["profiler_metrics"].append(gapped_metric)
        self.assertIn(
            "profiler_generated_id",
            {issue.code for issue in scan_profiler_bundle(gapped_ids)},
        )

        canonical_runs = json.loads(
            (ROOT / "data/measurements/runs.json").read_text(encoding="utf-8")
        )["records"]
        profiler_run_id = next(
            item["run_id"] for item in canonical_runs
            if item["capture_method"] in {"ncu", "nsys"}
        )
        for dataset, path in (
            ("end_to_end", ROOT / "data/measurements/end_to_end.json"),
            ("stages", ROOT / "data/measurements/stages.json"),
        ):
            measurement = copy.deepcopy(
                json.loads(path.read_text(encoding="utf-8"))["records"][0]
            )
            measurement["run_id"] = profiler_run_id
            timing_only = {
                "bundle_version": "1.0.0",
                "source_label": "profiler-timing-negative",
                "datasets": {dataset: [measurement]},
            }
            with self.assertRaises(PromotionError):
                plan_promotion(timing_only, ROOT)

        orphaning_model = copy.deepcopy(
            next(model for model in catalog_models if model["model_id"] == "pi0")
        )
        orphaning_model["artifacts"] = [
            artifact for artifact in orphaning_model["artifacts"]
            if artifact["artifact_id"] != "pi0-flashrt-local-01"
        ]
        catalog_only = {
            "bundle_version": "1.0.0",
            "source_label": "profiler-catalog-negative",
            "datasets": {"models": [orphaning_model]},
        }
        with self.assertRaises(PromotionError):
            plan_promotion(catalog_only, ROOT)

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
        for dataset, records in second_bundle["datasets"].items():
            document = {
                "schema_version": "1.0.0",
                "dataset": dataset,
                "records": records,
            }
            self.assertEqual(validate_document(dataset, document, ROOT), [])


if __name__ == "__main__":
    unittest.main()
