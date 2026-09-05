from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Mapping
from dataclasses import dataclass

from extractors.profiler_common import METRIC_REGISTRY
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

    profiler_run_ids = {
        run_id for run_id, run in runs.items()
        if run.get("capture_method") in {"nsys", "ncu"}
    }
    for run_id in sorted(profiler_run_ids, key=str):
        run = runs[run_id]
        for field, dataset_name, catalog in (
            ("source_id", "sources", sources),
            ("model_id", "models", models),
            ("runtime_id", "runtimes", runtimes),
            ("device_id", "devices", devices),
            ("system_id", "systems", systems),
        ):
            if dataset_name in datasets and run.get(field) not in catalog:
                issues.append(_broken(f"$.runs[{run_id}].{field}"))
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
        run = runs.get(capture.get("run_id"))
        if run is None:
            issues.append(_broken(f"{base}.run_id"))
            continue
        tool = capture.get("tool")
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
            if (
                not isinstance(origins, Mapping)
                or origins.get("selection_policy") != "session_command"
                or origins.get("gpu_frequency_not_fixed") != "collection_log_manual_audit"
                or origins.get("warmup_count") != "harness_source_audit"
                or origins.get("backing_store_bytes") != "unavailable"
                or ncu.get("backing_store_bytes") is not None
                or not isinstance(missing, Mapping)
                or missing.get("ncu.backing_store_bytes") != "unavailable"
                or not isinstance(warnings, list)
                or "gpu_frequency_not_fixed" not in warnings
            ):
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
    for index, metric in enumerate(datasets.get("profiler_metrics", [])):
        base = f"$.profiler_metrics[{index}]"
        capture = captures.get(metric.get("capture_id"))
        if capture is None:
            issues.append(_broken(f"{base}.capture_id"))
            continue
        _same_capture_context(issues, base, metric, capture)
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

    issues.extend(_link_issues(datasets, runs, captures, observations, signatures))
    issues.extend(_telemetry_issues(datasets, runs, captures))
    return issues


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
        if op_id != "unknown" and isinstance(summary, Mapping) and _is_number(summary.get("value")):
            key = (str(op_id), str(telemetry.get("metric_name")))
            value = float(summary["value"])
            if key in fixed_metadata and fixed_metadata[key] != value:
                issues.append(_issue(base, "operating_point_metadata_conflict", "differing metadata cannot share a fixed operating point"))
            fixed_metadata[key] = value
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
