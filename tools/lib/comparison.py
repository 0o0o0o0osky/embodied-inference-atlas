from __future__ import annotations

import copy
import json
from collections.abc import Mapping, Sequence


POLICY_VERSION = "1.0.0"
POLICY_REMOVALS = {
    "runtime": (("runtime_id",),),
    "precision": (("precision",),),
    "platform": (("platform",),),
    "measured_vs_bound": (
        ("runtime_id",),
        ("evidence",),
        ("runtime_overhead",),
        ("platform", "system_id"),
        ("platform", "operating_point_id"),
    ),
}


def comparison_key(
    context: Mapping, kind: str, varying_field: str | None = None
) -> str:
    projected = copy.deepcopy(dict(context))
    for path in _removals(kind, varying_field):
        _remove_path(projected, path)
    return json.dumps(projected, sort_keys=True, separators=(",", ":"))


def assign_group_ids(
    runs: Sequence[Mapping], kind: str, varying_field: str | None = None
) -> dict[str, str]:
    run_keys: dict[str, str] = {}
    for run in runs:
        run_id = run.get("run_id")
        context = run.get("comparison_context")
        if not isinstance(run_id, str) or not run_id:
            raise ValueError("every run must have a non-empty run_id")
        if run_id in run_keys:
            raise ValueError(f"duplicate run_id: {run_id}")
        if not isinstance(context, Mapping):
            raise ValueError(f"run {run_id} must have a comparison_context")
        run_keys[run_id] = comparison_key(context, kind, varying_field)

    labels = {
        key: f"cg-{kind}-{index:04d}"
        for index, key in enumerate(sorted(set(run_keys.values())), start=1)
    }
    return {run_id: labels[key] for run_id, key in run_keys.items()}


def ratio_eligibility(left: Mapping, right: Mapping) -> str:
    statuses = (
        _correctness_status(left),
        _correctness_status(right),
    )
    if "failed" in statuses:
        return "blocked_known_unequal"
    if statuses == ("passed", "passed"):
        return "validated_speedup"
    return "latency_ratio_unvalidated"


def _removals(kind: str, varying_field: str | None) -> tuple[tuple[str, ...], ...]:
    if kind == "workload_scale":
        if not isinstance(varying_field, str):
            raise ValueError("workload_scale requires varying_field")
        path = tuple(varying_field.split("."))
        if len(path) < 2 or path[0] != "workload" or any(not part for part in path):
            raise ValueError("varying_field must be one path beginning with workload.")
        return (path,)
    if varying_field is not None:
        raise ValueError("varying_field is only valid for workload_scale")
    try:
        return POLICY_REMOVALS[kind]
    except KeyError as error:
        raise ValueError(f"unknown comparison kind: {kind}") from error


def _remove_path(context: dict, path: tuple[str, ...]) -> None:
    parent = context
    for part in path[:-1]:
        child = parent.get(part)
        if not isinstance(child, dict):
            raise ValueError(f"comparison context is missing {'.'.join(path)}")
        parent = child
    if path[-1] not in parent:
        raise ValueError(f"comparison context is missing {'.'.join(path)}")
    del parent[path[-1]]


def _correctness_status(run: Mapping) -> object:
    correctness = run.get("correctness")
    if not isinstance(correctness, Mapping):
        return None
    return correctness.get("status")
