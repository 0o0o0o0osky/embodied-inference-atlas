import copy
import csv
import io
import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from extractors.common import SourceFormatError
from tests.helpers import valid_run
from tools.lib.contracts import validate_document
from tools.lib.privacy import scan_json

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = Path(__file__).parent / "fixtures" / "profiler-ncu-sanitization.json"
SCHEDULER = ("SpeedOfLight", "ComputeWorkloadAnalysis", "MemoryWorkloadAnalysis", "LaunchStats", "Occupancy", "SchedulerStats")
WARP = ("SpeedOfLight", "LaunchStats", "WarpStateStats")
SYSMEM = ("lts__d_sectors_fill_sysmem.sum", "lts__t_sectors_aperture_sysmem_op_write.sum", "lts__t_sectors_srcunit_tex_aperture_sysmem_lookup_miss.sum")
LOCKED = (("--config-file", "off"), ("--profile-from-start", "off"), ("--graph-profiling", "node"),
          ("--filter-mode", "global"), ("--kernel-name-base", "function"), ("--rename-kernels", "off"), ("--import-source", "off"), ("--replay-mode", "kernel"), ("--cache-control", "all"), ("--clock-control", "none"), ("--launch-count", "1"))
SELECTORS = {
    "kernel-signature-pi0-encoder-large-gemm": ("--kernel-id", "::device_kernel:30", None),
    "kernel-signature-pi0-decoder-nvjet-512x16": ("--kernel-name", "nvjet_sm110_qqhsh_512x16_128x3_2x1_2cta_v_bz_NNT", 90),
    "kernel-signature-pi0-siglip-fmha": ("--kernel-id", "::device_kernel:14", None)}

def _csv(payload, *, add=None, drop=None, command=None, unit=None):
    rows = list(csv.reader(io.StringIO(payload)))
    if add: rows[0].extend(add); rows[1].extend(x[0] for x in add.values()); rows[2].extend(x[1] for x in add.values())
    if drop:
        column = rows[0].index(drop)
        for row in rows: row.pop(column)
    if unit: rows[1][rows[0].index(unit[0])] = unit[1]
    if command: next(row for row in rows if row and row[0] == "Profiler Command Line")[1] = command
    output = io.StringIO(); csv.writer(output, lineterminator="\n").writerows(rows)
    return output.getvalue()

def _session(payload, selector, *, warp=False):
    flag, value, skip = selector; selection = f"{flag} {value}" + (f" --launch-skip {skip}" if skip else "")
    sections, metrics = (WARP, "") if warp else (SCHEDULER, f" --metrics {','.join(SYSMEM)}")
    command = "ncu " + " ".join(f"{key} {value}" for key, value in LOCKED)
    command += f" {selection} " + " ".join(f"--section {name}" for name in sections)
    return _csv(payload, command=command + metrics + " --disable-extra-suffixes -o /private/out /private/python")
def _record(path, key, value):
    return next(x for x in json.loads((ROOT / path).read_text())["records"] if x[key] == value)
def _selector(selector):
    return {"kind": selector[0][2:].replace("-", "_"), "value": selector[1], **({"launch_skip": selector[2]} if selector[2] else {})}

class ProfilerImporterTests(unittest.TestCase):
    def test_ncu_fixture_strips_local_identity_and_preserves_missing(self):
        try:
            from extractors.ncu import parse_ncu_exports
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

    def test_task7_locked_capture_boundary(self):
        from extractors.ncu import import_ncu_report, parse_ncu_exports
        from extractors.profiler_common import ProfilerImportContext
        from tools.lib.promotion import PromotionError, plan_promotion

        fixture = json.loads(FIXTURE.read_text())
        label = "pi0-flashrt-ncu-encoder-large-gemm"
        canonical_run = _record("data/measurements/runs.json", "run_id", f"run-{label}-001")
        run = copy.deepcopy(canonical_run)
        run["run_id"], run["configuration_id"] = f"run-{label}-002", f"config-{label}-002"
        run["operating_point"] = {"operating_point_id": "thor-120w-jetson-clocks",
            "power_mode": "120w-mode-1", "clock_policy": "jetson_clocks_locked", "throttle_status": "unknown"}
        run["comparison_context"]["platform"]["operating_point_id"] = "thor-120w-jetson-clocks"
        for field in ("operating_point.clock_policy", "operating_point.power_mode", "operating_point.throttle_status"):
            run["missing"].pop(field)
        context = ProfilerImportContext(source_label=label, source_id="source-local-thor", system_id="thor-unit-01",
            run=run, capture_label="task7-locked", signature_policy_id="task7-v1", window_policy_id="not-applicable")
        def signature(signature_id):
            value = copy.deepcopy(_record("data/profiler/kernel_signatures.json", "kernel_signature_id", signature_id))
            value.pop("model_id"); value.pop("runtime_id")
            return value
        policy = {
            "policy_id": "task7-v1", "section_mode": "scheduler_stats_with_sysmem_sectors",
            "replay_mode": "kernel", "replay_passes": 10, "cache_control_request": "all",
            "clock_control_request": "none", "warmup_count": 3, "backing_store_bytes": None,
            "warnings": [], "origins": {
                "selection_policy": "session_command", "replay_mode": "session_command",
                "replay_passes": "collection_log_manual_audit", "cache_control_request": "session_command",
                "clock_control_request": "session_command", "warmup_count": "harness_source_audit",
                "backing_store_bytes": "unavailable", "disable_extra_suffixes": "session_command",
                "external_clock_control": "collection_wrapper_observed"},
            "expected_result_identity": {
                "ID": "987654321980", "Process ID": "987654321987", "Process Name": "private-python",
                "Host Name": "private-host", "Kernel Name": "void private::mega_gemm<SecretTemplate>(float*)",
                "Context": "987654321985", "Stream": "987654321984", "Block Size": "128",
                "Grid Size": "32", "Device": "987654321983", "CC": "11.0"},
            "expected_geometry": {"grid": [4, 1, 8], "block": [128, 1, 1]},
            "signature": signature(next(iter(SELECTORS))), "approved_selector": _selector(next(iter(SELECTORS.values()))),
            "disable_extra_suffixes": True,
            "external_clock_control": {"controller": "jetson_clocks", "state": "locked"},
            "telemetry": {
                "observed_gpu_frequency": {"statistic": "mean", "value": 1386, "unit": "MHz",
                    "sample_count": 1, "origin": "ncu_gpc_cycle_rate"},
                "observed_emc_frequency": {"missing_reason": "unavailable_from_tool",
                    "origin": "jetson_clocks_show_current_freq"},
                "observed_junction_temperature": {"missing_reason": "unavailable_from_tool", "origin": "tegrastats_tj"},
                "observed_gpu_power": {"missing_reason": "unavailable_from_tool", "origin": "tegrastats_vdd_gpu"},
                "throttle_status": {"missing_reason": "unavailable_from_tool", "origin": "clock_event_audit"}}}
        raw = _csv(fixture["raw_csv"], add={
            "gpc__cycles_elapsed.avg.per_second": ("hz", "1386000000"),
            "gpu__compute_memory_access_throughput.avg.pct_of_peak_sustained_elapsed": ("%", "44"),
            "l1tex__t_sector_hit_rate.pct": ("%", "88"),
            "gpu__compute_memory_request_throughput.avg.pct_of_peak_sustained_elapsed": ("%", "33"),
            "lts__t_sector_hit_rate.pct": ("%", "77"),
            "sm__memory_throughput.avg.pct_of_peak_sustained_elapsed": ("%", "22"),
            "smsp__issue_active.avg.per_cycle_active": ("", "0.55"),
            "smsp__warps_active.avg.per_cycle_active": ("warp", "8"),
            "smsp__warps_eligible.avg.per_cycle_active": ("warp", "0.5"),
            SYSMEM[0]: ("sector", "1000"), SYSMEM[1]: ("sector", "250"), SYSMEM[2]: ("sector", "75")})
        cases = {}
        for signature_id, selector in SELECTORS.items():
            candidate = copy.deepcopy(policy); candidate["signature"] = signature(signature_id)
            candidate["approved_selector"] = _selector(selector)
            session = _session(fixture["session_csv"], selector)
            bundle = parse_ncu_exports(session, fixture["details_csv"], raw, context, candidate)
            self.assertNotIn(selector[1], json.dumps(bundle, sort_keys=True))
            with self.subTest(selector=signature_id), self.assertRaises(SourceFormatError):
                parse_ncu_exports(session.replace(selector[1], "wrong", 1), fixture["details_csv"],
                                  raw, context, candidate)
            cases[signature_id] = candidate, session, bundle
        policy, session, bundle = cases[next(iter(SELECTORS))]
        decoder = cases["kernel-signature-pi0-decoder-nvjet-512x16"]
        with self.assertRaises(SourceFormatError):
            parse_ncu_exports(decoder[1].replace("--launch-skip 90", "--launch-skip 91"), fixture["details_csv"], raw, context, decoder[0])
        def reject(command, source=raw, selected_policy=policy):
            with self.assertRaises(SourceFormatError):
                parse_ncu_exports(command, fixture["details_csv"], source, context, selected_policy)
        for option, value in LOCKED:
            exact = f"{option} {value}"
            with self.subTest(required=option):
                reject(session.replace(exact + " ", "", 1))
                reject(session.replace(exact, f"{exact} {exact}", 1))
        denied = ("--devices 0", "--nvtx-include x", "--nvtx-exclude x", "--range-filter 1",
            "--target-processes-filter x", "--native-include x", "--native-exclude x",
            "--python-include x", "--python-exclude x", "--section-folder x", "--section-folder-recursive x")
        for option in denied:
            with self.subTest(denied=option): reject(session.replace("ncu ", f"ncu {option} ", 1))
        for changed in (session.replace("--kernel-id ::device_kernel:30", "--kernel-id ::device_kernel:30 --kernel-name x"),
            session.replace("--launch-count 1", "--launch-skip-before-match 1 --launch-count 1"),
            session.replace("ncu ", "ncu --set full ", 1),
            session.replace("--section SchedulerStats", "--section SchedulerStats --section WarpStateStats"),
            session.replace("--metrics ", "--metrics extra,"),
            session.replace(" --disable-extra-suffixes", "", 1),
            session.replace("--disable-extra-suffixes", "--disable-extra-suffixes --disable-extra-suffixes", 1)):
            reject(changed)
        reject(session, _csv(raw, unit=("smsp__issue_active.avg.per_cycle_active", "warp/cycle")))
        reject(session, _csv(raw, drop=SYSMEM[0]))
        metrics = {item["metric_name"]: item for item in bundle["datasets"]["profiler_metrics"]}
        self.assertEqual(metrics["scheduler_issue_active_per_active_cycle"]["unit"], "warp_per_cycle")
        self.assertEqual(metrics["scheduler_issue_inst0_percent"]["missing_reason"], "counter_absent_from_report")
        memory_names = ("memory_access_throughput_pct_of_peak_sustained_elapsed", "l1tex_sector_hit_rate_percent",
            "memory_request_throughput_pct_of_peak_sustained_elapsed", "l2_sector_hit_rate_percent",
            "memory_pipes_throughput_pct_of_peak_sustained_elapsed")
        self.assertEqual({metrics[name]["section_name"] for name in memory_names}, {"MemoryWorkloadAnalysis"})
        self.assertNotIn("l2_sysmem_fill_pct_of_peak_sustained_elapsed", metrics)
        self.assertEqual({item["metric_name"]: item for item in bundle["datasets"]["telemetry"]}
                         ["observed_emc_frequency"]["measurement_source"],
                         "jetson_clocks_show_current_freq")
        with patch("extractors.ncu.subprocess.run", side_effect=[
            subprocess.CompletedProcess([], 0, page, "") for page in (session, fixture["details_csv"], raw)]) as reader:
            import_ncu_report(Path("/local/input.ncu-rep"), context, policy)
        self.assertTrue(all(call.args[0].count("--config-file") == 1 and
            call.args[0][call.args[0].index("--config-file") + 1] == "off" for call in reader.call_args_list))
        run3 = copy.deepcopy(run); run3["run_id"], run3["configuration_id"] = f"run-{label}-003", f"config-{label}-003"
        context3 = copy.deepcopy(context); object.__setattr__(context3, "run", run3)
        trigger = {"scheduler_capture_id": f"capture-{label}-002",
            "scheduler_observation_id": f"kernel-observation-{label}_r002_001",
            "origin": "reviewed_scheduler_evidence", "criteria": [
                {"metric_name": "scheduler_issue_active_per_active_cycle", "operator": "lt",
                 "threshold": 0.6, "observed_value": 0.55},
                {"metric_name": "scheduler_active_warps_per_active_cycle", "operator": "gte",
                 "threshold": 1.0, "observed_value": 8.0},
                {"metric_name": "scheduler_eligible_warps_per_active_cycle", "operator": "lt",
                 "threshold": 1.0, "observed_value": 0.5}],
            "launch_occupancy_review": {"conclusion": "launch_and_occupancy_do_not_explain_issue_gap",
                "basis": "manual_review_of_same_capture_evidence",
                "evidence_fields": ["kernel_observation.launch", "theoretical_occupancy_percent",
                                    "achieved_occupancy_percent"]}}
        warp_policy = copy.deepcopy(policy); warp_policy.update(section_mode="warp_state_stats", warp_trigger=trigger)
        warp_session = _session(fixture["session_csv"], SELECTORS[next(iter(SELECTORS))], warp=True)
        warp_raw = _csv(raw, add={
            "smsp__average_warp_latency_per_inst_issued.ratio": ("cycle", "20"),
            "smsp__average_warps_issue_stalled_long_scoreboard_per_issue_active.ratio":
                ("inst", "8")})
        warp_bundle = parse_ncu_exports(warp_session, fixture["details_csv"], warp_raw, context3, warp_policy)
        self.assertEqual(tuple(warp_bundle["datasets"]["profiler_captures"][0]["ncu"][name]
            for name in ("sections", "explicit_metrics")), (list(WARP), []))
        warp_metrics = {item["metric_name"]: item for item in warp_bundle["datasets"]["profiler_metrics"]}
        long_stall = warp_metrics["long_scoreboard_cycles_per_issued_instruction"]
        self.assertEqual((long_stall["raw_counter_name"], long_stall["unit"], long_stall["section_name"]),
            ("smsp__average_warps_issue_stalled_long_scoreboard_per_issue_active.ratio",
             "cycles_per_instruction", "WarpStateStats"))
        for path in ("threshold", "review"):
            bad_trigger = copy.deepcopy(warp_policy)
            if path == "threshold": bad_trigger["warp_trigger"]["criteria"][0]["observed_value"] = 0.61
            else: bad_trigger["warp_trigger"].pop("launch_occupancy_review")
            reject(warp_session, warp_raw, bad_trigger)
        self.assertEqual(plan_promotion(bundle, ROOT).updates, 0)
        drift = copy.deepcopy(bundle); drift["datasets"]["kernel_signatures"][0]["classification_method"] = "manual"
        reused_run = copy.deepcopy(bundle); reused_run["datasets"]["runs"].append(canonical_run)
        reused_child = copy.deepcopy(bundle); reused_child["datasets"]["kernel_observations"].append(_record(
            "data/profiler/kernel_observations.json", "observation_id", f"kernel-observation-{label}-001"))
        for expected, candidate in (("profiler_signature_drift", drift),
            ("profiler_evidence_overwrite", reused_run), ("profiler_evidence_overwrite", reused_child)):
            with self.assertRaises(PromotionError) as error: plan_promotion(candidate, ROOT)
            self.assertIn(expected, {issue.code for issue in error.exception.issues})
        with self.assertRaises(PromotionError): plan_promotion(warp_bundle, ROOT)
if __name__ == "__main__": unittest.main()
