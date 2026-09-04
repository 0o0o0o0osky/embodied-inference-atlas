from __future__ import annotations

import html
import json
import os
import re
import shutil
import tempfile
from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from string import Template

from tools.lib.contracts import Issue, load_manifest
from tools.lib.comparison import assign_group_ids, ratio_eligibility
from tools.lib.jsonio import load_json
from tools.lib.model_graph import materialize_model_graph
from tools.lib.privacy import scan_site_tree
from tools.validate import format_issue, validate_repository


@dataclass(frozen=True)
class BuildResult:
    pages: tuple[str, ...]
    checked: bool


class BuildError(RuntimeError):
    """Raised when canonical data or a generated release tree is unsafe."""


def json_for_script(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).replace("</", "<\\/")


def render_template(
    template: str,
    *,
    title: str,
    root_prefix: str,
    content: str,
    page_data: object,
    page_script: str,
) -> str:
    return Template(template).substitute(
        title=html.escape(title),
        root_prefix=root_prefix,
        content=content,
        page_data=json_for_script(page_data),
        page_script=page_script,
    )


def build_site(repo_root: Path, output_dir: Path, check: bool = False) -> BuildResult:
    """Build the offline shell from validated canonical documents only."""
    repo_root = repo_root.resolve()
    output_dir = output_dir.resolve()
    datasets = load_validated_datasets(repo_root / "data", repo_root)
    pages = render_foundation_pages(datasets, repo_root / "web")
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    candidate = Path(tempfile.mkdtemp(prefix="atlas-site-", dir=output_dir.parent))
    try:
        write_pages(candidate, pages)
        copy_static_assets(repo_root, candidate)
        issues = scan_site_tree(candidate)
        if issues:
            raise BuildError(format_issues(issues))
        if not check:
            replace_tree(candidate, output_dir)
        return BuildResult(pages=tuple(sorted(pages)), checked=check)
    finally:
        if candidate.exists():
            shutil.rmtree(candidate)


def load_validated_datasets(
    data_root: Path, repo_root: Path
) -> dict[str, list[dict[str, object]]]:
    """Load manifest datasets after the repository's closed-boundary validation."""
    issues = validate_repository(repo_root)
    if issues:
        raise BuildError(format_issues(issues))

    manifest = load_manifest(repo_root)
    entries = manifest.get("datasets")
    if not isinstance(entries, Mapping):
        raise BuildError("schema/manifest.json: invalid_manifest: datasets are not configured")

    datasets: dict[str, list[dict[str, object]]] = {}
    for name in sorted(entries):
        entry = entries[name]
        if not isinstance(entry, Mapping):
            raise BuildError(f"schema/manifest.json: invalid_manifest: {name} is invalid")
        primary_key = entry.get("primary_key")
        if not isinstance(primary_key, str):
            raise BuildError(f"schema/manifest.json: invalid_manifest: {name} has no primary key")
        records: list[dict[str, object]] = []
        for path in _canonical_document_paths(data_root, entry):
            document = load_json(path)
            values = document.get("records")
            if not isinstance(values, list):
                raise BuildError(f"{path.name}: invalid_document: records are not configured")
            records.extend(dict(record) for record in values if isinstance(record, Mapping))
        datasets[name] = sorted(records, key=lambda record: str(record[primary_key]))
    return datasets


def render_foundation_pages(
    datasets: Mapping[str, list[dict[str, object]]], web_root: Path
) -> dict[str, str]:
    template = (web_root / "templates" / "base.html").read_text(encoding="utf-8")
    view = _build_view_models(datasets)
    pages = {
        "index.html": render_template(
            template,
            title="Embodied Inference Atlas",
            root_prefix="",
            content=_page_content(
                "Embodied Inference Atlas",
                "Review model structure first, then use coverage to inspect available runtime and evidence records.",
                '<section class="panel"><h2>Models</h2><p class="summary-line">Choose a model workspace; coverage remains available below.</p><div id="model-cards"></div></section>' +
                _filters_content(view["coverage_filters"]) +
                '<section class="panel"><h2>Coverage matrix</h2><div id="coverage"></div></section>' +
                '<section class="panel"><h2>Profiler coverage</h2><div id="profiler-coverage"></div></section>',
                "",
            ),
            page_data={
                "coverage": view["coverage"],
                "filters": view["coverage_filters"],
                "models": view["models"],
                "runtimes": view["runtimes"],
                "profiler_coverage": view["profiler_coverage"],
            },
            page_script='<script src="assets/js/index.js" defer></script>',
        ),
        "performance.html": render_template(
            template,
            title="Performance — Embodied Inference Atlas",
            root_prefix="",
            content=_page_content(
                "Performance comparisons",
                "Latency comparisons are admitted only through the declared single-axis policy.",
                '<section class="panel"><h2>Evidence classes</h2><div id="evidence-classes"></div></section>'
                '<section class="panel"><h2>End-to-end latency by precision</h2><div id="e2e-charts" class="chart-grid"></div></section>'
                '<section class="panel"><h2>End-to-end latency by runtime</h2><div id="runtime-charts" class="chart-grid"></div></section>'
                '<section class="panel"><h2>Comparison labels</h2><div id="comparison-table"></div></section>'
                '<section class="panel"><h2>End-to-end provenance</h2><p class="notice">Every E2E record remains listed even when no comparison-safe multi-record group exists.</p><div id="e2e-provenance-table"></div></section>'
                '<section class="panel"><h2>Stage summaries</h2><p class="notice">independent summary statistics are not additive</p><div id="stage-charts" class="chart-grid"></div><div id="stage-table"></div></section>'
                '<section class="panel"><h2>Analytical gap</h2><div id="gap-charts" class="chart-grid"></div></section>'
                '<section class="panel"><h2>Profiler coverage</h2><div id="profiler-coverage"></div></section>',
                "",
            ),
            page_data=view["performance"],
            page_script='<script src="assets/js/performance.js" defer></script>',
        ),
        "operators.html": render_template(
            template,
            title="Operators — Embodied Inference Atlas",
            root_prefix="",
            content=_page_content(
                "Operator components",
                "Analytical component workload and traffic, kept separate from kernel evidence.",
                '<section class="panel"><div id="operator-summary"></div><div id="operator-table"></div></section>',
                "",
            ),
            page_data={"operators": view["operators"]},
            page_script='<script src="assets/js/operators.js" defer></script>',
        ),
        "rooflines.html": render_template(
            template,
            title="Rooflines — Embodied Inference Atlas",
            root_prefix="",
            content=_page_content(
                "Precision-specific rooflines",
                "Each series uses one device, memory level, and actual operator precision ceiling.",
                '<section class="panel"><h2>Roofline series</h2><div id="roofline-charts" class="chart-grid"></div></section>'
                '<section class="panel"><h2>Analytical provenance</h2><div id="roofline-provenance-table"></div></section>'
                '<section class="panel"><h2>Precision inventory</h2><div id="precision-table"></div></section>',
                "",
            ),
            page_data=view["rooflines"],
            page_script='<script src="assets/js/rooflines.js" defer></script>',
        ),
    }
    for model in view["models"]:
        model_id = str(model["model_id"])
        model_view = view["model_pages"][model_id]
        has_model_graph = "model_graph" in model_view
        if has_model_graph:
            lede = "Inspect Pi0's logical stages, folded blocks, reusable components, and atomic operators."
            body = _logical_workspace_content()
            page_script = '<script src="../assets/js/workspace.js" defer></script>'
        else:
            lede = "Architecture flow, applicable workloads, and comparison-safe latency curves."
            body = (
                '<section class="panel"><h2>Module flow</h2><div id="architecture-chart" class="chart chart-tall"></div><div id="architecture-table"></div></section>'
                '<section class="panel"><h2>Workloads and latency</h2><div id="workload-table"></div></section>'
                '<section class="panel"><h2>Latency curves</h2><div id="latency-curves" class="chart-grid"></div></section>'
            )
            page_script = '<script src="../assets/js/model.js" defer></script>'
        pages[f"models/{model_id}.html"] = render_template(
            template,
            title=f"{model['display_name']} — Embodied Inference Atlas",
            root_prefix="../",
            content=_page_content(
                str(model["display_name"]),
                lede,
                body,
                "../",
            ),
            page_data=model_view,
            page_script=page_script,
        )
    return pages


def _build_view_models(
    datasets: Mapping[str, list[dict[str, object]]],
) -> dict[str, object]:
    models = datasets.get("models", [])
    runtimes = datasets.get("runtimes", [])
    systems = datasets.get("systems", [])
    sources = datasets.get("sources", [])
    runs = datasets.get("runs", [])
    end_to_end = datasets.get("end_to_end", [])
    stages = datasets.get("stages", [])
    operators = datasets.get("operators", [])
    rooflines = datasets.get("rooflines", [])
    model_graph_by_id = _by_id(datasets.get("model_graphs", []), "model_id")

    model_by_id = _by_id(models, "model_id")
    runtime_by_id = _by_id(runtimes, "runtime_id")
    system_by_id = _by_id(systems, "system_id")
    source_by_id = _by_id(sources, "source_id")
    run_by_id = _by_id(runs, "run_id")
    e2e_by_run = {str(row["run_id"]): row for row in end_to_end}

    joined_runs = [
        _joined_run(
            run,
            e2e_by_run.get(str(run["run_id"])),
            model_by_id,
            runtime_by_id,
            system_by_id,
        )
        for run in runs
    ]
    coverage = _coverage_rows(
        models, runtimes, systems, source_by_id, joined_runs
    )
    comparison_groups = {
        kind: _comparison_charts(runs, joined_runs, kind)
        for kind in ("precision", "runtime", "measured_vs_bound")
    }
    comparisons = []
    for kind in ("precision", "runtime", "measured_vs_bound"):
        comparisons.extend(_comparison_rows(runs, joined_runs, kind))

    stage_views = [
        _joined_stage(stage, run_by_id, model_by_id, runtime_by_id)
        for stage in stages
    ]
    stage_charts = _stage_charts(runs, stage_views)
    operator_views = [
        _joined_operator(operator, run_by_id, model_by_id, runtime_by_id)
        for operator in operators
    ]
    roofline_views = _joined_rooflines(
        rooflines, operators, run_by_id, model_by_id, runtime_by_id
    )
    roofline_precision_ids = {
        str(row["precision_id"]) for row in roofline_views
    }
    precision_inventory = []
    for precision_id in sorted(
        {str(row["precision_id"]) for row in joined_runs}
    ):
        sample = next(
            row for row in joined_runs if row["precision_id"] == precision_id
        )
        precision_inventory.append(
            {
                "precision_id": precision_id,
                "label": _precision_label(precision_id),
                "weight_dtype": sample["weight_dtype"],
                "activation_dtype": sample["activation_dtype"],
                "execution_dtype": sample["execution_dtype"],
                "quant_scheme": sample["quant_scheme"],
                "granularity": sample["precision_granularity"],
                "e2e_records": sum(
                    row["precision_id"] == precision_id for row in joined_runs
                ),
                "has_operator_ceiling": precision_id in roofline_precision_ids,
            }
        )

    profiler_coverage = {
        "nsys": bool(datasets.get("timelines")),
        "ncu": bool(datasets.get("kernels")),
    }
    evidence_classes = []
    for evidence in ("measured_local", "analytical", "reported_external"):
        evidence_classes.append(
            {
                "evidence": evidence,
                "numeric_records": sum(
                    row.get("evidence") == evidence for row in joined_runs
                ),
                "status_sources": sum(
                    row.get("evidence") == evidence for row in sources
                ),
                "numeric_scope": evidence != "reported_external",
            }
        )

    architectures = {
        str(row["model_id"]): _architecture_view(row)
        for row in datasets.get("architectures", [])
    }
    model_pages = {}
    for model in models:
        model_id = str(model["model_id"])
        model_runs = [row for row in joined_runs if row["model_id"] == model_id]
        model_page = {
            "model": model,
            "architecture": architectures.get(
                model_id,
                {"architecture_id": model.get("architecture_id"), "nodes": [], "edges": []},
            ),
            "measurements": model_runs,
            "latency_curves": _latency_curves(runs, joined_runs, model_id),
        }
        model_graph = model_graph_by_id.get(model_id)
        if model_graph is not None:
            model_page["model_graph"] = model_graph
            model_page["default_materialization"] = materialize_model_graph(model_graph)
        model_pages[model_id] = model_page

    model_cards = [
        {
            **model,
            "detail_kind": (
                "logical_workspace"
                if str(model["model_id"]) in model_graph_by_id
                else "legacy_summary"
            ),
        }
        for model in models
    ]

    return {
        "models": model_cards,
        "runtimes": runtimes,
        "coverage": coverage,
        "coverage_filters": _coverage_filters(coverage),
        "profiler_coverage": profiler_coverage,
        "model_pages": model_pages,
        "performance": {
            "evidence_classes": evidence_classes,
            "e2e_charts": comparison_groups["precision"],
            "runtime_charts": comparison_groups["runtime"],
            "comparisons": comparisons,
            "e2e_records": joined_runs,
            "stages": stage_views,
            "stage_charts": stage_charts,
            "analytical_gap_charts": comparison_groups["measured_vs_bound"],
            "profiler_coverage": profiler_coverage,
        },
        "operators": operator_views,
        "rooflines": {
            "rooflines": roofline_views,
            "precision_inventory": precision_inventory,
        },
    }


def _by_id(
    rows: list[dict[str, object]], key: str
) -> dict[str, dict[str, object]]:
    return {str(row[key]): row for row in rows}


def _joined_run(
    run: dict[str, object],
    measurement: dict[str, object] | None,
    model_by_id: Mapping[str, dict[str, object]],
    runtime_by_id: Mapping[str, dict[str, object]],
    system_by_id: Mapping[str, dict[str, object]],
) -> dict[str, object]:
    workload = run.get("workload")
    workload = workload if isinstance(workload, Mapping) else {}
    vla = workload.get("vla")
    vla = vla if isinstance(vla, Mapping) else {}
    precision = run.get("precision")
    precision = precision if isinstance(precision, Mapping) else {}
    timing = run.get("timing")
    timing = timing if isinstance(timing, Mapping) else {}
    operating_point = run.get("operating_point")
    operating_point = operating_point if isinstance(operating_point, Mapping) else {}
    correctness = run.get("correctness")
    correctness = correctness if isinstance(correctness, Mapping) else {}
    model = model_by_id.get(str(run.get("model_id")), {})
    runtime = runtime_by_id.get(str(run.get("runtime_id")), {})
    system = system_by_id.get(str(run.get("system_id")), {})
    statistics = _statistics(measurement)
    selected_latency_ms, selected_statistic = _select_latency(
        run.get("evidence"), statistics
    )
    return {
        "run_id": run.get("run_id"),
        "model_id": run.get("model_id"),
        "model_name": model.get("display_name", run.get("model_id")),
        "model_type": model.get("model_type"),
        "runtime_id": run.get("runtime_id"),
        "runtime_name": runtime.get("display_name", run.get("runtime_id")),
        "system_id": run.get("system_id"),
        "system_label": system.get("system_id", "analytical / no physical system"),
        "device_id": run.get("device_id"),
        "evidence": run.get("evidence"),
        "precision_id": precision.get("precision_id"),
        "precision_label": _precision_label(precision.get("precision_id")),
        "weight_dtype": precision.get("weight_dtype"),
        "activation_dtype": precision.get("activation_dtype"),
        "execution_dtype": precision.get("execution_dtype"),
        "quant_scheme": precision.get("quant_scheme"),
        "precision_granularity": precision.get("granularity"),
        "camera_views": vla.get("camera_views"),
        "executed_prompt_tokens": vla.get("executed_prompt_tokens"),
        "semantic_prompt_tokens": vla.get("semantic_prompt_tokens"),
        "denoise_steps": vla.get("denoise_steps"),
        "action_chunk": vla.get("action_chunk"),
        "action_dimension": vla.get("action_dimension"),
        "image_height": vla.get("image_height"),
        "image_width": vla.get("image_width"),
        "power_mode": operating_point.get("power_mode"),
        "operating_point_id": operating_point.get("operating_point_id"),
        "correctness": correctness.get("status"),
        "timing_boundary_id": (
            measurement.get("timing_boundary_id") if measurement else None
        ),
        "sample_count": measurement.get("sample_count") if measurement else None,
        "warmup_iterations": timing.get("warmup_iterations"),
        "percentile_method": (
            measurement.get("percentile_method") if measurement else None
        ),
        "measurement_method": (
            measurement.get("measurement_method") if measurement else None
        ),
        "statistics": statistics,
        "selected_latency_ms": selected_latency_ms,
        "selected_statistic": selected_statistic,
        "mean_ms": statistics.get("mean"),
        "p50_ms": statistics.get("p50"),
        "p95_ms": statistics.get("p95"),
    }


def _statistics(measurement: dict[str, object] | None) -> dict[str, object]:
    if not measurement:
        return {}
    result = {}
    values = measurement.get("statistics")
    if isinstance(values, list):
        for value in values:
            if isinstance(value, Mapping) and isinstance(value.get("statistic"), str):
                result[str(value["statistic"])] = value.get("value")
    return result


def _select_latency(
    evidence: object, statistics: Mapping[str, object]
) -> tuple[object, str | None]:
    candidates = (
        ("analytical_estimate",)
        if evidence == "analytical"
        else ("mean", "p50")
    )
    for statistic in candidates:
        value = statistics.get(statistic)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return value, statistic
    return None, None


def _precision_label(precision_id: object) -> object:
    labels = {
        "mixed-fp8-e4m3-fp16": (
            "selective FP8-E4M3 GEMMs; FP16 attention/residual/buffers"
        ),
        "q8_0-weight-only": "Q8_0 weight-only",
    }
    return labels.get(precision_id, precision_id)


def _coverage_rows(
    models: list[dict[str, object]],
    runtimes: list[dict[str, object]],
    systems: list[dict[str, object]],
    source_by_id: Mapping[str, dict[str, object]],
    joined_runs: list[dict[str, object]],
) -> list[dict[str, object]]:
    rows = []
    measured_pairs = set()
    for run in joined_runs:
        state = {
            "measured_local": "measured",
            "analytical": "analytical",
            "reported_external": "reported",
        }.get(str(run.get("evidence")), "unknown")
        row = dict(run)
        row.update({"state": state, "status_only": False, "reason_code": None})
        rows.append(row)
        measured_pairs.add((str(run.get("model_id")), str(run.get("runtime_id"))))

    supported_pairs = set()
    for runtime in runtimes:
        runtime_id = str(runtime["runtime_id"])
        external_sources = [
            source_by_id[str(source_id)]
            for source_id in runtime.get("source_ids", [])
            if str(source_id) in source_by_id
            and source_by_id[str(source_id)].get("evidence") == "reported_external"
        ]
        support_records = runtime.get("model_support")
        if not isinstance(support_records, list):
            continue
        for support in support_records:
            if not isinstance(support, Mapping):
                continue
            model_id = str(support.get("model_id"))
            supported_pairs.add((model_id, runtime_id))
            model = next(row for row in models if row["model_id"] == model_id)
            if (
                (model_id, runtime_id) not in measured_pairs
                or support.get("has_canonical_measurement") is not True
            ):
                rows.append(
                    _status_coverage_row(model, runtime, support, str(support.get("status")))
                )
            for source in external_sources:
                report_row = _status_coverage_row(model, runtime, support, "reported")
                report_row.update(
                    {
                        "evidence": "reported_external",
                        "source_id": source.get("source_id"),
                        "source_title": source.get("title"),
                        "reason_code": "runtime_source_status_metadata",
                    }
                )
                rows.append(report_row)

    for model in models:
        for runtime in runtimes:
            pair = (str(model["model_id"]), str(runtime["runtime_id"]))
            if pair in supported_pairs or pair in measured_pairs:
                continue
            for system in systems or [{"system_id": None}]:
                rows.append(
                    {
                        "model_id": model["model_id"],
                        "model_name": model["display_name"],
                        "model_type": model["model_type"],
                        "runtime_id": runtime["runtime_id"],
                        "runtime_name": runtime["display_name"],
                        "system_id": system.get("system_id"),
                        "system_label": system.get("system_id", "not recorded"),
                        "evidence": None,
                        "precision_id": None,
                        "camera_views": None,
                        "executed_prompt_tokens": None,
                        "power_mode": None,
                        "state": "unknown",
                        "status_only": True,
                        "reason_code": "no_support_or_measurement_record",
                    }
                )
    return sorted(
        rows,
        key=lambda row: (
            str(row.get("model_id")),
            str(row.get("runtime_id")),
            str(row.get("system_id")),
            str(row.get("state")),
            str(row.get("run_id")),
        ),
    )


def _status_coverage_row(
    model: Mapping[str, object],
    runtime: Mapping[str, object],
    support: Mapping[str, object],
    state: str,
) -> dict[str, object]:
    return {
        "model_id": model.get("model_id"),
        "model_name": model.get("display_name"),
        "model_type": model.get("model_type"),
        "runtime_id": runtime.get("runtime_id"),
        "runtime_name": runtime.get("display_name"),
        "system_id": None,
        "system_label": "not recorded",
        "evidence": support.get("evidence"),
        "precision_id": None,
        "camera_views": None,
        "executed_prompt_tokens": None,
        "power_mode": None,
        "state": state,
        "status_only": True,
        "reason_code": support.get("reason_code"),
    }


def _coverage_filters(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    fields = (
        ("model_type", "Model type"),
        ("model_id", "Model"),
        ("runtime_id", "Runtime"),
        ("system_id", "System"),
        ("evidence", "Evidence"),
        ("precision_id", "Precision"),
        ("camera_views", "Views"),
        ("executed_prompt_tokens", "Prompt tokens"),
        ("power_mode", "Power mode"),
    )
    return [
        {
            "key": key,
            "label": label,
            "values": sorted(
                {str(row[key]) for row in rows if row.get(key) is not None}
            ),
        }
        for key, label in fields
    ]


def _comparison_charts(
    runs: list[dict[str, object]],
    joined_runs: list[dict[str, object]],
    kind: str,
    varying_field: str | None = None,
) -> list[dict[str, object]]:
    group_ids = assign_group_ids(runs, kind, varying_field)
    groups: dict[str, list[dict[str, object]]] = defaultdict(list)
    for row in joined_runs:
        if row.get("selected_latency_ms") is not None:
            groups[group_ids[str(row["run_id"])]].append(row)
    charts = []
    for group_id, records in sorted(groups.items()):
        evidence = {str(row["evidence"]) for row in records}
        if kind == "measured_vs_bound":
            if not {"measured_local", "analytical"}.issubset(evidence):
                continue
        elif len(records) < 2:
            continue
        charts.append(
            {
                "comparison_kind": kind,
                "group_id": group_id,
                "records": sorted(records, key=lambda row: str(row["run_id"])),
            }
        )
    return charts


def _comparison_rows(
    runs: list[dict[str, object]],
    joined_runs: list[dict[str, object]],
    kind: str,
) -> list[dict[str, object]]:
    run_by_id = _by_id(runs, "run_id")
    charts = _comparison_charts(runs, joined_runs, kind)
    rows = []
    for chart in charts:
        records = chart["records"]
        if not isinstance(records, list) or not records:
            continue
        baseline = records[0]
        for candidate in records[1:]:
            left = run_by_id[str(baseline["run_id"])]
            right = run_by_id[str(candidate["run_id"])]
            ratio_kind = ratio_eligibility(left, right)
            correctness = _pair_correctness(left, right)
            row = {
                "comparison_kind": kind,
                "group_id": chart["group_id"],
                "baseline_run_id": baseline["run_id"],
                "candidate_run_id": candidate["run_id"],
                "correctness": correctness,
                "ratio_kind": ratio_kind,
                "baseline_statistic": baseline.get("selected_statistic"),
                "candidate_statistic": candidate.get("selected_statistic"),
                "baseline_latency_ms": baseline.get("selected_latency_ms"),
                "candidate_latency_ms": candidate.get("selected_latency_ms"),
            }
            if ratio_kind == "blocked_known_unequal":
                row["not_comparable_reason"] = "known unequal outputs"
            elif ratio_kind == "blocked_unknown_invariant":
                row["not_comparable_reason"] = (
                    "operating point invariant unknown; fixed power/clock is unproven"
                )
            else:
                baseline_ms = baseline.get("selected_latency_ms")
                candidate_ms = candidate.get("selected_latency_ms")
                if isinstance(baseline_ms, (int, float)) and isinstance(candidate_ms, (int, float)) and candidate_ms:
                    row["ratio"] = baseline_ms / candidate_ms
            rows.append(row)
    return rows


def _pair_correctness(
    left: Mapping[str, object], right: Mapping[str, object]
) -> str:
    statuses = []
    for run in (left, right):
        value = run.get("correctness")
        statuses.append(value.get("status") if isinstance(value, Mapping) else None)
    if "failed" in statuses:
        return "failed"
    if statuses == ["passed", "passed"]:
        return "passed"
    return "not_assessed"


def _architecture_view(row: dict[str, object]) -> dict[str, object]:
    result = dict(row)
    nodes = row.get("nodes")
    result["nodes"] = [
        {**dict(node), "dom_id": _slug(str(node.get("label", node.get("node_id"))))}
        for node in nodes if isinstance(node, Mapping)
    ] if isinstance(nodes, list) else []
    return result


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def _latency_curves(
    runs: list[dict[str, object]],
    joined_runs: list[dict[str, object]],
    model_id: str,
) -> list[dict[str, object]]:
    specs = []
    dimensions = (
        ("camera_views", "workload_scale", "workload.vla.camera_views", "Camera views"),
        ("executed_prompt_tokens", "workload_scale", "workload.vla.executed_prompt_tokens", "Executed prompt tokens"),
        ("precision_id", "precision", None, "Precision"),
        ("denoise_steps", "workload_scale", "workload.vla.denoise_steps", "Denoise steps"),
    )
    for axis, kind, varying_field, label in dimensions:
        try:
            charts = _comparison_charts(runs, joined_runs, kind, varying_field)
        except ValueError:
            charts = []
        groups = []
        for chart in charts:
            records = [
                row for row in chart["records"]
                if row["model_id"] == model_id and row.get(axis) is not None
            ]
            if len({str(row.get(axis)) for row in records}) > 1:
                groups.append({**chart, "records": records})
        if groups:
            specs.append(
                {
                    "axis": axis,
                    "axis_label": label,
                    "comparison_kind": kind,
                    "varying_field": varying_field,
                    "groups": groups,
                }
            )
    return specs


def _joined_stage(
    stage: dict[str, object],
    run_by_id: Mapping[str, dict[str, object]],
    model_by_id: Mapping[str, dict[str, object]],
    runtime_by_id: Mapping[str, dict[str, object]],
) -> dict[str, object]:
    run = run_by_id[str(stage["run_id"])]
    result = dict(stage)
    stats = _statistics(stage)
    selected_latency_ms, selected_statistic = _select_latency(
        stage.get("evidence"), stats
    )
    timing = run.get("timing")
    timing = timing if isinstance(timing, Mapping) else {}
    result.update(
        {
            "model_id": run.get("model_id"),
            "model_name": model_by_id[str(run["model_id"])].get("display_name"),
            "runtime_id": run.get("runtime_id"),
            "runtime_name": runtime_by_id[str(run["runtime_id"])].get("display_name"),
            "precision_id": _nested(run, "precision", "precision_id"),
            "statistics": stats,
            "selected_latency_ms": selected_latency_ms,
            "selected_statistic": selected_statistic,
            "warmup_iterations": timing.get("warmup_iterations"),
            "mean_ms": stats.get("mean"),
            "p50_ms": stats.get("p50"),
            "p95_ms": stats.get("p95"),
        }
    )
    return result


def _stage_charts(
    runs: list[dict[str, object]], stage_views: list[dict[str, object]]
) -> list[dict[str, object]]:
    group_ids = assign_group_ids(runs, "workload_scale", "workload.vla.camera_views")
    by_group: dict[str, list[dict[str, object]]] = defaultdict(list)
    for stage in stage_views:
        by_group[group_ids[str(stage["run_id"])]].append(stage)
    return [
        {
            "comparison_kind": "workload_scale",
            "varying_field": "workload.vla.camera_views",
            "group_id": group_id,
            "stacked": False,
            "records": sorted(records, key=lambda row: (str(row["run_id"]), str(row["stage_id"]))),
            "notice": (
                "independent summary statistics are not additive"
                if any(row.get("additive") is False for row in records)
                else None
            ),
        }
        for group_id, records in sorted(by_group.items())
        if records
    ]


def _joined_operator(
    operator: dict[str, object],
    run_by_id: Mapping[str, dict[str, object]],
    model_by_id: Mapping[str, dict[str, object]],
    runtime_by_id: Mapping[str, dict[str, object]],
) -> dict[str, object]:
    run = run_by_id[str(operator["run_id"])]
    result = dict(operator)
    result.update(
        {
            "model_id": run.get("model_id"),
            "model_name": model_by_id[str(run["model_id"])].get("display_name"),
            "runtime_id": run.get("runtime_id"),
            "runtime_name": runtime_by_id[str(run["runtime_id"])].get("display_name"),
            "precision_id": _nested(run, "precision", "precision_id"),
        }
    )
    return result


def _joined_rooflines(
    rooflines: list[dict[str, object]],
    operators: list[dict[str, object]],
    run_by_id: Mapping[str, dict[str, object]],
    model_by_id: Mapping[str, dict[str, object]],
    runtime_by_id: Mapping[str, dict[str, object]],
) -> list[dict[str, object]]:
    operator_by_id = _by_id(operators, "operator_id")
    result = []
    for roofline in rooflines:
        run = run_by_id[str(roofline["run_id"])]
        operator = operator_by_id[str(roofline["operator_id"])]
        row = dict(roofline)
        predicted_ms = roofline.get("predicted_ms")
        work_gflop = operator.get("work_gflop")
        achieved = None
        if isinstance(predicted_ms, (int, float)) and predicted_ms > 0 and isinstance(work_gflop, (int, float)):
            achieved = work_gflop / (predicted_ms / 1000)
        row.update(
            {
                "model_id": run.get("model_id"),
                "model_name": model_by_id[str(run["model_id"])].get("display_name"),
                "runtime_id": run.get("runtime_id"),
                "runtime_name": runtime_by_id[str(run["runtime_id"])].get("display_name"),
                "module_id": operator.get("module_id"),
                "arithmetic_intensity_flop_per_byte": operator.get("arithmetic_intensity_flop_per_byte"),
                "work_gflop": work_gflop,
                "traffic_gib": operator.get("traffic_gib"),
                "source_method": operator.get("source_method"),
                "achieved_gflop_per_s": achieved,
            }
        )
        result.append(row)
    return result


def _nested(row: Mapping[str, object], parent: str, child: str) -> object:
    value = row.get(parent)
    return value.get(child) if isinstance(value, Mapping) else None


def _logical_workspace_content() -> str:
    return (
        '<section id="model-summary" class="panel model-summary"></section>'
        '<section class="panel workload-panel"><h2>Logical workload</h2>'
        '<div id="workload-controls" class="workload-controls"></div></section>'
        '<nav id="graph-breadcrumb" class="graph-breadcrumb" aria-label="Logical graph selection"></nav>'
        '<div id="logical-workspace" class="logical-workspace">'
        '<section class="panel graph-browser" aria-label="Pi0 logical graph">'
        '<h2>Model pipeline</h2><div id="stage-flow" class="pipeline stage-flow"></div>'
        '<h3>Blocks and modules</h3><div id="module-flow" class="pipeline module-flow"></div>'
        '<div id="component-section"><h3>Components</h3>'
        '<div id="component-flow" class="pipeline component-flow"></div></div>'
        '<h3>Atomic operators</h3><div id="operator-flow" class="pipeline operator-flow"></div>'
        '</section>'
        '<aside id="operator-detail" class="panel operator-detail" aria-live="polite"></aside>'
        '</div>'
        '<p id="phase-scope-note" class="scope-note">Structure-only review: runtime, hardware, precision, profiler, and roofline overlays are outside this slice.</p>'
    )


def _page_content(title: str, lede: str, body: str, root_prefix: str) -> str:
    return (
        '<header class="page-header">'
        f'<nav class="atlas-nav" aria-label="Primary"><a href="{root_prefix}index.html">Models</a>'
        f'<a href="{root_prefix}performance.html">Performance</a>'
        f'<a href="{root_prefix}operators.html">Operators</a>'
        f'<a href="{root_prefix}rooflines.html">Rooflines</a></nav>'
        f'<h1 class="atlas-title">{html.escape(title)}</h1>'
        f'<p class="atlas-lede">{html.escape(lede)}</p></header>{body}'
    )


def _filters_content(filters: object) -> str:
    if not isinstance(filters, list):
        return ""
    controls = []
    for spec in filters:
        if not isinstance(spec, Mapping):
            continue
        key = html.escape(str(spec["key"]))
        options = '<option value="">All</option>' + "".join(
            f'<option value="{html.escape(str(value))}">{html.escape(str(value))}</option>'
            for value in spec.get("values", [])
        )
        controls.append(
            f'<label>{html.escape(str(spec["label"]))}<select data-filter="{key}">{options}</select></label>'
        )
    return '<section class="filters" aria-label="Coverage filters">' + "".join(controls) + "</section>"


def write_pages(root: Path, pages: Mapping[str, str]) -> None:
    for relative, content in sorted(pages.items()):
        path = Path(relative)
        if path.is_absolute() or ".." in path.parts:
            raise BuildError(f"invalid page path: {relative}")
        _write_text_atomic(root / path, content)


def copy_static_assets(repo_root: Path, destination: Path) -> None:
    _copy_file(repo_root / "web" / "styles.css", destination / "assets" / "styles.css")
    _copy_tree(repo_root / "web" / "js", destination / "assets" / "js")
    _copy_tree(repo_root / "assets" / "vendor", destination / "assets" / "vendor")


def replace_tree(candidate: Path, output_dir: Path) -> None:
    backup = output_dir.with_name(f".{output_dir.name}.previous")
    if backup.exists():
        shutil.rmtree(backup)
    if output_dir.exists() or output_dir.is_symlink():
        os.replace(output_dir, backup)
    try:
        os.replace(candidate, output_dir)
    except OSError:
        if backup.exists():
            os.replace(backup, output_dir)
        raise
    if backup.exists():
        shutil.rmtree(backup)


def format_issues(issues: list[Issue]) -> str:
    return "\n".join(format_issue(issue) for issue in issues)


def _canonical_document_paths(data_root: Path, entry: Mapping[str, object]) -> list[Path]:
    configured = entry.get("data")
    if isinstance(configured, str):
        return [_canonical_data_path(data_root, configured)]
    configured_glob = entry.get("data_glob")
    if isinstance(configured_glob, str):
        relative = _data_relative_path(configured_glob)
        return sorted(path for path in data_root.glob(str(relative)) if path.is_file())
    raise BuildError("schema/manifest.json: invalid_manifest: dataset data is not configured")


def _canonical_data_path(data_root: Path, configured: str) -> Path:
    path = data_root / _data_relative_path(configured)
    if not path.is_file():
        raise BuildError(f"missing canonical dataset: {configured}")
    return path


def _data_relative_path(configured: str) -> Path:
    path = Path(configured)
    if path.is_absolute() or not path.parts or path.parts[0] != "data" or ".." in path.parts:
        raise BuildError("schema/manifest.json: invalid_manifest: dataset path escapes data")
    return Path(*path.parts[1:])


def _copy_file(source: Path, destination: Path) -> None:
    if source.is_symlink() or not source.is_file():
        raise BuildError(f"missing static asset: {source.name}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)


def _copy_tree(source: Path, destination: Path) -> None:
    if source.is_symlink() or not source.is_dir():
        raise BuildError(f"missing static asset directory: {source.name}")
    for path in sorted(source.rglob("*")):
        relative = path.relative_to(source)
        target = destination / relative
        if path.is_symlink():
            raise BuildError(f"static assets cannot contain symlinks: {relative.as_posix()}")
        if path.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        elif path.is_file():
            _copy_file(path, target)


def _index_content(datasets: Mapping[str, list[dict[str, object]]]) -> str:
    cards = "".join(
        f"<li><strong>{html.escape(name)}</strong><br>{len(records)} records</li>"
        for name, records in sorted(datasets.items())
    )
    return (
        "<h1 class=\"atlas-title\">Embodied Inference Atlas</h1>"
        "<p class=\"atlas-lede\">Offline, evidence-backed views of canonical "
        "inference measurements. This file is self-contained and can be opened directly.</p>"
        f"<ul class=\"dataset-list\">{cards}</ul>"
    )


def _write_text_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, delete=False
    ) as handle:
        handle.write(content)
        temporary = Path(handle.name)
    os.replace(temporary, path)
