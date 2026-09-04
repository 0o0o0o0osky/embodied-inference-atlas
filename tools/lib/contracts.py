from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from tools.lib.jsonio import load_json


@dataclass(frozen=True)
class Issue:
    path: str
    code: str
    message: str


def load_manifest(repo_root: Path) -> dict[str, object]:
    return load_json(repo_root / "schema" / "manifest.json")


def validate_document(
    dataset: str, document: Mapping[str, object], repo_root: Path
) -> list[Issue]:
    manifest = load_manifest(repo_root)
    datasets = manifest.get("datasets")
    if not isinstance(datasets, Mapping) or dataset not in datasets:
        return [Issue("$.dataset", "unknown_dataset", "dataset is not registered")]

    entry = datasets[dataset]
    if not isinstance(entry, Mapping) or not isinstance(entry.get("schema"), str):
        return [Issue("$.dataset", "invalid_manifest", "dataset schema is not configured")]

    schema = load_json(repo_root / entry["schema"])
    record_rule = schema.get("record")
    if not isinstance(record_rule, Mapping):
        return [Issue("$", "invalid_schema", "record contract is not configured")]

    wrapper_rule: dict[str, object] = {
        "type": "object",
        "required": ["schema_version", "dataset", "records"],
        "additional_properties": False,
        "properties": {
            "schema_version": {
                "type": "string",
                "enum": [manifest.get("schema_version")],
            },
            "dataset": {"type": "string", "enum": [dataset]},
            "records": {"type": "array", "items": record_rule},
        },
    }
    issues = _validate(document, wrapper_rule, "$")
    if not isinstance(document.get("records"), list):
        return issues

    primary_key = entry.get("primary_key")
    if not isinstance(primary_key, str):
        return issues + [Issue("$", "invalid_manifest", "primary key is not configured")]

    seen: set[str] = set()
    for index, record in enumerate(document["records"]):
        if not isinstance(record, Mapping):
            continue
        key = record.get(primary_key)
        if not isinstance(key, str):
            continue
        if key in seen:
            issues.append(
                Issue(
                    f"$.records[{index}].{primary_key}",
                    "duplicate",
                    "primary key must be unique",
                )
            )
        seen.add(key)
    for index, record in enumerate(document["records"]):
        if isinstance(record, Mapping):
            if dataset == "runs":
                issues.extend(_validate_run_semantics(record, f"$.records[{index}]"))
            elif dataset in {"end_to_end", "stages", "operators", "rooflines"}:
                issues.extend(
                    _validate_measurement_semantics(
                        dataset, record, f"$.records[{index}]"
                    )
                )
    return issues


def _validate_run_semantics(run: Mapping, path: str) -> list[Issue]:
    issues: list[Issue] = []
    workload = run.get("workload")
    comparison_context = run.get("comparison_context")
    context = comparison_context if isinstance(comparison_context, Mapping) else {}

    if isinstance(workload, Mapping):
        extensions = {
            "vla",
            "world_model",
            "world_action_model",
            "hybrid",
        } & workload.keys()
        if len(extensions) != 1:
            issues.append(
                Issue(
                    f"{path}.workload",
                    "workload_extension",
                    "workload must contain exactly one type extension",
                )
            )
        elif extensions != {"vla"}:
            issues.append(
                Issue(
                    f"{path}.workload",
                    "unsupported_workload",
                    "only vla workloads are supported by this schema version",
                )
            )

    copied_fields = (
        ("workload", workload, context.get("workload")),
        ("precision", run.get("precision"), context.get("precision")),
        ("timing", run.get("timing"), context.get("timing")),
    )
    for name, original, copied in copied_fields:
        if original != copied:
            issues.append(
                Issue(
                    f"{path}.comparison_context.{name}",
                    "context_mismatch",
                    f"comparison context {name} must equal the run value",
                )
            )

    platform = context.get("platform")
    platform = platform if isinstance(platform, Mapping) else {}
    operating_point = run.get("operating_point")
    operating_point = operating_point if isinstance(operating_point, Mapping) else {}
    common = workload.get("common") if isinstance(workload, Mapping) else {}
    common = common if isinstance(common, Mapping) else {}
    task = context.get("task")
    task = task if isinstance(task, Mapping) else {}
    correctness = run.get("correctness")
    correctness = correctness if isinstance(correctness, Mapping) else {}

    duplicated = (
        ("model_id", run.get("model_id"), context.get("model_id")),
        (
            "model_artifact_id",
            run.get("model_artifact_id"),
            context.get("model_artifact_id"),
        ),
        ("runtime_id", run.get("runtime_id"), context.get("runtime_id")),
        ("evidence", run.get("evidence"), context.get("evidence")),
        ("platform.device_id", run.get("device_id"), platform.get("device_id")),
        ("platform.system_id", run.get("system_id"), platform.get("system_id")),
        (
            "platform.operating_point_id",
            operating_point.get("operating_point_id"),
            platform.get("operating_point_id"),
        ),
        (
            "task.input_contract_id",
            common.get("input_contract_id"),
            task.get("input_contract_id"),
        ),
        (
            "task.output_contract_id",
            common.get("output_contract_id"),
            task.get("output_contract_id"),
        ),
        (
            "task.correctness_policy_id",
            correctness.get("criterion"),
            task.get("correctness_policy_id"),
        ),
    )
    for name, original, copied in duplicated:
        if original != copied:
            issues.append(
                Issue(
                    f"{path}.comparison_context.{name}",
                    "context_mismatch",
                    f"comparison context {name} must match the run",
                )
            )

    evidence = run.get("evidence")
    system_id = run.get("system_id")
    missing = run.get("missing")
    missing = missing if isinstance(missing, Mapping) else {}
    system_reasons = {
        "analytical": "analytical_no_physical_system",
        "reported_external": "reported_external_no_physical_system",
    }
    if system_id is None:
        if evidence == "measured_local":
            issues.append(
                Issue(
                    f"{path}.system_id",
                    "system_required",
                    "measured_local runs require a physical system",
                )
            )
        elif evidence in system_reasons:
            if missing.get("system_id") != system_reasons[evidence]:
                issues.append(
                    Issue(
                        f"{path}.missing.system_id",
                        "system_missing_reason",
                        "a null system requires a controlled missing reason",
                    )
                )
        else:
            issues.append(
                Issue(
                    f"{path}.system_id",
                    "system_required",
                    "a null system is limited to analytical or external evidence",
                )
            )
    elif "system_id" in missing:
        issues.append(
            Issue(
                f"{path}.missing.system_id",
                "unexpected_missing_reason",
                "a present system must not have a missing reason",
            )
        )

    if isinstance(workload, Mapping):
        vla = workload.get("vla")
        if isinstance(vla, Mapping):
            for field in (
                "camera_views",
                "image_height",
                "image_width",
                "semantic_prompt_tokens",
                "executed_prompt_tokens",
                "action_dimension",
                "action_chunk",
                "denoise_steps",
            ):
                if field in vla:
                    issues.extend(
                        _validate_missing_value(
                            vla[field],
                            missing,
                            f"workload.vla.{field}",
                            path,
                        )
                    )

    precision = run.get("precision")
    if isinstance(precision, Mapping) and "scale_zero_point_bytes" in precision:
        issues.extend(
            _validate_missing_value(
                precision["scale_zero_point_bytes"],
                missing,
                "precision.scale_zero_point_bytes",
                path,
            )
        )
    timing = run.get("timing")
    if isinstance(timing, Mapping) and "warmup_iterations" in timing:
        issues.extend(
            _validate_missing_value(
                timing["warmup_iterations"],
                missing,
                "timing.warmup_iterations",
                path,
            )
        )
    return issues


def _validate_measurement_semantics(
    dataset: str, record: Mapping, path: str
) -> list[Issue]:
    issues: list[Issue] = []
    if dataset in {"end_to_end", "stages"}:
        statistics = record.get("statistics")
        if isinstance(statistics, list):
            values = [
                item["value"]
                for item in statistics
                if isinstance(item, Mapping) and "value" in item
            ]
            if values:
                missing_reason = record.get("missing_reason")
                if any(value is None for value in values) and missing_reason is None:
                    issues.append(
                        Issue(
                            f"{path}.missing_reason",
                            "missing_reason_required",
                            "a null statistic requires a controlled missing reason",
                        )
                    )
                elif all(_is_number(value) for value in values) and missing_reason is not None:
                    issues.append(
                        Issue(
                            f"{path}.missing_reason",
                            "unexpected_missing_reason",
                            "present statistics must not have a missing reason",
                        )
                    )

    if dataset == "end_to_end" and record.get("evidence") == "analytical":
        statistics = record.get("statistics")
        canonical_statistics = (
            isinstance(statistics, list)
            and len(statistics) == 1
            and isinstance(statistics[0], Mapping)
            and statistics[0].get("statistic") == "analytical_estimate"
        )
        if (
            record.get("sample_count") != 0
            or record.get("percentile_method") is not None
            or not canonical_statistics
        ):
            issues.append(
                Issue(
                    path,
                    "analytical_measurement",
                    "analytical E2E records require one canonical estimate",
                )
            )

    missing_fields = {
        "operators": (
            "work_gflop",
            "traffic_gib",
            "arithmetic_intensity_flop_per_byte",
        ),
        "rooflines": (
            "compute_peak_gflop_per_s",
            "bandwidth_gib_per_s",
            "predicted_ms",
        ),
    }
    fields = missing_fields.get(dataset)
    missing = record.get("missing")
    if fields is not None and isinstance(missing, Mapping):
        for field in fields:
            if field in record:
                issues.extend(
                    _validate_missing_value(record[field], missing, field, path)
                )
    return issues


def _validate_missing_value(
    value: object, missing: Mapping, field: str, path: str
) -> list[Issue]:
    if value is None and field not in missing:
        return [
            Issue(
                f"{path}.missing.{field}",
                "missing_reason_required",
                "a null numeric value requires a controlled missing reason",
            )
        ]
    if _is_number(value) and field in missing:
        return [
            Issue(
                f"{path}.missing.{field}",
                "unexpected_missing_reason",
                "a present numeric value must not have a missing reason",
            )
        ]
    return []


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _validate(value: object, rule: Mapping[str, object], path: str) -> list[Issue]:
    issues = _validate_type(value, rule.get("type"), path)
    if issues:
        return issues
    if isinstance(value, Mapping):
        required = set(rule.get("required", []))
        properties = rule.get("properties", {})
        if not isinstance(properties, Mapping):
            return [Issue(path, "invalid_schema", "properties must be an object")]
        issues.extend(
            Issue(f"{path}.{key}", "required", "field is required")
            for key in sorted(required - value.keys())
        )
        if rule.get("additional_properties") is False:
            issues.extend(
                Issue(f"{path}.{key}", "unknown_field", "field is not allowed")
                for key in sorted(value.keys() - properties.keys())
            )
        for key in sorted(value.keys() & properties.keys()):
            child_rule = properties[key]
            if isinstance(child_rule, Mapping):
                issues.extend(_validate(value[key], child_rule, f"{path}.{key}"))
    elif isinstance(value, list) and "items" in rule:
        item_rule = rule["items"]
        if not isinstance(item_rule, Mapping):
            return [Issue(path, "invalid_schema", "items must be an object")]
        for index, item in enumerate(value):
            issues.extend(_validate(item, item_rule, f"{path}[{index}]"))
    issues.extend(_validate_constraints(value, rule, path))
    return issues


def _validate_type(value: object, expected: object, path: str) -> list[Issue]:
    if expected is None:
        return []
    names = [expected] if isinstance(expected, str) else expected
    if not isinstance(names, list) or not all(isinstance(name, str) for name in names):
        return [Issue(path, "invalid_schema", "type must be a string or string array")]
    if any(_matches_type(value, name) for name in names):
        return []
    return [Issue(path, "type", "value has an invalid type")]


def _matches_type(value: object, name: str) -> bool:
    return {
        "object": isinstance(value, Mapping),
        "array": isinstance(value, list),
        "string": isinstance(value, str),
        "integer": isinstance(value, int) and not isinstance(value, bool),
        "number": isinstance(value, (int, float)) and not isinstance(value, bool),
        "boolean": isinstance(value, bool),
        "null": value is None,
    }.get(name, False)


def _validate_constraints(
    value: object, rule: Mapping[str, object], path: str
) -> list[Issue]:
    issues: list[Issue] = []
    values = rule.get("enum")
    if isinstance(values, list) and value not in values:
        issues.append(Issue(path, "enum", "value is not permitted"))
    if isinstance(value, str):
        minimum = rule.get("min_length")
        maximum = rule.get("max_length")
        if isinstance(minimum, int) and len(value) < minimum:
            issues.append(Issue(path, "min_length", "string is too short"))
        if isinstance(maximum, int) and len(value) > maximum:
            issues.append(Issue(path, "max_length", "string is too long"))
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        minimum = rule.get("minimum")
        if isinstance(minimum, (int, float)) and value < minimum:
            issues.append(Issue(path, "minimum", "number is too small"))
    return issues
