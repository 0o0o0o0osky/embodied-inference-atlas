from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass


REL_TOL = 1e-9
ABS_TOL = 1e-12
SAFE_INTEGER = 2**53 - 1


@dataclass(frozen=True)
class RooflineProblem:
    path: str
    code: str
    message: str


def raw_bytes(values: int, bits_per_value: int) -> int:
    _nonnegative_integer(values, "values")
    if bits_per_value not in {4, 8, 16, 32}:
        raise ValueError("bits_per_value is unsupported")
    return math.ceil(values * bits_per_value / 8)


def raw_encoding_bytes(values: int, bits_per_value: int, tensor_scale_bytes: int = 0) -> int:
    return raw_bytes(values, bits_per_value) + _nonnegative_integer(
        tensor_scale_bytes, "tensor_scale_bytes"
    )


def block_encoding_bytes(
    values: int,
    block_values: int,
    packed_data_bytes: int,
    scale_bytes: int,
    zero_point_bytes: int,
    tensor_scale_bytes: int = 0,
) -> int:
    _nonnegative_integer(values, "values")
    if not isinstance(block_values, int) or isinstance(block_values, bool) or block_values <= 0:
        raise ValueError("block_values must be a positive integer")
    return math.ceil(values / block_values) * sum(
        _nonnegative_integer(value, label)
        for value, label in (
            (packed_data_bytes, "packed_data_bytes"),
            (scale_bytes, "scale_bytes"),
            (zero_point_bytes, "zero_point_bytes"),
        )
    ) + _nonnegative_integer(tensor_scale_bytes, "tensor_scale_bytes")


def q8_0_bytes(values: int) -> int:
    return block_encoding_bytes(values, 32, 32, 2, 0)


def w8_group32_bytes(values: int) -> int:
    return block_encoding_bytes(values, 32, 32, 2, 0)


def w4_group32_bytes(values: int) -> int:
    return block_encoding_bytes(values, 32, 16, 2, 0)


def nvfp4_bytes(values: int) -> int:
    return block_encoding_bytes(values, 16, 8, 1, 0, 4)


def mixed_compute_second(allocations: Sequence[tuple[float, float]]) -> float:
    total = 0.0
    for flop, ceiling in allocations:
        _finite_nonnegative(flop, "flop")
        _finite_positive(ceiling, "compute ceiling")
        total += flop / ceiling
    return total


def attention_metrics(
    batch: int,
    query_heads: int,
    kv_heads: int,
    query_length: int,
    key_length: int,
    head_width: int,
    bytes_per_value: int,
    additive_mask: bool = False,
) -> dict[str, int]:
    dimensions = (batch, query_heads, kv_heads, query_length, key_length, head_width)
    if any(not isinstance(value, int) or isinstance(value, bool) or value <= 0 for value in dimensions):
        raise ValueError("attention dimensions must be positive integers")
    if not isinstance(bytes_per_value, int) or bytes_per_value <= 0:
        raise ValueError("bytes_per_value must be a positive integer")
    scores = batch * query_heads * query_length * key_length
    rows = batch * query_heads * query_length
    q_byte = batch * query_heads * query_length * head_width * bytes_per_value
    kv_byte = batch * kv_heads * key_length * head_width * bytes_per_value
    score_byte = scores * bytes_per_value
    mask_byte = score_byte if additive_mask else 0
    return {
        "score_flop": 2 * scores * head_width,
        "value_flop": 2 * scores * head_width,
        "scale_scalar_flop": scores,
        "mask_scalar_flop": scores if additive_mask else 0,
        "softmax_scalar_flop": 3 * scores - rows,
        "comparison_ops": scores - rows,
        "transcendental_ops": scores + rows,
        "atomic_byte": q_byte + kv_byte + score_byte + score_byte + score_byte
        + mask_byte + score_byte + kv_byte + q_byte,
        "fused_boundary_byte": q_byte + kv_byte + kv_byte + q_byte + mask_byte,
    }


def stage_lower_bound(
    nodes: Sequence[Mapping[str, object]], edges: Sequence[Mapping[str, object]]
) -> dict[str, object]:
    by_id = {node.get("id"): node for node in nodes if isinstance(node.get("id"), str)}
    if len(by_id) != len(nodes):
        raise ValueError("stage node IDs must be nonempty and unique")
    predecessors = {node_id: [] for node_id in by_id}
    successors = {node_id: [] for node_id in by_id}
    for edge in edges:
        source, target = edge.get("source"), edge.get("target")
        if source not in by_id or target not in by_id:
            raise ValueError("stage dependency edge does not resolve")
        predecessors[target].append(source)
        successors[source].append(target)
    indegree = {node_id: len(values) for node_id, values in predecessors.items()}
    ready = sorted(node_id for node_id, degree in indegree.items() if degree == 0)
    order: list[str] = []
    while ready:
        node_id = ready.pop(0)
        order.append(node_id)
        for target in sorted(successors[node_id]):
            indegree[target] -= 1
            if indegree[target] == 0:
                ready.append(target)
                ready.sort()
    if len(order) != len(nodes):
        raise ValueError("stage dependency graph must be acyclic")
    finish: dict[str, float] = {}
    paths: dict[str, list[str]] = {}
    for node_id in order:
        candidates = sorted(
            predecessors[node_id], key=lambda source: (-finish[source], source)
        )
        winner = candidates[0] if candidates else None
        roof = _finite_nonnegative(by_id[node_id].get("roof_second"), "roof_second")
        finish[node_id] = (finish[winner] if winner else 0.0) + roof
        paths[node_id] = [*(paths[winner] if winner else []), node_id]
    sinks = sorted(
        (node_id for node_id in by_id if not successors[node_id]),
        key=lambda node_id: (-finish[node_id], node_id),
    )
    sink = sinks[0] if sinks else None
    dependency = finish[sink] if sink else 0.0
    resource_compute = sum(
        _finite_nonnegative(node.get("compute_second"), "compute_second") for node in nodes
    )
    resource_memory = sum(
        _finite_nonnegative(node.get("memory_second"), "memory_second") for node in nodes
    )
    roof = max(dependency, resource_compute, resource_memory)
    values = {
        "dependency": dependency,
        "compute": resource_compute,
        "memory": resource_memory,
    }
    winners = [name for name, value in values.items() if _close(value, roof)]
    return {
        "dependency_second": dependency,
        "resource_compute_second": resource_compute,
        "resource_memory_second": resource_memory,
        "roof_second": roof,
        "limiter": winners[0] if len(winners) == 1 else "tie",
        "critical_path": paths[sink] if sink else [],
    }


def roofline_problems(datasets: Mapping[str, list[Mapping]]) -> list[RooflineProblem]:
    """Mirror-recompute all v2 roofline primitives and enforce non-mixable bases."""
    issues: list[RooflineProblem] = []
    ceilings = datasets.get("roofline_ceilings", [])
    scenarios = datasets.get("roofline_scenarios", [])
    bases = datasets.get("roofline_bases", [])
    points = datasets.get("roofline_points", [])
    ceiling_by_id = _index(issues, ceilings, "ceiling_id", "roofline_ceilings")
    scenario_by_id = _index(issues, scenarios, "scenario_id", "roofline_scenarios")
    basis_by_id = _index(issues, bases, "basis_id", "roofline_bases")
    point_by_id = _index(issues, points, "point_id", "roofline_points")
    source_ids = {
        record.get("source_id") for record in datasets.get("sources", [])
        if isinstance(record.get("source_id"), str)
    }
    realization_by_id = {
        record.get("realization_id"): record
        for record in datasets.get("runtime_realizations", [])
        if isinstance(record.get("realization_id"), str)
    }
    realization_ids = set(realization_by_id)
    run_by_id = {
        record.get("run_id"): record for record in datasets.get("runs", [])
        if isinstance(record.get("run_id"), str)
    }
    run_ids = set(run_by_id)
    graph_ids = {
        record.get("model_graph_id") for record in datasets.get("model_graphs", [])
        if isinstance(record.get("model_graph_id"), str)
    }
    model_artifacts = {
        (model.get("model_id"), artifact.get("artifact_id"))
        for model in datasets.get("models", [])
        for artifact in _mapping_list(model.get("artifacts"))
    }
    operator_by_id = {
        record.get("operator_id"): record for record in datasets.get("operators", [])
        if isinstance(record.get("operator_id"), str)
    }
    roofline_by_id = {
        record.get("roofline_id"): record for record in datasets.get("rooflines", [])
        if isinstance(record.get("roofline_id"), str)
    }

    for dataset_name, records in (
        ("roofline_ceilings", ceilings),
        ("roofline_scenarios", scenarios),
        ("roofline_bases", bases),
        ("roofline_points", points),
    ):
        for index, record in enumerate(records):
            _validate_source_refs(
                issues, record, f"$.{dataset_name}[{index}]", source_ids
            )

    compute_by_ceiling: dict[str, dict[str, float]] = {}
    sparse_classes_by_ceiling: dict[str, set[str]] = {}
    bandwidth_by_ceiling: dict[str, dict[str, float]] = {}
    for index, ceiling in enumerate(ceilings):
        base = f"$.roofline_ceilings[{index}]"
        ceiling_id = ceiling.get("ceiling_id")
        compute: dict[str, float] = {}
        sparse_classes: set[str] = set()
        for item_index, item in enumerate(_mapping_list(ceiling.get("compute"))):
            rate = item.get("flop_per_second")
            if _is_number(rate):
                _finite_positive(rate, "flop_per_second")
                compute_class = item.get("compute_class")
                if isinstance(compute_class, str):
                    if compute_class in compute:
                        issues.append(_problem(f"{base}.compute[{item_index}].compute_class", "duplicate", "compute class must be unique in a ceiling"))
                    compute[compute_class] = float(rate)
                    if item.get("requires_sparsity_on") is True:
                        sparse_classes.add(compute_class)
            elif rate is None and not _has_missing(ceiling, f"compute.{item.get('compute_ceiling_id')}.flop_per_second"):
                issues.append(_missing(f"{base}.compute[{item_index}].flop_per_second"))
        bandwidth: dict[str, float] = {}
        for item_index, item in enumerate(_mapping_list(ceiling.get("bandwidth"))):
            rate = item.get("byte_per_second")
            item_id = item.get("bandwidth_ceiling_id")
            if _is_number(rate) and isinstance(item_id, str):
                _finite_positive(rate, "byte_per_second")
                bandwidth[item_id] = float(rate)
            elif rate is None and not _has_missing(ceiling, f"bandwidth.{item_id}.byte_per_second"):
                issues.append(_missing(f"{base}.bandwidth[{item_index}].byte_per_second"))
        if isinstance(ceiling_id, str):
            compute_by_ceiling[ceiling_id] = compute
            sparse_classes_by_ceiling[ceiling_id] = sparse_classes
            bandwidth_by_ceiling[ceiling_id] = bandwidth

    for index, scenario in enumerate(scenarios):
        base = f"$.roofline_scenarios[{index}]"
        graph_id = scenario.get("model_graph_id")
        if graph_id is not None and graph_id not in graph_ids:
            issues.append(_broken(f"{base}.model_graph_id"))
        if (scenario.get("model_id"), scenario.get("model_artifact_id")) not in model_artifacts:
            issues.append(_broken(f"{base}.model_artifact_id"))
        workload = scenario.get("workload")
        if isinstance(workload, Mapping):
            positive_fields = (
                "batch_size", "active_camera_views", "executed_camera_views",
                "action_horizon", "internal_action_dimension", "denoise_steps",
            )
            for field in positive_fields:
                value = workload.get(field)
                if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                    issues.append(_problem(f"{base}.workload.{field}", "positive_integer", "workload value must be a positive integer"))
        path = scenario.get("precision_path")
        if not isinstance(path, Mapping):
            continue
        path_id = path.get("precision_path_id")
        segments = _mapping_list(path.get("segments"))
        if not segments:
            issues.append(_problem(f"{base}.precision_path.segments", "empty_precision_path", "precision paths require at least one segment"))
        seen_refs: set[str] = set()
        selected_refs: set[str] = set()
        for segment_index, segment in enumerate(segments):
            selector = segment.get("selector")
            if isinstance(selector, Mapping):
                kind = selector.get("kind")
                for ref in selector.get("refs", []) if isinstance(selector.get("refs"), list) else []:
                    key = str(ref)
                    if key in seen_refs:
                        issues.append(_problem(f"{base}.precision_path.segments[{segment_index}].selector.refs", "overlap", "precision selectors must be disjoint"))
                    seen_refs.add(key)
                    selected_refs.add(key)
                if path.get("kind") == "mapped_mixed" and (kind != "execution_groups" or not selector.get("refs")):
                    issues.append(_problem(f"{base}.precision_path.segments[{segment_index}].selector", "mapped_selector", "mapped-mixed segments require nonempty execution-group selectors"))
            compute_class = segment.get("compute_class")
            if path_id in {"w8a16_bf16_compute", "w4a16_bf16_compute", "q8_0_weight_only_bf16_compute"} and compute_class != "tensor_bf16_dense":
                issues.append(_problem(f"{base}.precision_path.segments[{segment_index}].compute_class", "wrong_ceiling", "weight-only W8/W4/Q8 paths must use the BF16 compute ceiling"))
        for realization_index, realization_id in enumerate(path.get("realization_ids", [])):
            if realization_id not in realization_ids:
                issues.append(_broken(f"{base}.precision_path.realization_ids[{realization_index}]"))
        if path.get("kind") == "mapped_mixed":
            applicability_matches = True
            applicability_complete = True
            has_bound_configuration = False
            if len(path.get("realization_ids", [])) != 1:
                issues.append(_problem(f"{base}.precision_path.realization_ids", "mapped_realization", "mapped-mixed paths require exactly one realization"))
            elif path.get("realization_ids"):
                realization = realization_by_id.get(path["realization_ids"][0])
                realization_artifacts = set(realization.get("model_artifact_ids", [])) if isinstance(realization, Mapping) else set()
                if scenario.get("model_artifact_id") not in realization_artifacts:
                    applicability_matches = False
                    issues.append(_problem(
                        f"{base}.model_artifact_id",
                        "runtime_artifact_mismatch",
                        "mapped-mixed scenario artifact must belong to its bound realization",
                    ))
                group_ids = {
                    group.get("execution_group_id")
                    for group in _mapping_list(realization.get("execution_groups") if isinstance(realization, Mapping) else None)
                    if isinstance(group.get("execution_group_id"), str)
                }
                if selected_refs != group_ids:
                    issues.append(_problem(f"{base}.precision_path.segments", "mapped_coverage", "mapped-mixed selectors must cover every execution group exactly once"))
                applicability = realization.get("workload_applicability") if isinstance(realization, Mapping) else None
                if not isinstance(workload, Mapping) or not isinstance(applicability, Mapping):
                    applicability_matches = False
                    applicability_complete = False
                else:
                    applicability_fields = (
                        ("action_horizon", "runtime_action_horizon"),
                        ("action_horizon", "public_action_horizon"),
                        ("public_action_dimension", "public_action_dimension"),
                        ("internal_action_dimension", "runtime_internal_action_dimension"),
                        ("denoise_steps", "denoise_steps"),
                    )
                    for workload_field, applicability_field in applicability_fields:
                        expected = applicability.get(applicability_field)
                        if expected is None:
                            applicability_complete = False
                            continue
                        if workload.get(workload_field) != expected:
                            applicability_matches = False
                            issues.append(_problem(
                                f"{base}.workload.{workload_field}",
                                "runtime_workload_mismatch",
                                f"mapped-mixed workload must match {applicability_field}={expected} from its bound realization",
                            ))
                    configuration_ids = set(realization.get("configuration_ids", [])) if isinstance(realization, Mapping) else set()
                    for run in run_by_id.values():
                        if run.get("configuration_id") not in configuration_ids:
                            continue
                        run_workload = run.get("workload")
                        common = run_workload.get("common") if isinstance(run_workload, Mapping) else None
                        vla = run_workload.get("vla") if isinstance(run_workload, Mapping) else None
                        if not isinstance(common, Mapping) or not isinstance(vla, Mapping):
                            continue
                        if (
                            run.get("model_artifact_id") == scenario.get("model_artifact_id")
                            and common.get("batch_size") == workload.get("batch_size")
                            and vla.get("camera_views") == workload.get("executed_camera_views")
                            and vla.get("semantic_prompt_tokens") == workload.get("semantic_prompt_tokens")
                            and vla.get("executed_prompt_tokens") == workload.get("executed_prompt_tokens")
                            and vla.get("action_chunk") == workload.get("action_horizon")
                            and vla.get("action_dimension") == workload.get("public_action_dimension")
                        ):
                            has_bound_configuration = True
                            break
                    if not has_bound_configuration:
                        issues.append(_problem(
                            f"{base}.workload",
                            "runtime_configuration_mismatch",
                            "mapped-mixed workload must select a source-backed configuration bound to its realization",
                        ))
                    if applicability.get("missing_reason_code") is not None:
                        applicability_complete = False
            if path.get("runtime_support") == "proven" and (
                not applicability_matches or not applicability_complete or not has_bound_configuration
            ):
                issues.append(_problem(
                    f"{base}.precision_path.runtime_support",
                    "runtime_support_unproven",
                    "proven runtime support requires a bound configuration and complete matching workload applicability",
                ))

    for index, basis in enumerate(bases):
        base = f"$.roofline_bases[{index}]"
        scenario = scenario_by_id.get(basis.get("scenario_id"))
        ceiling = ceiling_by_id.get(basis.get("ceiling_id"))
        if scenario is None:
            issues.append(_broken(f"{base}.scenario_id"))
            continue
        if ceiling is None:
            issues.append(_broken(f"{base}.ceiling_id"))
            continue
        path = scenario.get("precision_path")
        operating = ceiling.get("operating_point")
        duplicates = (
            ("precision_path_id", path.get("precision_path_id") if isinstance(path, Mapping) else None),
            ("device_id", ceiling.get("device_id")),
            ("operating_point_id", operating.get("operating_point_id") if isinstance(operating, Mapping) else None),
        )
        for field, expected in duplicates:
            if basis.get(field) != expected:
                issues.append(_problem(f"{base}.{field}", "basis_mismatch", "expanded basis field must match its referenced record"))
        bandwidth_id = basis.get("bandwidth_ceiling_id")
        if bandwidth_id not in bandwidth_by_ceiling.get(str(basis.get("ceiling_id")), {}):
            issues.append(_broken(f"{base}.bandwidth_ceiling_id"))
        level = basis.get("level")
        if level == "stage" and basis.get("aggregation") not in {"dag_resource_and_critical_path", "entity"}:
            issues.append(_problem(f"{base}.aggregation", "level_basis", "stage bases require critical-path aggregation or the legacy entity exception"))
        if level == "atomic" and basis.get("traffic_basis") != "atomic_materialized":
            issues.append(_problem(f"{base}.traffic_basis", "level_basis", "atomic points require materialized atomic traffic"))
        if level == "fused" and basis.get("realization_id") not in realization_ids:
            issues.append(_broken(f"{base}.realization_id"))
        if level == "fused" and basis.get("traffic_basis") != "fused_boundary_modeled":
            issues.append(_problem(f"{base}.traffic_basis", "level_basis", "fused points require independently modeled boundary traffic"))
        if level == "kernel" and (basis.get("realization_id") is None or basis.get("capture_id") is None):
            issues.append(_problem(base, "kernel_basis", "kernel bases require a realization and capture"))
        run_id = basis.get("run_id")
        if run_id is not None and run_id not in run_ids:
            issues.append(_broken(f"{base}.run_id"))
        scenario_classes = {
            segment.get("compute_class")
            for segment in _mapping_list(path.get("segments") if isinstance(path, Mapping) else None)
        }
        sparse_classes = sparse_classes_by_ceiling.get(str(basis.get("ceiling_id")), set())
        if scenario_classes & sparse_classes and not _basis_has_sparsity_observation(basis, run_by_id):
            issues.append(_problem(base, "sparse_observation", "sparse compute roofs require the exact matched run observation to record sparsity_on=true"))

    legacy_pairs: set[tuple[str, str]] = set()
    legacy_operator_ids: set[str] = set()
    legacy_roofline_ids: set[str] = set()
    legacy_count = 0
    for index, point in enumerate(points):
        base = f"$.roofline_points[{index}]"
        basis = basis_by_id.get(point.get("basis_id"))
        if basis is None:
            issues.append(_broken(f"{base}.basis_id"))
            continue
        _validate_point(
            issues,
            point,
            basis,
            ceiling_by_id,
            compute_by_ceiling,
            sparse_classes_by_ceiling,
            bandwidth_by_ceiling,
            run_by_id,
            base,
        )
        entity = point.get("entity")
        kind = entity.get("kind") if isinstance(entity, Mapping) else None
        level = basis.get("level")
        permitted = {
            "stage": {"stage", "model_total", "legacy_component"},
            "atomic": {"atomic_operator"},
            "fused": {"execution_group"},
            "kernel": {"kernel"},
        }.get(level, set())
        if kind not in permitted:
            issues.append(_problem(f"{base}.entity.kind", "level_entity", "point entity kind does not match its accounting level"))
        if kind == "legacy_component":
            legacy_count += 1
            refs = point.get("legacy_record_refs")
            pairs = {
                (ref.get("dataset"), ref.get("record_id"))
                for ref in _mapping_list(refs)
            }
            operator = next((record_id for dataset, record_id in pairs if dataset == "operators"), None)
            roofline = next((record_id for dataset, record_id in pairs if dataset == "rooflines"), None)
            if not isinstance(operator, str) or not isinstance(roofline, str):
                issues.append(_problem(f"{base}.legacy_record_refs", "legacy_pair", "legacy points require one operator and one roofline ref"))
            elif (operator, roofline) in legacy_pairs:
                issues.append(_problem(f"{base}.legacy_record_refs", "duplicate", "legacy operator/roofline pairs must be unique"))
            else:
                legacy_pairs.add((operator, roofline))
                legacy_operator_ids.add(operator)
                legacy_roofline_ids.add(roofline)
                _validate_legacy_point(
                    issues,
                    point,
                    basis,
                    operator_by_id.get(operator),
                    roofline_by_id.get(roofline),
                    run_by_id,
                    base,
                )
        if basis.get("aggregation") == "dag_resource_and_critical_path":
            _validate_stage_aggregation(
                issues, point, basis, point_by_id, basis_by_id, base
            )
        if level == "kernel":
            _validate_kernel_point(issues, point, basis, base)
    default_scenarios = [item for item in scenarios if item.get("origin") == "default_precomputed"]
    legacy_scenarios = [item for item in scenarios if item.get("origin") == "legacy_import"]
    expected_default_keys = {
        (model_id, precision_path_id)
        for model_id in ("pi0", "pi05", "smolvla")
        for precision_path_id in (
            "bf16_dense", "fp16_dense", "fp8_w8a8", "nvfp4_w4a4",
            "w8a16_bf16_compute", "w4a16_bf16_compute",
            "q8_0_weight_only_bf16_compute",
        )
    }
    actual_default_keys = [
        (item.get("model_id"), item.get("precision_path", {}).get("precision_path_id"))
        for item in default_scenarios if item.get("precision_path", {}).get("kind") != "mapped_mixed"
    ]
    if set(actual_default_keys) != expected_default_keys or len(actual_default_keys) != len(set(actual_default_keys)):
        issues.append(_problem("$.roofline_scenarios", "scenario_matrix", "uniform default scenarios must cover the three-model by seven-precision matrix; mapped runtime scenarios require retained evidence"))
    legacy_scenario_ids = {item.get("scenario_id") for item in legacy_scenarios}
    legacy_bases = [item for item in bases if item.get("scenario_id") in legacy_scenario_ids]
    expected_legacy_run_ids = {item.get("run_id") for item in operator_by_id.values()}
    if (
        {item.get("scenario_id") for item in legacy_bases} != legacy_scenario_ids
        or {item.get("run_id") for item in legacy_bases} != expected_legacy_run_ids
        or len(legacy_bases) != len(legacy_scenario_ids)
        or len(legacy_scenarios) != len(expected_legacy_run_ids)
    ):
        issues.append(_problem("$.roofline_scenarios", "legacy_coverage", "legacy scenarios and bases must map one-to-one to retained component runs"))
    if legacy_count != len(operator_by_id) or legacy_count != len(roofline_by_id):
        issues.append(_problem("$.roofline_points", "legacy_count", "legacy points must map one-to-one to retained operator and roofline records"))
    expected_legacy_operator_ids = set(operator_by_id)
    expected_legacy_roofline_ids = set(roofline_by_id)
    if legacy_operator_ids != expected_legacy_operator_ids:
        issues.append(_problem("$.roofline_points", "legacy_operator_coverage", "legacy migration must reference every old operator exactly once"))
    if legacy_roofline_ids != expected_legacy_roofline_ids:
        issues.append(_problem("$.roofline_points", "legacy_roofline_coverage", "legacy migration must reference every old roofline exactly once"))
    _validate_required_ceilings(issues, ceiling_by_id)
    return issues


def _validate_point(
    issues: list[RooflineProblem],
    point: Mapping,
    basis: Mapping,
    ceilings: Mapping[object, Mapping],
    compute_by_ceiling: Mapping[str, Mapping[str, float]],
    sparse_classes_by_ceiling: Mapping[str, set[str]],
    bandwidth_by_ceiling: Mapping[str, Mapping[str, float]],
    runs: Mapping[object, Mapping],
    base: str,
) -> None:
    work = point.get("work")
    traffic = point.get("traffic")
    derived = point.get("derived")
    aggregation = point.get("aggregation")
    if not all(isinstance(value, Mapping) for value in (work, traffic, derived, aggregation)):
        return
    work_components = _mapping_list(work.get("components"))
    traffic_components = _mapping_list(traffic.get("components"))
    total_flop = sum(_finite_nonnegative(item.get("flop"), "component flop") for item in work_components)
    total_byte = sum(_finite_nonnegative(item.get("byte"), "component byte") for item in traffic_components)
    if not _close(total_flop, work.get("total_flop")):
        issues.append(_problem(f"{base}.work.total_flop", "derived_mismatch", "total FLOPs must equal component FLOPs"))
    if not _close(total_byte, traffic.get("total_byte")):
        issues.append(_problem(f"{base}.traffic.total_byte", "derived_mismatch", "total bytes must equal traffic components"))
    if total_flop <= 0 or total_byte <= 0:
        issues.append(_problem(base, "plottable_positive", "canonical point work and traffic must be positive"))
        return
    provenance = point.get("provenance")
    legacy = isinstance(provenance, Mapping) and provenance.get("class") == "legacy_tool_assumption"
    if not legacy and (not float(total_flop).is_integer() or not float(total_byte).is_integer() or total_flop > SAFE_INTEGER or total_byte > SAFE_INTEGER):
        issues.append(_problem(base, "exact_integer", "non-legacy work and bytes must be exact JavaScript-safe integers"))
    ai = total_flop / total_byte
    if not _close(ai, derived.get("arithmetic_intensity_flop_per_byte")):
        issues.append(_problem(f"{base}.derived.arithmetic_intensity_flop_per_byte", "derived_mismatch", "AI must equal total FLOPs / total bytes"))
    ceiling_id = str(basis.get("ceiling_id"))
    rates = compute_by_ceiling.get(ceiling_id, {})
    sparse_classes = sparse_classes_by_ceiling.get(ceiling_id, set())
    sparse_observed = _basis_has_sparsity_observation(basis, runs)
    allocations: list[tuple[float, float]] = []
    missing_compute = False
    for item in work_components:
        flop = float(item.get("flop", 0))
        compute_class = item.get("compute_class")
        if flop and (
            not isinstance(compute_class, str)
            or compute_class not in rates
            or (compute_class in sparse_classes and not sparse_observed)
        ):
            missing_compute = True
        elif flop:
            allocations.append((flop, rates[compute_class]))
    bandwidth = bandwidth_by_ceiling.get(ceiling_id, {}).get(str(basis.get("bandwidth_ceiling_id")))
    compute_second = None if missing_compute else mixed_compute_second(allocations)
    memory_second = total_byte / bandwidth if bandwidth else None
    if basis.get("aggregation") == "dag_resource_and_critical_path":
        dependency = aggregation.get("dependency_lower_bound_second")
        resource_compute = aggregation.get("resource_compute_lower_bound_second")
        resource_memory = aggregation.get("resource_memory_lower_bound_second")
        available = [value for value in (dependency, resource_compute, resource_memory) if _is_number(value)]
        expected_roof = max(available) if available else None
        expected_compute = resource_compute
        expected_memory = resource_memory
    else:
        expected_compute = compute_second
        expected_memory = memory_second
        expected_roof = max(compute_second, memory_second) if compute_second is not None and memory_second is not None else None
    for field, expected in (
        ("compute_second", expected_compute),
        ("memory_second", expected_memory),
        ("roof_second", expected_roof),
    ):
        actual = derived.get(field)
        if expected is None:
            if actual is not None:
                issues.append(_problem(f"{base}.derived.{field}", "derived_mismatch", f"{field} must remain missing"))
        elif not _close(expected, actual):
            issues.append(_problem(f"{base}.derived.{field}", "derived_mismatch", f"{field} does not recompute"))
    roof_rate = total_flop / expected_roof if expected_roof else None
    if roof_rate is None:
        if derived.get("roof_flop_per_second") is not None:
            issues.append(_problem(f"{base}.derived.roof_flop_per_second", "derived_mismatch", "roof rate must remain missing"))
    elif not _close(roof_rate, derived.get("roof_flop_per_second")):
        issues.append(_problem(f"{base}.derived.roof_flop_per_second", "derived_mismatch", "roof rate does not recompute"))
    if basis.get("aggregation") == "dag_resource_and_critical_path":
        limiter_values = {
            "dependency": aggregation.get("dependency_lower_bound_second"),
            "compute": aggregation.get("resource_compute_lower_bound_second"),
            "memory": aggregation.get("resource_memory_lower_bound_second"),
        }
    else:
        limiter_values = {"compute": compute_second, "memory": memory_second}
    available_limiters = {
        name: float(value) for name, value in limiter_values.items() if _is_number(value)
    }
    if expected_roof is None or len(available_limiters) != len(limiter_values):
        expected_limiter = "unknown"
    else:
        winners = [
            name for name, value in available_limiters.items()
            if _close(value, expected_roof)
        ]
        expected_limiter = winners[0] if len(winners) == 1 else "tie"
    if derived.get("limiter") != expected_limiter:
        issues.append(_problem(f"{base}.derived.limiter", "derived_mismatch", "limiter does not recompute"))
    timing = point.get("timing")
    observed = timing.get("observed_second") if isinstance(timing, Mapping) else None
    if _is_number(observed):
        achieved = total_flop / observed
        ratio_allowed = (
            expected_roof is not None
            and derived.get("status") == "complete"
            and _basis_has_observed_clocks(basis, ceilings.get(basis.get("ceiling_id")))
        )
        efficiency = expected_roof / observed if ratio_allowed else None
        gap = observed / expected_roof if ratio_allowed else None
        for field, expected in (("achieved_flop_per_second", achieved), ("efficiency", efficiency), ("gap", gap)):
            actual = derived.get(field)
            if expected is None:
                if actual is not None:
                    issues.append(_problem(f"{base}.derived.{field}", "unmatched_observation", f"{field} requires a complete roof with observed clocks"))
            elif not _close(expected, actual):
                issues.append(_problem(f"{base}.derived.{field}", "derived_mismatch", f"{field} does not recompute"))
        if efficiency is not None and efficiency > 1 + REL_TOL:
            issues.append(_problem(f"{base}.derived.efficiency", "faster_than_roof", "observed time cannot be faster than its matched roof"))
    elif any(derived.get(field) is not None for field in ("achieved_flop_per_second", "efficiency", "gap")):
        issues.append(_problem(f"{base}.derived", "observed_missing", "observed-only derived fields require observed time"))
    if derived.get("status") != "complete" and (derived.get("efficiency") is not None or derived.get("gap") is not None):
        issues.append(_problem(f"{base}.derived", "partial_ratio", "partial points cannot expose efficiency or gap"))
    efficiency = derived.get("efficiency")
    gap = derived.get("gap")
    if _is_number(efficiency) and _is_number(gap):
        if efficiency <= 0 or gap <= 0 or not _close(efficiency * gap, 1.0):
            issues.append(_problem(f"{base}.derived", "ratio_reciprocal", "efficiency and gap must be positive reciprocals"))


def _validate_stage_aggregation(
    issues: list[RooflineProblem],
    point: Mapping,
    basis: Mapping,
    points: Mapping[object, Mapping],
    bases: Mapping[object, Mapping],
    base: str,
) -> None:
    aggregation = point.get("aggregation")
    if not isinstance(aggregation, Mapping):
        return
    member_ids = aggregation.get("member_point_ids")
    if not isinstance(member_ids, list) or not member_ids:
        issues.append(_problem(f"{base}.aggregation.member_point_ids", "empty_aggregation", "DAG stage aggregates require members"))
        return
    if len(member_ids) != len(set(member_ids)):
        issues.append(_problem(f"{base}.aggregation.member_point_ids", "duplicate", "aggregate member IDs must be unique"))
        return
    members: list[Mapping] = []
    for member_index, member_id in enumerate(member_ids):
        member = points.get(member_id)
        if member is None:
            issues.append(_broken(f"{base}.aggregation.member_point_ids[{member_index}]"))
            continue
        member_basis = bases.get(member.get("basis_id"))
        member_entity = member.get("entity")
        if not isinstance(member_basis, Mapping) or member_basis.get("level") != "atomic":
            issues.append(_problem(f"{base}.aggregation.member_point_ids[{member_index}]", "aggregate_member", "stage members must be atomic points"))
            continue
        if not isinstance(member_entity, Mapping) or member_entity.get("kind") != "atomic_operator":
            issues.append(_problem(f"{base}.aggregation.member_point_ids[{member_index}]", "aggregate_member", "stage members must be atomic operators"))
            continue
        comparable_fields = (
            "scenario_id", "precision_path_id", "ceiling_id",
            "bandwidth_ceiling_id", "device_id", "operating_point_id",
        )
        if any(member_basis.get(field) != basis.get(field) for field in comparable_fields):
            issues.append(_problem(f"{base}.aggregation.member_point_ids[{member_index}]", "cross_basis_member", "aggregate members must share the stage basis tuple"))
            continue
        members.append(member)
    if len(members) != len(member_ids):
        return

    expected_work = sum(float(member["work"]["total_flop"]) for member in members)
    expected_traffic = sum(float(member["traffic"]["total_byte"]) for member in members)
    if not _close(expected_work, point.get("work", {}).get("total_flop")):
        issues.append(_problem(f"{base}.work.total_flop", "aggregate_mismatch", "stage work must equal its member work"))
    if not _close(expected_traffic, point.get("traffic", {}).get("total_byte")):
        issues.append(_problem(f"{base}.traffic.total_byte", "aggregate_mismatch", "stage traffic must equal its member traffic"))

    nodes: list[dict[str, object]] = []
    for member in members:
        derived = member.get("derived")
        if not isinstance(derived, Mapping) or any(
            not _is_number(derived.get(field))
            for field in ("compute_second", "memory_second", "roof_second")
        ):
            issues.append(_problem(f"{base}.aggregation.member_point_ids", "incomplete_member", "DAG resources require complete member lower bounds"))
            return
        nodes.append({
            "id": member.get("point_id"),
            "compute_second": derived.get("compute_second"),
            "memory_second": derived.get("memory_second"),
            "roof_second": derived.get("roof_second"),
        })
    try:
        expected = stage_lower_bound(nodes, _mapping_list(aggregation.get("dependency_edges")))
    except ValueError:
        issues.append(_problem(f"{base}.aggregation.dependency_edges", "invalid_dag", "stage dependency edges must resolve to members and remain acyclic"))
        return
    for field, expected_field in (
        ("dependency_lower_bound_second", "dependency_second"),
        ("resource_compute_lower_bound_second", "resource_compute_second"),
        ("resource_memory_lower_bound_second", "resource_memory_second"),
    ):
        if not _close(aggregation.get(field), expected[expected_field]):
            issues.append(_problem(f"{base}.aggregation.{field}", "aggregate_mismatch", f"{field} does not recompute from members"))


def _validate_legacy_point(
    issues: list[RooflineProblem],
    point: Mapping,
    basis: Mapping,
    operator: Mapping | None,
    roofline: Mapping | None,
    runs: Mapping[object, Mapping],
    base: str,
) -> None:
    if operator is None or roofline is None:
        issues.append(_problem(f"{base}.legacy_record_refs", "broken_reference", "legacy source pair does not resolve"))
        return
    if roofline.get("operator_id") != operator.get("operator_id") or roofline.get("run_id") != operator.get("run_id"):
        issues.append(_problem(f"{base}.legacy_record_refs", "legacy_join", "legacy operator and roofline must retain their original one-to-one join"))
    if basis.get("run_id") != operator.get("run_id") or basis.get("ceiling_id") != "thor-t5000-vla-perf-legacy":
        issues.append(_problem(f"{base}.basis_id", "legacy_basis", "legacy points must retain the source run and legacy-only ceiling"))
    entity = point.get("entity")
    coverage = point.get("coverage")
    traffic = point.get("traffic")
    provenance = point.get("provenance")
    if not isinstance(entity, Mapping) or entity.get("logical_refs") != [] or not str(entity.get("label", "")).startswith("Legacy VLA-Perf component envelope"):
        issues.append(_problem(f"{base}.entity", "legacy_mapping", "legacy envelopes must remain explicitly labeled and unmapped"))
    if not isinstance(traffic, Mapping) or traffic.get("value_kind") != "legacy_derived":
        issues.append(_problem(f"{base}.traffic.value_kind", "legacy_class", "legacy traffic must remain legacy-derived"))
    if not isinstance(provenance, Mapping) or provenance.get("class") != "legacy_tool_assumption":
        issues.append(_problem(f"{base}.provenance.class", "legacy_class", "legacy points require legacy-tool provenance"))

    expected_work = float(operator.get("work_gflop", 0)) * 1e9
    expected_traffic = float(operator.get("traffic_gib", 0)) * 2**30
    if not _close(point.get("work", {}).get("total_flop"), expected_work):
        issues.append(_problem(f"{base}.work.total_flop", "legacy_algebra", "legacy work must preserve work_gflop"))
    if not _close(point.get("traffic", {}).get("total_byte"), expected_traffic):
        issues.append(_problem(f"{base}.traffic.total_byte", "legacy_algebra", "legacy traffic must preserve traffic_gib using 2^30"))
    compute_second = expected_work / (float(roofline.get("compute_peak_gflop_per_s", 0)) * 1e9)
    memory_second = expected_traffic / (float(roofline.get("bandwidth_gib_per_s", 0)) * 2**30)
    expected_second = max(compute_second, memory_second)
    published_second = float(roofline.get("predicted_ms", 0)) / 1e3
    if not _close(expected_second, published_second):
        issues.append(_problem(f"{base}.legacy_record_refs", "legacy_algebra", "old predicted time does not recompute under the old ceiling"))
    if not _close(point.get("derived", {}).get("roof_second"), published_second):
        issues.append(_problem(f"{base}.derived.roof_second", "legacy_algebra", "migrated roof time must preserve the old prediction"))
    expected_calls = 10 if operator.get("module_id") == "action" else 1
    if point.get("calls") != expected_calls or point.get("values_scope") != "all_calls":
        issues.append(_problem(base, "legacy_calls", "legacy calls are descriptive and must not multiply all-call values again"))
    run = runs.get(operator.get("run_id"))
    model_id = run.get("model_id") if isinstance(run, Mapping) else None
    expected_coverage = "proxy" if model_id == "pi05" else "unmapped_legacy"
    if not isinstance(coverage, Mapping) or coverage.get("status") != expected_coverage:
        issues.append(_problem(f"{base}.coverage.status", "legacy_coverage", "legacy native/proxy/custom coverage classification must be preserved"))
    expected_traffic_basis = "legacy_custom_resident_score" if model_id == "smolvla" else "legacy_inverse_roofline"
    if basis.get("traffic_basis") != expected_traffic_basis:
        issues.append(_problem(f"{base}.basis_id", "legacy_basis", "legacy inverse-roofline and custom-resident bases must remain separate"))
    condition = provenance.get("condition") if isinstance(provenance, Mapping) else None
    fidelity = roofline.get("modeling_fidelity")
    if not isinstance(condition, str) or str(fidelity) not in condition:
        issues.append(_problem(f"{base}.provenance.condition", "legacy_fidelity", "old native/proxy/custom fidelity must survive in provenance"))


def _validate_kernel_point(
    issues: list[RooflineProblem], point: Mapping, basis: Mapping, base: str
) -> None:
    traffic = point.get("traffic")
    timing = point.get("timing")
    if not isinstance(traffic, Mapping) or not isinstance(timing, Mapping):
        return
    expected_domain = {
        "system_memory_measured": "system_memory",
        "l2_measured": "l2",
    }.get(basis.get("traffic_basis"))
    if expected_domain is None or traffic.get("memory_domain") != expected_domain or traffic.get("value_kind") != "measured":
        issues.append(_problem(f"{base}.traffic", "kernel_traffic", "kernel points require measured traffic on the basis memory domain"))
    if not _is_number(timing.get("observed_second")) or timing.get("observed_second") <= 0:
        issues.append(_problem(f"{base}.timing.observed_second", "kernel_timing", "kernel points require a positive observed duration"))
    if basis.get("work_basis") not in {"runtime_executed_formula", "hardware_counter"}:
        issues.append(_problem(f"{base}.basis_id", "kernel_work", "kernel work must be executed-formula or counter based"))


def _validate_required_ceilings(
    issues: list[RooflineProblem], ceilings: Mapping[object, Mapping]
) -> None:
    required: dict[str, dict[str, tuple[float, str]]] = {
        "thor-t5000-published-max": {
            "tensor_fp8_e4m3_dense": (517e12, "published_fact"),
            "tensor_fp4_e2m1_dense": (1035e12, "published_fact"),
            "tensor_fp4_e2m1_sparse": (2070e12, "published_fact"),
            "tensor_fp16_sparse": (517e12, "published_fact"),
        },
        "thor-t5000-published-120w-rounded": {
            "tensor_fp8_e4m3_dense": (455e12, "published_fact"),
            "tensor_fp4_e2m1_dense": (910e12, "published_fact"),
        },
        "thor-t5000-120w-1386mhz": {
            "tensor_bf16_dense": (227.48e12, "mode_scaled_analytical"),
            "tensor_fp16_dense": (227.48e12, "mode_scaled_analytical"),
            "tensor_fp8_e4m3_dense": (454.96e12, "mode_scaled_analytical"),
            "tensor_nvfp4_e2m1_dense": (910.8e12, "mode_scaled_analytical"),
        },
        "thor-t5000-vla-perf-legacy": {
            "tensor_fp16_dense": (400e12, "legacy_tool_assumption"),
            "tensor_fp8_e4m3_dense": (800e12, "legacy_tool_assumption"),
        },
    }
    for ceiling_id, expected_compute in required.items():
        ceiling = ceilings.get(ceiling_id)
        if ceiling is None:
            issues.append(_broken(f"$.roofline_ceilings.{ceiling_id}"))
            continue
        compute = {
            item.get("compute_class"): item
            for item in _mapping_list(ceiling.get("compute"))
        }
        for compute_class, (expected_rate, expected_class) in expected_compute.items():
            item = compute.get(compute_class)
            provenance = item.get("provenance") if isinstance(item, Mapping) else None
            if (
                not isinstance(item, Mapping)
                or not _close(item.get("flop_per_second"), expected_rate)
                or not isinstance(provenance, Mapping)
                or provenance.get("class") != expected_class
            ):
                issues.append(_problem(f"$.roofline_ceilings.{ceiling_id}.compute.{compute_class}", "required_ceiling", "required rate or provenance class changed"))
    max_ceiling = ceilings.get("thor-t5000-published-max", {})
    if not _close(max_ceiling.get("operating_point", {}).get("gpu_clock_hz"), 1.575e9):
        issues.append(_problem("$.roofline_ceilings.thor-t5000-published-max.operating_point.gpu_clock_hz", "required_ceiling", "published MAXN GPU cap must remain 1.575 GHz"))
    bandwidth_requirements = (
        ("thor-t5000-published-max", 273e9, "published_fact"),
        ("thor-t5000-published-120w-rounded", 273e9, "published_fact"),
        ("thor-t5000-120w-1386mhz", 273e9, "mode_scaled_analytical"),
        ("thor-t5000-vla-perf-legacy", 270 * 2**30, "legacy_tool_assumption"),
    )
    for ceiling_id, expected_rate, expected_class in bandwidth_requirements:
        ceiling = ceilings.get(ceiling_id, {})
        items = _mapping_list(ceiling.get("bandwidth"))
        item = items[0] if len(items) == 1 else None
        provenance = item.get("provenance") if isinstance(item, Mapping) else None
        if (
            not isinstance(item, Mapping)
            or not _close(item.get("byte_per_second"), expected_rate)
            or not isinstance(provenance, Mapping)
            or provenance.get("class") != expected_class
        ):
            issues.append(_problem(f"$.roofline_ceilings.{ceiling_id}.bandwidth", "required_ceiling", "required bandwidth or provenance class changed"))
    scaled = ceilings.get("thor-t5000-120w-1386mhz", {})
    scaled_items = {
        item.get("compute_class"): item
        for item in _mapping_list(scaled.get("compute"))
    }
    nvfp4 = scaled_items.get("tensor_nvfp4_e2m1_dense", {})
    condition = nvfp4.get("provenance", {}).get("condition") if isinstance(nvfp4, Mapping) else None
    if not isinstance(condition, str) or "Mapping inference" not in condition:
        issues.append(_problem("$.roofline_ceilings.thor-t5000-120w-1386mhz.compute.tensor_nvfp4_e2m1_dense", "mapping_caveat", "NVFP4 must retain the generic-FP4 mapping-inference caveat"))


def _basis_has_observed_clocks(basis: Mapping, ceiling: Mapping | None) -> bool:
    if not isinstance(ceiling, Mapping):
        return False
    operating = ceiling.get("operating_point")
    if not isinstance(operating, Mapping) or operating.get("clock_basis") != "observed_locked":
        return False
    if not _is_number(operating.get("gpu_clock_hz")) or not _is_number(operating.get("emc_clock_hz")):
        return False
    bandwidth = next(
        (
            item for item in _mapping_list(ceiling.get("bandwidth"))
            if item.get("bandwidth_ceiling_id") == basis.get("bandwidth_ceiling_id")
        ),
        None,
    )
    required_emc = bandwidth.get("required_emc_clock_hz") if isinstance(bandwidth, Mapping) else None
    return required_emc is None or _close(required_emc, operating.get("emc_clock_hz"))


def _basis_has_sparsity_observation(
    basis: Mapping, runs: Mapping[object, Mapping]
) -> bool:
    """Require an execution observation, not a ceiling-mode assertion.

    The current run contract has no ``sparsity_on`` field, so sparse published
    facts remain inventory-only. This becomes eligible only if the exact run
    referenced by the basis carries an explicit true observation.
    """
    run = runs.get(basis.get("run_id"))
    operating = run.get("operating_point") if isinstance(run, Mapping) else None
    return isinstance(operating, Mapping) and operating.get("sparsity_on") is True


def _validate_source_refs(
    issues: list[RooflineProblem], value: object, path: str, source_ids: set[object]
) -> None:
    if isinstance(value, Mapping):
        if "source_ids" in value and "evidence" in value and "class" in value:
            refs = value.get("source_ids")
            if isinstance(refs, list):
                for index, source_id in enumerate(refs):
                    if source_id not in source_ids:
                        issues.append(_broken(f"{path}.source_ids[{index}]"))
        for key, child in value.items():
            _validate_source_refs(issues, child, f"{path}.{key}", source_ids)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _validate_source_refs(issues, child, f"{path}[{index}]", source_ids)


def _index(
    issues: list[RooflineProblem], records: Sequence[Mapping], field: str, dataset: str
) -> dict[object, Mapping]:
    result: dict[object, Mapping] = {}
    for index, record in enumerate(records):
        value = record.get(field)
        if value in result:
            issues.append(_problem(f"$.{dataset}[{index}].{field}", "duplicate", "primary identifier must be unique"))
        result[value] = record
    return result


def _mapping_list(value: object) -> list[Mapping]:
    return [item for item in value if isinstance(item, Mapping)] if isinstance(value, list) else []


def _has_missing(record: Mapping, field: str) -> bool:
    return any(item.get("field") == field for item in _mapping_list(record.get("missing")))


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _finite_nonnegative(value: object, label: str) -> float:
    if not _is_number(value) or value < 0:
        raise ValueError(f"{label} must be finite and nonnegative")
    return float(value)


def _finite_positive(value: object, label: str) -> float:
    result = _finite_nonnegative(value, label)
    if result <= 0:
        raise ValueError(f"{label} must be positive")
    return result


def _nonnegative_integer(value: object, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError(f"{label} must be a nonnegative integer")
    return value


def _close(left: object, right: object) -> bool:
    return _is_number(left) and _is_number(right) and math.isclose(
        float(left), float(right), rel_tol=REL_TOL, abs_tol=ABS_TOL
    )


def _problem(path: str, code: str, message: str) -> RooflineProblem:
    return RooflineProblem(path, code, message)


def _broken(path: str) -> RooflineProblem:
    return _problem(path, "broken_reference", "reference does not resolve")


def _missing(path: str) -> RooflineProblem:
    return _problem(path, "missing_reason_required", "a null value requires a controlled missing reason")
