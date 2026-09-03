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
    return issues


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
