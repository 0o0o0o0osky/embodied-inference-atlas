from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
import math

from extractors.profiler_common import (
    METRIC_REGISTRY,
    SCHEDULER_DIRECT_METRIC_NAMES,
    SCHEDULER_METRIC_NAMES,
    SYSMEM_SECTOR_METRIC_NAMES,
    WARP_STATE_METRIC_NAMES,
    valid_warp_trigger,
)
from tools.lib.contracts import Issue
from tools.lib.model_graph import materialize_model_graph


PROFILER_DATASETS = (
    "profiler_captures",
    "timelines",
    "kernel_signatures",
    "kernel_observations",
    "profiler_metrics",
    "operator_kernel_links",
    "telemetry",
)

_TASK7_SCHEDULER_SECTIONS = (
    "SpeedOfLight",
    "ComputeWorkloadAnalysis",
    "MemoryWorkloadAnalysis",
    "LaunchStats",
    "Occupancy",
    "SchedulerStats",
)
_TASK7_SYSMEM_METRICS = (
    "lts__d_sectors_fill_sysmem.sum",
    "lts__t_sectors_aperture_sysmem_op_write.sum",
    "lts__t_sectors_srcunit_tex_aperture_sysmem_lookup_miss.sum",
)
_TASK7_WARP_SECTIONS = ("SpeedOfLight", "LaunchStats", "WarpStateStats")
_TASK7_SCHEDULER_METRIC_NAMES = frozenset((
    *SCHEDULER_DIRECT_METRIC_NAMES,
    "gpc_cycle_rate_hz",
    *SCHEDULER_METRIC_NAMES,
    *SYSMEM_SECTOR_METRIC_NAMES,
    "system_memory_throughput_pct_of_ceiling",
    "system_memory_bytes",
))
_TASK7_WARP_METRIC_NAMES = frozenset((
    "kernel_duration",
    "sm_throughput_pct_of_peak_sustained_elapsed",
    "gpc_cycle_rate_hz",
    *WARP_STATE_METRIC_NAMES,
))
_TASK7_LOCKED_TELEMETRY = {
    "observed_gpu_frequency": ("MHz", "ncu_gpc_cycle_rate"),
    "observed_emc_frequency": ("MHz", "jetson_clocks_show_current_freq"),
    "observed_junction_temperature": ("celsius", "tegrastats_tj"),
    "observed_gpu_power": ("mW", "tegrastats_vdd_gpu"),
    "throttle_status": ("percent", "clock_event_audit"),
}


def profiler_semantic_issues(datasets: Mapping[str, list[Mapping]]) -> list[Issue]:
    issues: list[Issue] = []
    runs = _index(datasets, "runs", "run_id")
    captures = _index(datasets, "profiler_captures", "capture_id")
    timelines = _index(datasets, "timelines", "timeline_id")
    signatures = _index(datasets, "kernel_signatures", "kernel_signature_id")
    observations = _index(datasets, "kernel_observations", "observation_id")
    sources = _index(datasets, "sources", "source_id")
    models = _index(datasets, "models", "model_id")
    runtimes = _index(datasets, "runtimes", "runtime_id")
    devices = _index(datasets, "devices", "device_id")
    systems = _index(datasets, "systems", "system_id")
    model_artifacts = {
        (model_id, artifact.get("artifact_id"))
        for model_id, model in models.items()
        for artifact in _mapping_list(model.get("artifacts"))
        if isinstance(artifact.get("artifact_id"), str)
    }

    captured_run_ids = {
        capture.get("run_id")
        for capture in datasets.get("profiler_captures", [])
        if isinstance(capture.get("run_id"), str)
    }
    profiler_run_ids = {
        run_id for run_id, run in runs.items()
        if run.get("capture_method") in {"nsys", "ncu"}
        or run_id in captured_run_ids
    }
    for run_id in sorted(profiler_run_ids, key=str):
        run = runs[run_id]
        if run.get("evidence") != "measured_local":
            issues.append(_issue(
                f"$.runs[{run_id}].evidence",
                "profiler_run_evidence",
                "profiler runs require measured_local evidence",
            ))
        for field, dataset_name, catalog in (
            ("source_id", "sources", sources),
            ("model_id", "models", models),
            ("runtime_id", "runtimes", runtimes),
            ("device_id", "devices", devices),
            ("system_id", "systems", systems),
        ):
            if dataset_name in datasets and run.get(field) not in catalog:
                issues.append(_broken(f"$.runs[{run_id}].{field}"))
        if (
            "models" in datasets
            and (run.get("model_id"), run.get("model_artifact_id"))
            not in model_artifacts
        ):
            issues.append(_broken(f"$.runs[{run_id}].model_artifact_id"))
    for dataset_name in ("end_to_end", "stages"):
        for index, measurement in enumerate(datasets.get(dataset_name, [])):
            if measurement.get("run_id") in profiler_run_ids:
                issues.append(_issue(
                    f"$.{dataset_name}[{index}].run_id",
                    "profiler_timing_measurement",
                    "profiler runs cannot carry end-to-end or stage measurements",
                ))

    capture_counts = Counter(
        record.get("run_id") for record in datasets.get("profiler_captures", [])
        if isinstance(record.get("run_id"), str)
    )
    for index, capture in enumerate(datasets.get("profiler_captures", [])):
        base = f"$.profiler_captures[{index}]"
        if capture.get("evidence") != "measured_local":
            issues.append(_issue(
                f"{base}.evidence",
                "profiler_capture_evidence",
                "profiler captures require measured_local evidence",
            ))
        run = runs.get(capture.get("run_id"))
        if run is None:
            issues.append(_broken(f"{base}.run_id"))
            continue
        tool = capture.get("tool")
        summary = capture.get("analysis_summary")
        if isinstance(summary, Mapping):
            sample = capture.get("analysis_sample") or {}
            wall = summary.get("wall") or {}
            hotspots = summary.get("hotspots") or []
            def stable_stat(stat):
                median, cv = stat.get("median_ns"), stat.get("cv")
                return (isinstance(median, (int, float)) and math.isfinite(median) and median > 0
                        and isinstance(cv, (int, float)) and math.isfinite(cv) and 0 <= cv <= .05)
            valid = (
                tool == "nsys" and summary.get("status") == "stable"
                and summary.get("representative_capture_id") == capture.get("capture_id")
                and summary.get("sample_count") == sample.get("measured_iterations") == 10
                and summary.get("warmup_iterations") == sample.get("warmup_iterations") == 5
                and summary.get("batch_id") == sample.get("batch_id")
                and summary.get("input_case_id") == sample.get("input_case_id")
                and capture.get("coverage", {}).get("is_complete_for_population") is True
                and stable_stat(wall) and bool(hotspots)
                and all(stable_stat(h) and h.get("counts_match") is True for h in hotspots)
            )
            if not valid:
                issues.append(_issue(f"{base}.analysis_summary", "analysis_summary_stability",
                    "retained representative requires its matching complete 5+10 batch summary, CV <= 5% and consistent hotspot counts"))
        if run.get("capture_method") != tool:
            issues.append(_issue(f"{base}.tool", "capture_method_mismatch", "capture tool must match its run"))
        if capture.get("source_id") != run.get("source_id"):
            issues.append(_issue(f"{base}.source_id", "capture_source_mismatch", "capture source must match its run"))
        nsys = capture.get("nsys")
        ncu = capture.get("ncu")
        if (nsys is None) == (ncu is None) or (tool == "nsys") != (nsys is not None):
            issues.append(_issue(base, "capture_extension", "exactly the matching profiler extension is required"))
        if tool == "ncu" and isinstance(ncu, Mapping):
            warnings = capture.get("warnings")
            operating = run.get("operating_point")
            origins = ncu.get("origins")
            missing = capture.get("missing")
            warning_values = warnings if isinstance(warnings, list) else []
            common_provenance_valid = (
                isinstance(origins, Mapping)
                and origins.get("selection_policy") == "session_command"
                and origins.get("warmup_count") == "harness_source_audit"
                and origins.get("backing_store_bytes") == "unavailable"
                and ncu.get("backing_store_bytes") is None
                and isinstance(missing, Mapping)
                and missing.get("ncu.backing_store_bytes") == "unavailable"
                and isinstance(warnings, list)
            )
            clock_control = ncu.get("clock_control_request")
            if clock_control in {"base", "none"} and ncu.get("external_clock_control") is None:
                clock_provenance_valid = (
                    isinstance(origins, Mapping)
                    and origins.get("gpu_frequency_not_fixed")
                    == "collection_log_manual_audit"
                    and "external_clock_control" not in origins
                    and ncu.get("external_clock_control") is None
                    and "gpu_frequency_not_fixed" in warning_values
                    and ncu.get("section_mode") is None
                    and ncu.get("sections") is None
                    and ncu.get("explicit_metrics") is None
                    and ncu.get("disable_extra_suffixes") is None
                )
            else:
                mode = ncu.get("section_mode")
                scheduler_mode = mode == "scheduler_stats_with_sysmem_sectors"
                warp_mode = mode == "warp_state_stats"
                expected_sections = list(
                    _TASK7_SCHEDULER_SECTIONS
                    if scheduler_mode else _TASK7_WARP_SECTIONS
                )
                expected_metrics = (
                    list(_TASK7_SYSMEM_METRICS) if scheduler_mode else []
                )
                clock_provenance_valid = (
                    clock_control == "none"
                    and isinstance(origins, Mapping)
                    and origins.get("external_clock_control")
                    == "collection_wrapper_observed"
                    and origins.get("disable_extra_suffixes") == "session_command"
                    and "gpu_frequency_not_fixed" not in origins
                    and ncu.get("external_clock_control") == {
                        "controller": "jetson_clocks", "state": "locked",
                    }
                    and "gpu_frequency_not_fixed" not in warning_values
                    and (scheduler_mode or warp_mode)
                    and ncu.get("sections") == expected_sections
                    and ncu.get("explicit_metrics") == expected_metrics
                    and (
                        "warp_trigger" not in ncu
                        if scheduler_mode else valid_warp_trigger(
                            ncu.get("warp_trigger")
                        )
                    )
                    and ncu.get("disable_extra_suffixes") is True
                    and isinstance(operating, Mapping)
                    and operating.get("power_mode") in {"120W", "120w-mode-1"}
                    and operating.get("clock_policy") == "jetson_clocks_locked"
                    and operating.get("throttle_status") == "unknown"
                )
            if not common_provenance_valid or not clock_provenance_valid:
                issues.append(_issue(base, "ncu_provenance", "NCU collection fields require controlled evidence origins"))
            if (
                isinstance(warnings, list)
                and "gpu_frequency_not_fixed" in warnings
                and isinstance(operating, Mapping)
                and (
                    operating.get("clock_policy") in {"fixed", "locked", "base_locked"}
                    or operating.get("throttle_status") in {"none", "not_observed"}
                )
            ):
                issues.append(_issue(base, "unstable_clock_claim", "an unlocked replay cannot claim stable clock or no throttle"))
    for run_id, run in runs.items():
        if run.get("capture_method") in {"nsys", "ncu"} and capture_counts[run_id] != 1:
            issues.append(_issue(f"$.runs[{run_id}]", "profiler_capture_count", "each profiler run must own exactly one capture"))

    capture_timeline_summaries: dict[str, set[str]] = defaultdict(set)
    for index, timeline in enumerate(datasets.get("timelines", [])):
        base = f"$.timelines[{index}]"
        capture = captures.get(timeline.get("capture_id"))
        if capture is None:
            issues.append(_broken(f"{base}.capture_id"))
            continue
        _same_capture_context(issues, base, timeline, capture)
        if capture.get("tool") != "nsys":
            issues.append(_issue(f"{base}.capture_id", "timeline_tool", "timelines require an Nsys capture"))
        window = timeline.get("window")
        duration = window.get("duration_ns") if isinstance(window, Mapping) else None
        if not isinstance(window, Mapping) or window.get("start_ns") != 0:
            issues.append(_issue(f"{base}.window.start_ns", "relative_window", "timeline windows must begin at zero"))
        lanes = _mapping_list(timeline.get("lanes"))
        events = _mapping_list(timeline.get("events"))
        lane_ids = _unique_local_ids(issues, lanes, "lane_id", f"{base}.lanes")
        _unique_local_ids(issues, events, "event_id", f"{base}.events")
        ordinals = sorted(lane.get("ordinal") for lane in lanes if isinstance(lane.get("ordinal"), int))
        if ordinals != list(range(len(lanes))):
            issues.append(_issue(f"{base}.lanes", "lane_ordinals", "lane ordinals must be contiguous and timeline-local"))
        event_ids: set[str] = set()
        for event_index, event in enumerate(events):
            event_base = f"{base}.events[{event_index}]"
            event_id = event.get("event_id")
            if isinstance(event_id, str):
                event_ids.add(event_id)
            if event.get("lane_id") not in lane_ids:
                issues.append(_broken(f"{event_base}.lane_id"))
            start = event.get("start_ns")
            event_duration = event.get("duration_ns")
            if (
                not isinstance(duration, int)
                or not isinstance(start, int)
                or not isinstance(event_duration, int)
                or start < 0
                or event_duration <= 0
                or start + event_duration > duration
            ):
                issues.append(_issue(event_base, "event_bounds", "timeline events must be positive and bounded"))
            signature_id = event.get("kernel_signature_id")
            if isinstance(signature_id, str) and signature_id not in signatures:
                issues.append(_broken(f"{event_base}.kernel_signature_id"))
        valid_inputs = lane_ids | event_ids
        lane_by_id = {
            lane.get("lane_id"): lane
            for lane in lanes if isinstance(lane.get("lane_id"), str)
        }
        summary_names: set[object] = set()
        for summary_index, summary in enumerate(_mapping_list(timeline.get("summaries"))):
            summary_base = f"{base}.summaries[{summary_index}]"
            metric_name = summary.get("metric_name")
            capture_timeline_summaries[str(timeline.get("capture_id"))].add(str(metric_name))
            if metric_name in summary_names:
                issues.append(_issue(summary_base, "duplicate_summary", "timeline summary names must be unique"))
            summary_names.add(metric_name)
            refs = summary.get("input_refs")
            if not isinstance(refs, list) or not refs or any(ref not in valid_inputs for ref in refs):
                issues.append(_issue(f"{summary_base}.input_refs", "summary_inputs", "derived summaries require same-timeline inputs"))
            else:
                _validate_activity_summary(issues, summary, lane_by_id, summary_base)

    for index, signature in enumerate(datasets.get("kernel_signatures", [])):
        precision = signature.get("precision_path")
        if not isinstance(precision, Mapping):
            continue
        missing = precision.get("missing")
        missing = missing if isinstance(missing, Mapping) else {}
        for field in ("input_dtype_class", "accumulator_dtype_class", "output_dtype_class"):
            if precision.get(field) is None and field not in missing:
                issues.append(_issue(f"$.kernel_signatures[{index}].precision_path.missing.{field}", "missing_reason_required", "null precision fields require a reason"))
            if precision.get(field) is not None and field in missing:
                issues.append(_issue(f"$.kernel_signatures[{index}].precision_path.missing.{field}", "unexpected_missing_reason", "present precision fields cannot carry a missing reason"))

    for index, observation in enumerate(datasets.get("kernel_observations", [])):
        base = f"$.kernel_observations[{index}]"
        capture = captures.get(observation.get("capture_id"))
        if capture is None:
            issues.append(_broken(f"{base}.capture_id"))
            continue
        _same_capture_context(issues, base, observation, capture)
        signature = signatures.get(observation.get("kernel_signature_id"))
        if signature is None:
            issues.append(_broken(f"{base}.kernel_signature_id"))
        else:
            run = runs.get(observation.get("run_id"))
            if run is None:
                issues.append(_broken(f"{base}.run_id"))
            elif (
                signature.get("model_id") != run.get("model_id")
                or signature.get("runtime_id") != run.get("runtime_id")
            ):
                issues.append(_issue(
                    f"{base}.kernel_signature_id",
                    "signature_run_mismatch",
                    "signature model and runtime must match the observation run",
                ))
        duration = observation.get("duration")
        if not isinstance(duration, Mapping) or duration.get("sample_count") != observation.get("calls"):
            issues.append(_issue(f"{base}.duration.sample_count", "observation_samples", "duration samples must match calls"))
        if capture.get("tool") == "ncu":
            expected_population = {
                "explicit_invocation": "one_explicitly_selected_replayed_launch",
                "name_filter_selected_match": "one_name_filtered_selected_match_replayed_launch",
            }.get(capture.get("selection_policy"))
            valid_ncu = (
                observation.get("observation_kind") == "ncu_replayed_launch"
                and observation.get("calls") == 1
                and isinstance(duration, Mapping)
                and duration.get("statistic") == "single"
                and duration.get("sample_count") == 1
                and observation.get("duration_share") is None
                and observation.get("population") == expected_population
            )
            if not valid_ncu:
                issues.append(_issue(base, "ncu_replay_basis", "NCU observations must remain one replayed launch without duration share"))
        share = observation.get("duration_share")
        if isinstance(share, Mapping):
            denominator = share.get("denominator")
            if capture.get("tool") != "nsys" or denominator not in {"kernel_duration_sum", "window_duration"}:
                issues.append(_issue(f"{base}.duration_share", "duration_share_basis", "duration share requires an Nsys window denominator"))
            if denominator == "kernel_duration_sum" and "kernel_duration_sum" not in capture_timeline_summaries.get(str(observation.get("capture_id")), set()):
                issues.append(_issue(f"{base}.duration_share.denominator", "missing_denominator", "same-capture kernel denominator is required"))
        launch = observation.get("launch")
        missing = observation.get("missing")
        if isinstance(launch, Mapping) and isinstance(missing, Mapping):
            for field in ("grid", "block", "registers_per_thread", "static_shared_memory_bytes", "dynamic_shared_memory_bytes", "waves_per_sm"):
                key = f"launch.{field}"
                if launch.get(field) is None and key not in missing:
                    issues.append(_issue(f"{base}.missing.{key}", "missing_reason_required", "null launch fields require a reason"))
                if launch.get(field) is not None and key in missing:
                    issues.append(_issue(f"{base}.missing.{key}", "unexpected_missing_reason", "present launch fields cannot carry a missing reason"))
                if missing.get(key) == "varies_across_population" and (
                    observation.get("observation_kind") != "nsys_window_aggregate"
                    or not isinstance(observation.get("calls"), int)
                    or observation.get("calls") <= 1
                    or launch.get(field) is not None
                ):
                    issues.append(_issue(
                        f"{base}.missing.{key}",
                        "varying_launch_population",
                        "varying launch values require a multi-call Nsys aggregate and a null field",
                    ))
            for field in ("grid", "block"):
                vector = launch.get(field)
                if isinstance(vector, list) and (len(vector) != 3 or any(not isinstance(item, int) or isinstance(item, bool) or item < 1 for item in vector)):
                    issues.append(_issue(f"{base}.launch.{field}", "launch_dimension", "launch dimensions must contain three positive integers"))

    metric_identities: set[tuple[object, ...]] = set()
    profiler_metrics_by_capture: dict[object, dict[object, Mapping]] = defaultdict(dict)
    for index, metric in enumerate(datasets.get("profiler_metrics", [])):
        base = f"$.profiler_metrics[{index}]"
        capture = captures.get(metric.get("capture_id"))
        if capture is None:
            issues.append(_broken(f"{base}.capture_id"))
            continue
        _same_capture_context(issues, base, metric, capture)
        profiler_metrics_by_capture[metric.get("capture_id")][
            metric.get("metric_name")
        ] = metric
        value = metric.get("value")
        reason = metric.get("missing_reason")
        if (_is_number(value)) == (reason is not None):
            issues.append(_issue(base, "metric_missing_xor", "metric value and missing reason are exclusive"))
        spec = METRIC_REGISTRY.get(str(metric.get("metric_name")))
        if spec is None or (
            metric.get("unit") != spec.get("unit")
            or metric.get("basis") != spec.get("basis")
            or metric.get("raw_counter_name") != spec.get("raw_counter_name")
            or metric.get("section_name") not in spec.get("sections", ())
        ):
            issues.append(_issue(base, "metric_registry", "metric identity, unit, basis, counter, and section must be registered"))
        subject = metric.get("subject")
        subject_record = None
        if isinstance(subject, Mapping):
            subject_record = {
                "capture": captures.get(subject.get("id")),
                "timeline": timelines.get(subject.get("id")),
                "kernel_observation": observations.get(subject.get("id")),
            }.get(subject.get("kind"))
        if subject_record is None:
            issues.append(_broken(f"{base}.subject.id"))
        elif (
            subject.get("kind") == "capture"
            and subject.get("id") != metric.get("capture_id")
            or subject.get("kind") != "capture"
            and subject_record.get("capture_id") != metric.get("capture_id")
        ):
            issues.append(_issue(f"{base}.subject.id", "subject_capture_mismatch", "metric subject must belong to its capture"))
        identity = (
            subject.get("kind") if isinstance(subject, Mapping) else None,
            subject.get("id") if isinstance(subject, Mapping) else None,
            metric.get("metric_name"), metric.get("basis"), metric.get("statistic"),
        )
        if identity in metric_identities:
            issues.append(_issue(base, "duplicate_metric_identity", "metric identity must be unique per subject and basis"))
        metric_identities.add(identity)

    issues.extend(_locked_ncu_metric_issues(
        datasets, captures, observations,
    ))
    issues.extend(_warp_trigger_issues(
        datasets,
        runs,
        captures,
        observations,
        profiler_metrics_by_capture,
    ))
    issues.extend(_link_issues(datasets, runs, captures, observations, signatures))
    issues.extend(_telemetry_issues(datasets, runs, captures))
    return issues


def _locked_ncu_metric_issues(
    datasets: Mapping[str, list[Mapping]],
    captures: Mapping[object, Mapping],
    observations: Mapping[object, Mapping],
) -> list[Issue]:
    issues: list[Issue] = []
    observations_by_capture: dict[object, list[Mapping]] = defaultdict(list)
    metrics_by_capture: dict[object, list[Mapping]] = defaultdict(list)
    for observation in observations.values():
        observations_by_capture[observation.get("capture_id")].append(observation)
    for metric in datasets.get("profiler_metrics", []):
        metrics_by_capture[metric.get("capture_id")].append(metric)
    expected_by_mode = {
        "scheduler_stats_with_sysmem_sectors": _TASK7_SCHEDULER_METRIC_NAMES,
        "warp_state_stats": _TASK7_WARP_METRIC_NAMES,
    }
    for capture_id, capture in captures.items():
        ncu = capture.get("ncu")
        mode = ncu.get("section_mode") if isinstance(ncu, Mapping) else None
        expected = expected_by_mode.get(mode)
        if expected is None:
            continue
        capture_observations = observations_by_capture.get(capture_id, [])
        observation_id = (
            capture_observations[0].get("observation_id")
            if len(capture_observations) == 1 else None
        )
        records = metrics_by_capture.get(capture_id, [])
        valid = (
            observation_id is not None
            and Counter(record.get("metric_name") for record in records)
            == Counter(expected)
            and all(record.get("subject") == {
                "kind": "kernel_observation", "id": observation_id,
            } for record in records)
        )
        if not valid:
            issues.append(_issue(
                f"$.profiler_captures[{capture_id}].ncu.section_mode",
                "locked_ncu_metric_contract",
                "locked NCU captures require one exact metric set on their single kernel observation",
            ))
    return issues


def _warp_trigger_issues(
    datasets: Mapping[str, list[Mapping]],
    runs: Mapping[object, Mapping],
    captures: Mapping[object, Mapping],
    observations: Mapping[object, Mapping],
    metrics_by_capture: Mapping[object, Mapping[object, Mapping]],
) -> list[Issue]:
    issues: list[Issue] = []
    observations_by_capture: dict[object, list[Mapping]] = defaultdict(list)
    for observation in observations.values():
        observations_by_capture[observation.get("capture_id")].append(observation)

    warp_counts: Counter[object] = Counter()
    for capture_id, capture in captures.items():
        ncu = capture.get("ncu")
        if not isinstance(ncu, Mapping):
            continue
        mode = ncu.get("section_mode")
        capture_metrics = metrics_by_capture.get(capture_id, {})
        if mode == "scheduler_stats_with_sysmem_sectors":
            sysmem = {
                name: capture_metrics.get(name) for name in (
                    "l2_sysmem_fill_sectors",
                    "l2_sysmem_write_sectors",
                    "l2_sysmem_lookup_miss_sectors",
                )
            }
            if any(
                not isinstance(metric, Mapping)
                or not _is_number(metric.get("value"))
                for metric in sysmem.values()
            ):
                issues.append(_issue(
                    f"$.profiler_captures[{capture_id}].ncu.explicit_metrics",
                    "scheduler_sysmem_stop_gate",
                    "scheduler captures require three numeric sysmem sector counters",
                ))
            if any(
                metric.get("section_name") not in {
                    *_TASK7_SCHEDULER_SECTIONS,
                    "explicit_sysmem_sector_metrics",
                }
                for metric in capture_metrics.values()
            ):
                issues.append(_issue(
                    f"$.profiler_captures[{capture_id}].ncu.section_mode",
                    "ncu_mode_scope",
                    "scheduler captures cannot contain metrics outside their six sections and explicit sysmem counters",
                ))
            continue
        if mode != "warp_state_stats":
            continue

        warp_observations = observations_by_capture.get(capture_id, [])
        if len(warp_observations) != 1:
            issues.append(_issue(
                f"$.profiler_captures[{capture_id}]",
                "warp_trigger_evidence",
                "warp capture requires exactly one same-capture observation",
            ))
            continue
        warp_observation = warp_observations[0]
        signature_id = warp_observation.get("kernel_signature_id")
        warp_counts[signature_id] += 1
        allowed_warp_metrics = {
            "kernel_duration",
            "sm_throughput_pct_of_peak_sustained_elapsed",
            "gpc_cycle_rate_hz",
            "average_warp_latency_cycles_per_issued_instruction",
            "long_scoreboard_cycles_per_issued_instruction",
            "short_scoreboard_cycles_per_issued_instruction",
        }
        if set(capture_metrics) - allowed_warp_metrics:
            issues.append(_issue(
                f"$.profiler_captures[{capture_id}].ncu.section_mode",
                "ncu_mode_scope",
                "warp captures cannot contain scheduler, compute, memory, occupancy, or sysmem metrics",
            ))

        trigger = ncu.get("warp_trigger")
        if not valid_warp_trigger(trigger):
            issues.append(_issue(
                f"$.profiler_captures[{capture_id}].ncu.warp_trigger",
                "warp_trigger_evidence",
                "warp capture requires the approved compound scheduler review trigger",
            ))
            continue
        assert isinstance(trigger, Mapping)
        scheduler_capture = captures.get(trigger["scheduler_capture_id"])
        scheduler_ncu = (
            scheduler_capture.get("ncu")
            if isinstance(scheduler_capture, Mapping) else None
        )
        scheduler_observation = observations.get(
            trigger["scheduler_observation_id"]
        )
        valid_pair = (
            isinstance(scheduler_capture, Mapping)
            and isinstance(scheduler_ncu, Mapping)
            and scheduler_ncu.get("section_mode")
            == "scheduler_stats_with_sysmem_sectors"
            and isinstance(scheduler_observation, Mapping)
            and scheduler_observation.get("capture_id")
            == trigger["scheduler_capture_id"]
            and scheduler_observation.get("kernel_signature_id") == signature_id
            and scheduler_capture.get("source_id") == capture.get("source_id")
            and _next_capture_ordinal(
                str(scheduler_capture.get("capture_id")), str(capture_id)
            )
        )
        scheduler_run = (
            runs.get(scheduler_capture.get("run_id"))
            if isinstance(scheduler_capture, Mapping) else None
        )
        warp_run = runs.get(capture.get("run_id"))
        valid_pair = valid_pair and (
            isinstance(scheduler_run, Mapping)
            and isinstance(warp_run, Mapping)
            and all(
                scheduler_run.get(field) == warp_run.get(field)
                for field in (
                    "model_id", "runtime_id", "system_id", "device_id",
                    "model_artifact_id", "workload", "precision",
                    "operating_point",
                )
            )
        )
        scheduler_metrics = metrics_by_capture.get(
            trigger["scheduler_capture_id"], {}
        )
        for criterion in trigger["criteria"]:
            assert isinstance(criterion, Mapping)
            metric = scheduler_metrics.get(criterion["metric_name"])
            valid_pair = valid_pair and (
                isinstance(metric, Mapping)
                and _is_number(metric.get("value"))
                and float(metric["value"])
                == float(criterion["observed_value"])
                and metric.get("subject") == {
                    "kind": "kernel_observation",
                    "id": trigger["scheduler_observation_id"],
                }
            )
        valid_pair = valid_pair and all(
            isinstance(scheduler_metrics.get(name), Mapping)
            and _is_number(scheduler_metrics[name].get("value"))
            for name in (
                "theoretical_occupancy_percent",
                "achieved_occupancy_percent",
            )
        )
        launch = (
            scheduler_observation.get("launch")
            if isinstance(scheduler_observation, Mapping) else None
        )
        valid_pair = (
            valid_pair
            and isinstance(launch, Mapping)
            and launch == warp_observation.get("launch")
        )
        if not valid_pair:
            issues.append(_issue(
                f"$.profiler_captures[{capture_id}].ncu.warp_trigger",
                "warp_trigger_evidence",
                "warp trigger must resolve to the immediately preceding same-signature scheduler evidence and its reviewed metric values",
            ))
    for signature_id, count in warp_counts.items():
        if count > 1:
            issues.append(_issue(
                f"$.kernel_signatures[{signature_id}]",
                "warp_capture_limit",
                "each kernel signature permits at most one reviewed WarpStateStats supplement",
            ))
    return issues


def _next_capture_ordinal(first: str, second: str) -> bool:
    first_match = first.rsplit("-", 1)
    second_match = second.rsplit("-", 1)
    return (
        len(first_match) == 2
        and len(second_match) == 2
        and first_match[0] == second_match[0]
        and first_match[1].isdigit()
        and second_match[1].isdigit()
        and int(second_match[1]) == int(first_match[1]) + 1
    )


def _link_issues(
    datasets: Mapping[str, list[Mapping]],
    runs: Mapping[object, Mapping],
    captures: Mapping[object, Mapping],
    observations: Mapping[object, Mapping],
    signatures: Mapping[object, Mapping],
) -> list[Issue]:
    issues: list[Issue] = []
    graphs = _index(datasets, "model_graphs", "model_graph_id")
    realizations = _index(datasets, "runtime_realizations", "realization_id")
    for index, link in enumerate(datasets.get("operator_kernel_links", [])):
        base = f"$.operator_kernel_links[{index}]"
        observation = observations.get(link.get("observation_id"))
        if observation is None:
            issues.append(_broken(f"{base}.observation_id"))
            continue
        if link.get("kernel_signature_id") not in signatures or link.get("kernel_signature_id") != observation.get("kernel_signature_id"):
            issues.append(_broken(f"{base}.kernel_signature_id"))
        run = runs.get(link.get("run_id"))
        if run is None or link.get("run_id") != observation.get("run_id"):
            issues.append(_broken(f"{base}.run_id"))
        graph = graphs.get(link.get("model_graph_id"))
        logical_refs: set[str] = set()
        repeat_scopes: dict[str, _RepeatScope] = {}
        if graph is None:
            issues.append(_broken(f"{base}.model_graph_id"))
        else:
            if run is not None and graph.get("model_id") != run.get("model_id"):
                issues.append(_issue(
                    f"{base}.model_graph_id",
                    "link_model_mismatch",
                    "link graph model must match the run model",
                ))
            try:
                logical_refs, repeat_scopes = _logical_index(materialize_model_graph(graph))
            except (KeyError, TypeError, ValueError):
                issues.append(_issue(
                    f"{base}.model_graph_id",
                    "invalid_model_graph",
                    "declared model graph could not be materialized",
                ))
        for target_index, target in enumerate(_mapping_list(link.get("logical_targets"))):
            target_base = f"{base}.logical_targets[{target_index}]"
            target_ref = target.get("ref")
            if isinstance(target_ref, str) and target_ref not in logical_refs:
                issues.append(_issue(
                    f"{target_base}.ref",
                    "broken_logical_reference",
                    "logical reference does not resolve in the declared model graph",
                ))
            _validate_repeat_selectors(
                issues,
                target.get("repeat_selectors"),
                repeat_scopes,
                target_ref if isinstance(target_ref, str) else None,
                f"{target_base}.repeat_selectors",
            )
        for evidence_index, evidence_id in enumerate(
            link.get("evidence_ids") if isinstance(link.get("evidence_ids"), list) else []
        ):
            if evidence_id not in captures:
                issues.append(_broken(f"{base}.evidence_ids[{evidence_index}]"))
        coverage = link.get("coverage")
        if isinstance(coverage, Mapping):
            mapped = coverage.get("mapped_launches")
            population = coverage.get("population_launches")
            calls = observation.get("calls")
            if (
                not isinstance(mapped, int)
                or isinstance(mapped, bool)
                or not isinstance(population, int)
                or isinstance(population, bool)
                or mapped > population
                or population != calls
            ):
                issues.append(_issue(
                    f"{base}.coverage",
                    "link_coverage",
                    "link coverage must be bounded by the observation launch population",
                ))
        realization_id = link.get("realization_id")
        group_ids = link.get("execution_group_ids")
        if realization_id is None:
            if group_ids or link.get("reason_code") is None:
                issues.append(_issue(base, "link_realization_absent", "absent realization/group linkage requires an empty group list and reason"))
            continue
        realization = realizations.get(realization_id)
        if realization is None:
            issues.append(_broken(f"{base}.realization_id"))
            continue
        if realization.get("model_graph_id") != link.get("model_graph_id"):
            issues.append(_issue(f"{base}.realization_id", "link_graph_mismatch", "link realization must use the declared graph"))
        if run is not None and (
            realization.get("model_id") != run.get("model_id")
            or realization.get("runtime_id") != run.get("runtime_id")
        ):
            issues.append(_issue(
                f"{base}.realization_id",
                "link_realization_run_mismatch",
                "link realization model and runtime must match the run",
            ))
        valid_groups = {
            group.get("execution_group_id")
            for group in _mapping_list(realization.get("execution_groups"))
        }
        for group_index, group_id in enumerate(group_ids if isinstance(group_ids, list) else []):
            if group_id not in valid_groups:
                issues.append(_broken(f"{base}.execution_group_ids[{group_index}]"))
    return issues


@dataclass(frozen=True)
class _RepeatScope:
    repeat: int
    target_prefix: str
    tail_start: int | None = None
    tail_operator_refs: frozenset[str] = frozenset()


def _logical_index(materialized: Mapping) -> tuple[set[str], dict[str, _RepeatScope]]:
    refs = set(materialized.get("operators_by_id", {}))
    repeat_scopes: dict[str, _RepeatScope] = {}
    for prefix, field in (("input", "graph_inputs"), ("output", "graph_outputs")):
        for tensor in _mapping_list(materialized.get(field)):
            if isinstance(tensor.get("tensor_id"), str):
                refs.add(f"{prefix}/{tensor['tensor_id']}")
    for stage in _mapping_list(materialized.get("stages")):
        stage_id = stage.get("stage_id")
        if not isinstance(stage_id, str):
            continue
        loop = stage.get("loop_carried")
        stage_repeat = stage.get("stage_repeat")
        if isinstance(loop, Mapping) and isinstance(loop.get("loop_id"), str):
            loop_id = loop["loop_id"]
            refs.add(f"loop/{loop_id}")
            for control in _mapping_list(loop.get("iteration_controls")):
                if isinstance(control.get("port"), str):
                    refs.add(f"control/{loop_id}/{control['port']}")
            if isinstance(stage_repeat, int) and not isinstance(stage_repeat, bool):
                repeat_scopes[f"{stage_id}/{loop_id}"] = _RepeatScope(
                    stage_repeat, f"{stage_id}/"
                )
        for module in _mapping_list(stage.get("modules")):
            module_id = module.get("module_id")
            module_repeat = module.get("module_repeat")
            if (
                not isinstance(module_id, str)
                or not isinstance(module_repeat, int)
                or isinstance(module_repeat, bool)
            ):
                continue
            tail = module.get("required_output_tail")
            tail_repeat = tail.get("repeat", 0) if isinstance(tail, Mapping) else 0
            tail_refs = (
                frozenset(_string_list(tail.get("operator_refs")))
                if isinstance(tail, Mapping)
                else frozenset()
            )
            scope_ref = f"{stage_id}/{module_id}"
            repeat_scopes[scope_ref] = _RepeatScope(
                module_repeat + (tail_repeat if isinstance(tail_repeat, int) else 0),
                f"{scope_ref}/",
                module_repeat if tail_refs else None,
                tail_refs,
            )
    return refs, repeat_scopes


def _validate_repeat_selectors(
    issues: list[Issue],
    value: object,
    scopes: Mapping[str, _RepeatScope],
    target_ref: str | None,
    path: str,
) -> None:
    seen: set[str] = set()
    for index, selector in enumerate(_mapping_list(value)):
        base = f"{path}[{index}]"
        scope_ref = selector.get("scope_ref")
        selection = selector.get("selection")
        indices = selector.get("indices")
        index_values = indices if isinstance(indices, list) else []
        if not isinstance(scope_ref, str) or scope_ref not in scopes:
            issues.append(_issue(
                f"{base}.scope_ref",
                "broken_repeat_scope",
                "repeat scope does not resolve in the declared model graph",
            ))
            continue
        if scope_ref in seen:
            issues.append(_issue(
                f"{base}.scope_ref", "duplicate", "repeat scope may appear only once"
            ))
        seen.add(scope_ref)
        scope = scopes[scope_ref]
        if target_ref is not None and not target_ref.startswith(scope.target_prefix):
            issues.append(_issue(
                f"{base}.scope_ref",
                "repeat_scope_mismatch",
                "repeat scope does not contain the logical target",
            ))
        valid_indices = (
            all(
                isinstance(item, int)
                and not isinstance(item, bool)
                and 0 <= item < scope.repeat
                for item in index_values
            )
            and len(index_values) == len(set(index_values))
        )
        if selection == "all" and index_values:
            valid_indices = False
        if selection == "indices" and not index_values:
            valid_indices = False
        if not valid_indices:
            issues.append(_issue(
                f"{base}.indices",
                "invalid_repeat_selection",
                "repeat indices must be unique, in range, and match selection mode",
            ))
        if target_ref is not None and scope.tail_start is not None:
            relative = target_ref.removeprefix(scope.target_prefix)
            if (
                any(item >= scope.tail_start for item in index_values)
                and relative not in scope.tail_operator_refs
            ):
                issues.append(_issue(
                    f"{base}.indices",
                    "invalid_tail_selection",
                    "selected tail index does not execute the logical operator",
                ))


def _telemetry_issues(
    datasets: Mapping[str, list[Mapping]],
    runs: Mapping[object, Mapping],
    captures: Mapping[object, Mapping],
) -> list[Issue]:
    issues: list[Issue] = []
    fixed_metadata: dict[tuple[str, str], float] = {}
    telemetry_by_capture: dict[object, list[Mapping]] = defaultdict(list)
    gpc_by_capture = {
        metric.get("capture_id"): metric
        for metric in datasets.get("profiler_metrics", [])
        if metric.get("metric_name") == "gpc_cycle_rate_hz"
    }
    for index, telemetry in enumerate(datasets.get("telemetry", [])):
        base = f"$.telemetry[{index}]"
        capture = captures.get(telemetry.get("capture_id"))
        run = runs.get(telemetry.get("run_id"))
        if capture is None:
            issues.append(_broken(f"{base}.capture_id"))
            continue
        if run is None:
            issues.append(_broken(f"{base}.run_id"))
            continue
        _same_capture_context(issues, base, telemetry, capture)
        telemetry_by_capture[telemetry.get("capture_id")].append(telemetry)
        operating = run.get("operating_point")
        if not isinstance(operating, Mapping) or telemetry.get("operating_point_id") != operating.get("operating_point_id"):
            issues.append(_issue(f"{base}.operating_point_id", "telemetry_operating_point", "telemetry operating point must match its run"))
        samples = _mapping_list(telemetry.get("samples"))
        offsets = [sample.get("offset_ns") for sample in samples]
        if offsets != sorted(offsets) or len(offsets) != len(set(offsets)):
            issues.append(_issue(f"{base}.samples", "telemetry_order", "telemetry offsets must be sorted and unique"))
        window = telemetry.get("window")
        if telemetry.get("alignment") == "same_capture_relative_time" and isinstance(window, Mapping):
            duration = window.get("duration_ns")
            if any(not isinstance(offset, int) or not isinstance(duration, int) or offset < 0 or offset > duration for offset in offsets):
                issues.append(_issue(f"{base}.samples", "telemetry_bounds", "aligned telemetry samples must be window-relative and bounded"))
        summary = telemetry.get("summary")
        reason = telemetry.get("missing_reason")
        if (summary is None) == (reason is None) and not samples:
            issues.append(_issue(base, "telemetry_missing_xor", "empty telemetry requires either a summary or missing reason"))
        if telemetry.get("record_kind") == "metadata_snapshot" and telemetry.get("evidence_semantics") != "profiler_target_environment_metadata":
            issues.append(_issue(f"{base}.evidence_semantics", "metadata_semantics", "profiler target metadata is not an observed clock"))
        op_id = telemetry.get("operating_point_id")
        if (
            telemetry.get("record_kind") == "metadata_snapshot"
            and op_id != "unknown"
            and isinstance(summary, Mapping)
            and _is_number(summary.get("value"))
        ):
            key = (str(op_id), str(telemetry.get("metric_name")))
            value = float(summary["value"])
            if key in fixed_metadata and fixed_metadata[key] != value:
                issues.append(_issue(base, "operating_point_metadata_conflict", "differing metadata cannot share a fixed operating point"))
            fixed_metadata[key] = value
    for capture_id, capture in captures.items():
        ncu = capture.get("ncu")
        if not isinstance(ncu, Mapping) or ncu.get("external_clock_control") is None:
            continue
        records = telemetry_by_capture.get(capture_id, [])
        by_name = {record.get("metric_name"): record for record in records}
        valid = (
            len(records) == len(_TASK7_LOCKED_TELEMETRY)
            and set(by_name) == set(_TASK7_LOCKED_TELEMETRY)
        )
        for name, (unit, source) in _TASK7_LOCKED_TELEMETRY.items():
            record = by_name.get(name)
            if not isinstance(record, Mapping):
                valid = False
                continue
            summary = record.get("summary")
            unavailable = record.get("missing_reason") == "unavailable_from_tool"
            numeric = (
                isinstance(summary, Mapping)
                and _is_number(summary.get("value"))
                and summary.get("unit") == unit
                and record.get("missing_reason") is None
                and record.get("record_kind") == "sampled_summary"
            )
            valid = valid and (
                record.get("alignment") == "same_run_unaligned"
                and record.get("window") is None
                and record.get("samples") == []
                and record.get("measurement_source") == source
                and record.get("evidence_semantics") == "observed_samples"
                and (
                    numeric
                    or unavailable
                    and record.get("record_kind") == "sampled_series"
                    and summary is None
                )
            )
            if name == "observed_gpu_frequency":
                gpc_metric = gpc_by_capture.get(capture_id)
                gpc_value = (
                    gpc_metric.get("value")
                    if isinstance(gpc_metric, Mapping) else None
                )
                valid = valid and (
                    unavailable and gpc_value is None
                    or numeric
                    and _is_number(gpc_value)
                    and abs(
                        float(summary["value"]) * 1_000_000
                        - float(gpc_value)
                    ) <= 1.0
                )
        if not valid:
            issues.append(_issue(
                f"$.profiler_captures[{capture_id}].ncu",
                "locked_capture_telemetry",
                "externally locked NCU captures require observed GPU/EMC clocks, junction temperature, VDD_GPU power, and throttle availability with explicit provenance",
            ))
    return issues


def _same_capture_context(
    issues: list[Issue], base: str, record: Mapping, capture: Mapping
) -> None:
    for field in ("run_id", "source_id"):
        if record.get(field) != capture.get(field):
            issues.append(_issue(f"{base}.{field}", "capture_context_mismatch", f"{field} must match the capture"))


def _validate_activity_summary(
    issues: list[Issue],
    summary: Mapping,
    lane_by_id: Mapping[object, Mapping],
    base: str,
) -> None:
    name = summary.get("metric_name")
    refs = summary.get("input_refs")
    if name not in {
        "recorded_gpu_activity_union",
        "recorded_copy_activity_union",
        "target_scheduled_core_time_overlapping_recorded_gpu_activity",
        "target_wall_overlap_with_recorded_gpu_activity",
    } or not isinstance(refs, list):
        return
    lanes = [lane_by_id.get(ref) for ref in refs]
    if any(lane is None for lane in lanes):
        issues.append(_issue(
            f"{base}.input_refs",
            "activity_summary_lanes",
            "recorded-activity summaries require lane references",
        ))
        return
    kinds = {lane.get("kind") for lane in lanes if lane is not None}
    roles = {lane.get("role") for lane in lanes if lane is not None}
    ref_set = set(refs)
    expected_denominator = (
        "predict_window"
        if name in {"recorded_gpu_activity_union", "recorded_copy_activity_union"}
        else "recorded_gpu_activity_union"
    )
    compatible = (
        summary.get("denominator") == expected_denominator
        and summary.get("unit") == "ns"
        and summary.get("derivation_version") in {
            "interval-union-v1", "interval-intersection-v1"
        }
    )
    if name == "recorded_gpu_activity_union":
        expected_refs = {
            lane_id for lane_id, lane in lane_by_id.items()
            if lane.get("kind") in {"gpu_kernel", "gpu_memcpy"}
        }
        compatible = compatible and "gpu_kernel" in kinds and kinds <= {
            "gpu_kernel", "gpu_memcpy"
        } and ref_set == expected_refs and len(refs) == len(ref_set) and summary.get(
            "derivation_version"
        ) == "interval-union-v1"
    elif name == "recorded_copy_activity_union":
        expected_refs = {
            lane_id for lane_id, lane in lane_by_id.items()
            if lane.get("kind") == "gpu_memcpy"
        }
        compatible = (
            compatible and kinds == {"gpu_memcpy"}
            and ref_set == expected_refs and len(refs) == len(ref_set)
            and summary.get("derivation_version") == "interval-union-v1"
        )
    else:
        target_roles = {"target-main", "target-worker", "cuda-event-handler"}
        expected_refs = {
            lane_id for lane_id, lane in lane_by_id.items()
            if lane.get("kind") in {"gpu_kernel", "gpu_memcpy"}
            or lane.get("kind") == "cpu_thread" and lane.get("role") in target_roles
        }
        compatible = (
            compatible
            and "gpu_kernel" in kinds
            and "cpu_thread" in kinds
            and kinds <= {"cpu_thread", "gpu_kernel", "gpu_memcpy"}
            and bool(roles & target_roles)
            and ref_set == expected_refs
            and len(refs) == len(ref_set)
            and all(
                lane.get("kind") != "cpu_thread" or lane.get("role") in target_roles
                for lane in lanes if lane is not None
            )
            and summary.get("derivation_version") == "interval-intersection-v1"
        )
    if not compatible:
        issues.append(_issue(
            base,
            "activity_summary_identity",
            "recorded-activity summary identity and lane inputs are incompatible",
        ))


def _index(
    datasets: Mapping[str, list[Mapping]], dataset: str, key: str
) -> dict[object, Mapping]:
    return {record.get(key): record for record in datasets.get(dataset, [])}


def _mapping_list(value: object) -> list[Mapping]:
    return [item for item in value if isinstance(item, Mapping)] if isinstance(value, list) else []


def _string_list(value: object) -> list[str]:
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def _unique_local_ids(
    issues: list[Issue], records: list[Mapping], key: str, path: str
) -> set[str]:
    values: set[str] = set()
    for index, record in enumerate(records):
        value = record.get(key)
        if isinstance(value, str):
            if value in values:
                issues.append(_issue(f"{path}[{index}].{key}", "duplicate", "timeline-local ID must be unique"))
            values.add(value)
    return values


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _issue(path: str, code: str, message: str) -> Issue:
    return Issue(path, code, message)


def _broken(path: str) -> Issue:
    return Issue(path, "broken_reference", "reference does not resolve")
