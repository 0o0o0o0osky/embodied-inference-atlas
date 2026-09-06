from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import PurePosixPath

from tools.lib.model_graph import materialize_model_graph


@dataclass(frozen=True)
class RuntimeRealizationProblem:
    path: str
    code: str
    message: str


def runtime_realization_problems(
    record: Mapping, model_graph: Mapping | None
) -> list[RuntimeRealizationProblem]:
    """Validate one closed realization against only its declared logical graph."""
    issues: list[RuntimeRealizationProblem] = []
    groups = _mapping_list(record.get("execution_groups"))
    mappings = _mapping_list(record.get("mappings"))
    precision_paths = _mapping_list(record.get("precision_paths"))
    evidence = _mapping_list(record.get("evidence"))

    group_ids = _unique_ids(issues, groups, "execution_group_id", "$.execution_groups")
    mapping_ids = _unique_ids(issues, mappings, "mapping_id", "$.mappings")
    precision_ids = _unique_ids(
        issues, precision_paths, "precision_path_id", "$.precision_paths"
    )
    evidence_ids = _unique_ids(issues, evidence, "evidence_id", "$.evidence")
    del mapping_ids

    logical_refs: set[str] = set()
    repeat_scopes: dict[str, _RepeatScope] = {}
    if model_graph is None:
        issues.append(
            RuntimeRealizationProblem(
                "$.model_graph_id",
                "broken_reference",
                "model graph reference does not resolve",
            )
        )
    else:
        graph_model_id = model_graph.get("model_id")
        if graph_model_id != record.get("model_id"):
            issues.append(
                RuntimeRealizationProblem(
                    "$.model_id",
                    "model_graph_mismatch",
                    "realization model must match its declared model graph",
                )
            )
        try:
            materialized = materialize_model_graph(model_graph)
        except (KeyError, TypeError, ValueError):
            materialized = None
            issues.append(
                RuntimeRealizationProblem(
                    "$.model_graph_id",
                    "invalid_model_graph",
                    "declared model graph could not be materialized",
                )
            )
        if isinstance(materialized, Mapping):
            logical_refs, repeat_scopes = _logical_index(materialized)

    reuse = _mapping_list(record.get("reuse"))
    _unique_ids(issues, reuse, "reuse_id", "$.reuse")
    for index, item in enumerate(reuse):
        base = f"$.reuse[{index}]"
        _check_ids(issues, f"{base}.evidence_ids", item.get("evidence_ids"), evidence_ids)
        for field in ("producer_refs", "consumer_refs"):
            _check_ids(issues, f"{base}.{field}", item.get(field), logical_refs | group_ids)
        if item.get("implementation_status") in {"implemented", "not_implemented"} and not _string_list(item.get("evidence_ids")):
            issues.append(RuntimeRealizationProblem(
                f"{base}.evidence_ids", "reuse_evidence",
                "known reuse implementation status requires evidence",
            ))

    used_groups: set[str] = set()
    for index, group in enumerate(groups):
        base = f"$.execution_groups[{index}]"
        precision_id = group.get("precision_path_id")
        if isinstance(precision_id, str) and precision_id not in precision_ids:
            issues.append(_broken(f"{base}.precision_path_id"))
        _check_ids(
            issues,
            f"{base}.dependency_group_ids",
            group.get("dependency_group_ids"),
            group_ids,
        )
        _check_ids(
            issues, f"{base}.evidence_ids", group.get("evidence_ids"), evidence_ids
        )
        group_id = group.get("execution_group_id")
        dependencies = _string_list(group.get("dependency_group_ids"))
        if isinstance(group_id, str) and group_id in dependencies:
            issues.append(
                RuntimeRealizationProblem(
                    f"{base}.dependency_group_ids",
                    "dependency_cycle",
                    "execution group cannot depend on itself",
                )
            )
        kernels = _string_list(group.get("kernel_signature_ids"))
        resolution = group.get("kernel_resolution")
        if resolution == "resolved" and not kernels:
            issues.append(
                RuntimeRealizationProblem(
                    f"{base}.kernel_signature_ids",
                    "kernel_resolution",
                    "resolved kernel groups require at least one signature",
                )
            )
        if resolution == "not_collected" and kernels:
            issues.append(
                RuntimeRealizationProblem(
                    f"{base}.kernel_signature_ids",
                    "kernel_resolution",
                    "not-collected kernel groups must keep signatures empty",
                )
            )
        _validate_repeat_selectors(
            issues,
            group.get("repeat_selectors"),
            repeat_scopes,
            None,
            f"{base}.repeat_selectors",
        )

    issues.extend(_dependency_cycle_problems(groups))

    relation_cardinality = {
        "preserved": (1, 1),
        "fused": (2, 1),
        "split": (1, 2),
        "eliminated": (1, 0),
        "opaque": (1, 1),
    }
    for index, mapping in enumerate(mappings):
        base = f"$.mappings[{index}]"
        targets = _mapping_list(mapping.get("logical_targets"))
        mapped_group_ids = _string_list(mapping.get("execution_group_ids"))
        used_groups.update(mapped_group_ids)
        _check_ids(
            issues, f"{base}.execution_group_ids", mapped_group_ids, group_ids
        )
        _check_ids(
            issues, f"{base}.evidence_ids", mapping.get("evidence_ids"), evidence_ids
        )
        relation = mapping.get("relation")
        minimums = relation_cardinality.get(relation)
        if minimums is not None and mapping.get("certainty") == "exact":
            logical_minimum, group_minimum = minimums
            valid = len(targets) >= logical_minimum and len(mapped_group_ids) >= group_minimum
            if relation in {"preserved", "split"}:
                valid = valid and len(targets) == 1
            if relation in {"preserved", "fused", "opaque"}:
                valid = valid and len(mapped_group_ids) == 1
            if relation == "eliminated":
                valid = valid and not mapped_group_ids and mapping.get("reason_code") is not None
            if relation == "opaque" and len(mapped_group_ids) == 1:
                opaque_group = next(
                    (
                        group
                        for group in groups
                        if group.get("execution_group_id") == mapped_group_ids[0]
                    ),
                    None,
                )
                valid = valid and opaque_group is not None and opaque_group.get("kind") == "opaque_region"
            if not valid:
                issues.append(
                    RuntimeRealizationProblem(
                        base,
                        "mapping_cardinality",
                        f"{relation} mapping has invalid logical/group cardinality",
                    )
                )
        if (
            mapping.get("certainty") == "exact"
            and len(targets) > 1
            and len(mapped_group_ids) > 1
        ):
            issues.append(
                RuntimeRealizationProblem(
                    base,
                    "invalid_many_to_many",
                    "exact many-to-many mappings must be coarsened or marked ambiguous",
                )
            )
        if mapping.get("certainty") == "ambiguous":
            if not targets and not mapped_group_ids:
                issues.append(
                    RuntimeRealizationProblem(
                        base,
                        "empty_ambiguous_mapping",
                        "ambiguous mapping cannot have both sides empty",
                    )
                )
            if mapping.get("reason_code") is None or mapping.get("confidence") == "high":
                issues.append(
                    RuntimeRealizationProblem(
                        base,
                        "ambiguous_mapping",
                        "ambiguous mappings require a reason and cannot claim high confidence",
                    )
                )
        if mapping.get("path") == "fallback" and (
            mapping.get("reason_code") is None or not _string_list(mapping.get("evidence_ids"))
        ):
            issues.append(
                RuntimeRealizationProblem(
                    base,
                    "fallback_condition",
                    "fallback mappings require a controlled reason and evidence",
                )
            )
        for target_index, target in enumerate(targets):
            target_base = f"{base}.logical_targets[{target_index}]"
            ref = target.get("ref")
            if isinstance(ref, str) and ref not in logical_refs:
                issues.append(
                    RuntimeRealizationProblem(
                        f"{target_base}.ref",
                        "broken_logical_reference",
                        "logical reference does not resolve in the record's model graph",
                    )
                )
            _validate_repeat_selectors(
                issues,
                target.get("repeat_selectors"),
                repeat_scopes,
                ref if isinstance(ref, str) else None,
                f"{target_base}.repeat_selectors",
            )

    for index, group in enumerate(groups):
        group_id = group.get("execution_group_id")
        unmapped = group.get("unmapped_reason_code")
        if isinstance(group_id, str):
            if group_id in used_groups and unmapped is not None:
                issues.append(
                    RuntimeRealizationProblem(
                        f"$.execution_groups[{index}].unmapped_reason_code",
                        "unexpected_unmapped_reason",
                        "mapped execution groups must not carry an unmapped reason",
                    )
                )
            if group_id not in used_groups and unmapped is None:
                issues.append(
                    RuntimeRealizationProblem(
                        f"$.execution_groups[{index}].unmapped_reason_code",
                        "unmapped_reason_required",
                        "unmapped execution groups require a reason",
                    )
                )

    for index, precision in enumerate(precision_paths):
        base = f"$.precision_paths[{index}]"
        nullable = ("weight_dtype", "activation_dtype", "accumulation_dtype", "output_dtype")
        declared_missing = set(_string_list(precision.get("missing_fields")))
        actual_missing = {field for field in nullable if precision.get(field) is None}
        if actual_missing != declared_missing:
            issues.append(
                RuntimeRealizationProblem(
                    f"{base}.missing_fields",
                    "precision_missing_fields",
                    "missing precision fields must exactly match null dtype fields",
                )
            )
        if bool(actual_missing) != (precision.get("missing_reason_code") is not None):
            issues.append(
                RuntimeRealizationProblem(
                    f"{base}.missing_reason_code",
                    "precision_missing_reason",
                    "missing precision fields require one controlled reason only",
                )
            )
        _check_ids(
            issues, f"{base}.evidence_ids", precision.get("evidence_ids"), evidence_ids
        )

    for index, item in enumerate(evidence):
        base = f"$.evidence[{index}]"
        kind = item.get("kind")
        locator = item.get("locator")
        run_ids = _string_list(item.get("run_ids"))
        observation_ids = _string_list(item.get("observation_ids"))
        if kind == "source_code":
            if not all(isinstance(item.get(field), str) for field in ("source_id", "revision", "locator")):
                issues.append(
                    RuntimeRealizationProblem(
                        base,
                        "source_evidence",
                        "source-code evidence requires source, revision, and locator",
                    )
                )
            if run_ids or observation_ids:
                issues.append(
                    RuntimeRealizationProblem(
                        base,
                        "source_evidence",
                        "source-code evidence cannot carry run or observation IDs",
                    )
                )
            if isinstance(locator, str) and not _safe_locator(locator):
                issues.append(
                    RuntimeRealizationProblem(
                        f"{base}.locator",
                        "unsafe_locator",
                        "source locator must be repository-relative path#symbol",
                    )
                )
        if kind == "canonical_run" and (not run_ids or locator is not None):
            issues.append(
                RuntimeRealizationProblem(
                    base,
                    "run_evidence",
                    "canonical-run evidence requires run IDs and no repository locator",
                )
            )

    if record.get("availability") == "not_supported":
        forbidden = (
            "model_artifact_ids",
            "configuration_ids",
            "execution_groups",
            "mappings",
        )
        if any(record.get(field) for field in forbidden):
            issues.append(
                RuntimeRealizationProblem(
                    "$",
                    "unsupported_payload",
                    "not-supported realizations cannot contain executable payload",
                )
            )

    workload = record.get("workload_applicability")
    if isinstance(workload, Mapping):
        fields = (
            "runtime_action_horizon",
            "runtime_internal_action_dimension",
            "public_action_horizon",
            "public_action_dimension",
            "denoise_steps",
        )
        has_missing = any(workload.get(field) is None for field in fields)
        if has_missing != (workload.get("missing_reason_code") is not None):
            issues.append(
                RuntimeRealizationProblem(
                    "$.workload_applicability.missing_reason_code",
                    "workload_missing_reason",
                    "missing workload applicability requires one controlled reason only",
                )
            )
        _check_ids(
            issues,
            "$.workload_applicability.evidence_ids",
            workload.get("evidence_ids"),
            evidence_ids,
        )
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
    for tensor_id in _string_list(materialized.get("graph_inputs")):
        refs.add(f"input/{tensor_id}")
    for tensor_id in _string_list(materialized.get("graph_outputs")):
        refs.add(f"output/{tensor_id}")
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
            if isinstance(stage_repeat, int):
                repeat_scopes[f"{stage_id}/{loop_id}"] = _RepeatScope(
                    stage_repeat, f"{stage_id}/"
                )
        for module in _mapping_list(stage.get("modules")):
            module_id = module.get("module_id")
            module_repeat = module.get("module_repeat")
            if not isinstance(module_id, str) or not isinstance(module_repeat, int):
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
    issues: list[RuntimeRealizationProblem],
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
            issues.append(
                RuntimeRealizationProblem(
                    f"{base}.scope_ref",
                    "broken_repeat_scope",
                    "repeat scope does not resolve in the record's model graph",
                )
            )
            continue
        if scope_ref in seen:
            issues.append(
                RuntimeRealizationProblem(
                    f"{base}.scope_ref", "duplicate", "repeat scope may appear only once"
                )
            )
        seen.add(scope_ref)
        scope = scopes[scope_ref]
        if target_ref is not None and not target_ref.startswith(scope.target_prefix):
            issues.append(
                RuntimeRealizationProblem(
                    f"{base}.scope_ref",
                    "repeat_scope_mismatch",
                    "repeat scope does not contain the logical target",
                )
            )
        valid_indices = (
            all(isinstance(item, int) and not isinstance(item, bool) and 0 <= item < scope.repeat for item in index_values)
            and len(index_values) == len(set(index_values))
        )
        if selection == "all" and index_values:
            valid_indices = False
        if selection == "indices" and not index_values:
            valid_indices = False
        if not valid_indices:
            issues.append(
                RuntimeRealizationProblem(
                    f"{base}.indices",
                    "invalid_repeat_selection",
                    "repeat indices must be unique, in range, and match selection mode",
                )
            )
        if target_ref is not None and scope.tail_start is not None:
            relative = target_ref.removeprefix(scope.target_prefix)
            if any(item >= scope.tail_start for item in index_values) and relative not in scope.tail_operator_refs:
                issues.append(
                    RuntimeRealizationProblem(
                        f"{base}.indices",
                        "invalid_tail_selection",
                        "selected tail index does not execute the logical operator",
                    )
                )


def _dependency_cycle_problems(groups: list[Mapping]) -> list[RuntimeRealizationProblem]:
    dependencies = {
        group_id: _string_list(group.get("dependency_group_ids"))
        for group in groups
        if isinstance((group_id := group.get("execution_group_id")), str)
    }
    visiting: set[str] = set()
    visited: set[str] = set()
    issues: list[RuntimeRealizationProblem] = []

    def visit(group_id: str) -> None:
        if group_id in visited:
            return
        if group_id in visiting:
            issues.append(
                RuntimeRealizationProblem(
                    "$.execution_groups",
                    "dependency_cycle",
                    "execution group dependencies must be acyclic",
                )
            )
            return
        visiting.add(group_id)
        for dependency in dependencies.get(group_id, []):
            if dependency in dependencies:
                visit(dependency)
        visiting.remove(group_id)
        visited.add(group_id)

    for group_id in dependencies:
        visit(group_id)
    return issues[:1]


def _unique_ids(
    issues: list[RuntimeRealizationProblem],
    values: list[Mapping],
    field: str,
    path: str,
) -> set[str]:
    seen: set[str] = set()
    for index, value in enumerate(values):
        identifier = value.get(field)
        if not isinstance(identifier, str):
            continue
        if identifier in seen:
            issues.append(
                RuntimeRealizationProblem(
                    f"{path}[{index}].{field}", "duplicate", "identifier must be unique"
                )
            )
        seen.add(identifier)
    return seen


def _check_ids(
    issues: list[RuntimeRealizationProblem], path: str, values: object, targets: set[str]
) -> None:
    for index, value in enumerate(_string_list(values)):
        if value not in targets:
            issues.append(_broken(f"{path}[{index}]"))


def _broken(path: str) -> RuntimeRealizationProblem:
    return RuntimeRealizationProblem(path, "broken_reference", "reference does not resolve")


def _safe_locator(locator: str) -> bool:
    path_text, separator, symbol = locator.partition("#")
    path = PurePosixPath(path_text)
    return bool(
        separator
        and symbol
        and path_text
        and not path.is_absolute()
        and ".." not in path.parts
        and path.parts[0] not in {"home", "Users"}
    )


def _mapping_list(value: object) -> list[Mapping]:
    return [item for item in value if isinstance(item, Mapping)] if isinstance(value, list) else []


def _string_list(value: object) -> list[str]:
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []
