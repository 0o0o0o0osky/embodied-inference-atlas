"""Select a small analysis corpus using complete local batches, without writing it."""
from __future__ import annotations

import json
import copy
import math
import statistics
from collections import defaultdict


def _stats(values):
    if not values or any(not math.isfinite(v) or v < 0 for v in values):
        return None
    mean = statistics.mean(values)
    cv = statistics.stdev(values) / mean if len(values) > 1 and mean > 0 else None
    return {"median_ns": statistics.median(values), "cv": cv}


def _launch_key(event):
    launch = event.get("launch")
    if launch is None:
        return "launch-unrecorded"
    return json.dumps([launch.get(name) for name in ("grid", "block", "registers_per_thread", "static_shared_memory_bytes", "dynamic_shared_memory_bytes")], separators=(",", ":"))


def _api_union(timeline):
    window = timeline["window"]
    start, end = window["start_ns"], window["start_ns"] + window["duration_ns"]
    events = [e for e in timeline["events"] if e["event_kind"] == "cuda_api" and e.get("evidence_semantics") == "exact_interval"]
    if not events:
        return None
    intervals = sorted((max(start, e["start_ns"]), min(end, e["start_ns"] + e["duration_ns"])) for e in events)
    union, previous = 0, start
    for low, high in intervals:
        union += max(0, high - max(low, previous))
        previous = max(previous, high)
    return union


def _batch_summary(captures, timelines, signatures):
    ordered = sorted(captures, key=lambda c: c["analysis_sample"]["sample_index"])
    samples = []
    for capture in ordered:
        timeline = timelines.get(capture["capture_id"])
        if timeline is None:
            return None
        kernels = defaultdict(lambda: [0, 0])
        for event in timeline["events"]:
            signature = event.get("kernel_signature_id")
            if event["event_kind"] == "kernel" and signature:
                value = kernels[(signature, _launch_key(event))]
                value[0] += event["duration_ns"]
                value[1] += event["count"]
        samples.append((capture, timeline, kernels))
    complete = len(samples) == 10 and {c["analysis_sample"]["sample_index"] for c in ordered} == set(range(10)) and all(
        c["analysis_sample"]["warmup_iterations"] == 5 and c["analysis_sample"]["measured_iterations"] == 10 and c["coverage"]["is_complete_for_population"] for c in ordered)
    if not complete:
        return None
    wall = _stats([t["window"]["duration_ns"] for _, t, _ in samples])
    candidates = []
    for key in set().union(*(set(kernels) for _, _, kernels in samples)):
        values = [kernels.get(key) for _, _, kernels in samples]
        summary = _stats([v[0] for v in values]) if all(v is not None for v in values) else None
        signature = signatures.get(key[0], {})
        family = signature.get("function_family")
        candidates.append({"id": f"{key[0]}|{key[1]}", "key": key, "label": signature.get("label_sanitized", key[0]),
            "gemm": family == "gemm", "non_gemm": family not in (None, "gemm", "other") and signature.get("classification_confidence") != "unknown",
            "summary": summary, "counts_match": all(v is not None and v[1] == values[0][1] for v in values),
            "calls": values[0][1] if values[0] is not None else None,
            "rank": statistics.median(v[0] for v in values if v is not None)})
    candidates.sort(key=lambda item: (-item["rank"], item["id"]))
    checked = [c for c in candidates if c["gemm"]][:2] + [c for c in candidates if c["non_gemm"]][:1]
    stable = lambda summary: summary is not None and summary["cv"] is not None and summary["cv"] <= .05
    if not stable(wall) or not checked or any(not h["counts_match"] or not stable(h["summary"]) for h in checked):
        return None
    near = lambda value, median: median > 0 and abs(value - median) / median <= .05
    eligible = [(c, t) for c, t, kernels in samples if near(t["window"]["duration_ns"], wall["median_ns"])
                and all(near(kernels[h["key"]][0], h["summary"]["median_ns"]) for h in checked)]
    if not eligible:
        return None
    selected, _ = min(eligible, key=lambda pair: (abs(pair[1]["window"]["duration_ns"] - wall["median_ns"]), pair[0]["analysis_sample"]["sample_index"]))
    def median_metric(name):
        values = [next((s["value"] for s in t["summaries"] if s["metric_name"] == name), None) for _, t, _ in samples]
        return statistics.median(values) if all(v is not None for v in values) else None
    apis = [_api_union(t) for _, t, _ in samples]
    meta = ordered[0]["analysis_sample"]
    return {"batch_id": meta["batch_id"], "input_case_id": meta["input_case_id"], "sample_count": 10, "warmup_iterations": 5,
        "status": "stable", "representative_capture_id": selected["capture_id"], "wall": wall,
        "hotspots": [{name: value for name, value in h.items() if name in ("id", "label", "calls", "counts_match")} | h["summary"] for h in checked],
        "system_medians": {"cpu_core_time_ns": median_metric("target_scheduled_core_time_over_full_window"),
            "gpu_activity_union_ns": median_metric("recorded_gpu_activity_union"), "api_wall_union_ns": statistics.median(apis) if all(v is not None for v in apis) else None}}


def select_representative_data(datasets):
    """Return selected records and a review report; canonical input is untouched."""
    runs = {r["run_id"]: r for r in datasets["runs"]}
    timelines = {t["capture_id"]: t for t in datasets["timelines"]}
    signatures = {s["kernel_signature_id"]: s for s in datasets["kernel_signatures"]}
    groups = defaultdict(list)
    for capture in datasets["profiler_captures"]:
        if capture["tool"] != "nsys" or capture["capture_id"] not in timelines:
            continue
        run = runs[capture["run_id"]]
        # Do not mix measurements: this only chooses which existing acquisition to
        # retain for the same model/stack/actual precision/full input contract.
        key = json.dumps([run[k] for k in ("model_id", "runtime_id", "device_id", "model_artifact_id", "precision", "workload")], sort_keys=True)
        groups[key].append(capture)
    kept = {}
    for captures in groups.values():
        batches = defaultdict(list)
        for capture in captures:
            if capture.get("analysis_sample") and capture.get("nsys", {}).get("report_mode") == "node":
                meta = capture["analysis_sample"]
                batches[(meta["batch_id"], meta["input_case_id"])].append(capture)
        summaries = []
        for batch in batches.values():
            summary = _batch_summary(batch, timelines, signatures)
            if summary:
                scheduler = all(c.get("nsys", {}).get("scheduler_trace_present") for c in batch)
                summaries.append((not scheduler, summary["batch_id"], summary))
        if summaries:
            summary = min(summaries, key=lambda item: item[:2])[2]
            capture = next(c for c in captures if c["capture_id"] == summary["representative_capture_id"])
            kept[capture["capture_id"]] = {**capture, "analysis_summary": summary}
        else:
            nodes = [c for c in captures if c.get("nsys", {}).get("report_mode") == "node"]
            choices = nodes or [c for c in captures if c.get("nsys", {}).get("report_mode") == "graph"]
            if choices:
                capture = min(choices, key=lambda c: (not c["coverage"]["is_complete_for_population"], c["capture_id"]))
                kept[capture["capture_id"]] = capture
    kept_signatures = {e["kernel_signature_id"] for cid in kept for e in timelines[cid]["events"] if e.get("kernel_signature_id")}
    for capture in datasets["profiler_captures"]:
        if capture["tool"] == "ncu" and any(o["capture_id"] == capture["capture_id"] and o["kernel_signature_id"] in kept_signatures for o in datasets["kernel_observations"]):
            kept[capture["capture_id"]] = capture
    result = dict(datasets)
    result["profiler_captures"] = sorted(kept.values(), key=lambda c:c["capture_id"])
    for name in ("timelines", "kernel_observations", "profiler_metrics", "telemetry"):
        result[name] = [r for r in datasets[name] if r.get("capture_id") in kept]
    observation_ids = {o["observation_id"] for o in result["kernel_observations"]}
    result["operator_kernel_links"] = [r for r in datasets["operator_kernel_links"] if r["observation_id"] in observation_ids]
    result["roofline_bases"] = [b for b in datasets["roofline_bases"] if not b.get("capture_id") or b["capture_id"] in kept]
    basis_ids = {b["basis_id"] for b in result["roofline_bases"]}
    result["roofline_points"] = [p for p in datasets["roofline_points"] if p["basis_id"] in basis_ids]
    scenarios = {s["scenario_id"]: s for s in datasets["roofline_scenarios"]}
    optional_bases = {b["basis_id"] for b in result["roofline_bases"]
        if (s := scenarios[b["scenario_id"]]).get("origin") == "default_precomputed"
        and s.get("modeling_scope") == "ideal_analytical"
        and s["precision_path"]["precision_path_id"] != "bf16_dense"}
    result["roofline_points"] = [p for p in result["roofline_points"] if p["basis_id"] not in optional_bases]
    # Keep every run referenced anywhere in the retained corpus, including
    # realization evidence and provenance. Unreferenced profiler-only runs go.
    excluded_runs = {c["run_id"] for c in datasets["profiler_captures"] if c["capture_id"] not in kept}
    excluded_configurations = {runs[rid]["configuration_id"] for rid in excluded_runs}
    excluded_configurations -= {r["configuration_id"] for rid, r in runs.items() if rid not in excluded_runs}
    result["runtime_realizations"] = copy.deepcopy(datasets["runtime_realizations"])
    for realization in result["runtime_realizations"]:
        realization["configuration_ids"] = [cid for cid in realization["configuration_ids"] if cid not in excluded_configurations]
        for evidence in realization.get("evidence", []):
            evidence["run_ids"] = [rid for rid in evidence.get("run_ids", []) if rid not in excluded_runs]
    run_ids = set(runs)
    referenced = set()
    def visit(value):
        if isinstance(value, dict):
            for child in value.values(): visit(child)
        elif isinstance(value, list):
            for child in value: visit(child)
        elif isinstance(value, str) and value in run_ids:
            referenced.add(value)
    for name, records in result.items():
        if name != "runs": visit(records)
    result["runs"] = [r for r in datasets["runs"] if r["run_id"] in referenced]
    return result, {"kept_capture_ids": sorted(kept), "removed_capture_ids": sorted(c["capture_id"] for c in datasets["profiler_captures"] if c["capture_id"] not in kept)}
