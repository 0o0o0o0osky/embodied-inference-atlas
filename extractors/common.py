from __future__ import annotations

import json
import re
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path


class SourceFormatError(ValueError):
    """A source error that never includes raw source values or paths."""


@dataclass(frozen=True)
class ImportContext:
    source_label: str
    source_id: str
    system_id: str | None


def read_jsonl(path: Path, *, source_label: str = "source") -> Iterator[dict]:
    """Yield JSON objects while keeping source paths and payloads out of errors."""
    validate_source_label(source_label)
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                try:
                    value = json.loads(line)
                except json.JSONDecodeError as error:
                    raise SourceFormatError(
                        f"{source_label}: invalid JSON at line {line_number}"
                    ) from error
                if not isinstance(value, dict):
                    raise SourceFormatError(
                        f"{source_label}: non-object JSON at line {line_number}"
                    )
                yield value
    except SourceFormatError:
        raise
    except OSError as error:
        raise SourceFormatError(f"{source_label}: unable to read JSONL") from error


def record_id(kind: str, context: ImportContext, index: int) -> str:
    validate_source_label(context.source_label)
    if index < 1:
        raise ValueError("record index must be positive")
    return f"{kind}-{context.source_label}-{index:03d}"


def validate_source_label(source_label: str) -> None:
    if not isinstance(source_label, str) or not re.fullmatch(r"[a-z0-9-]+", source_label):
        raise ValueError("source_label must be lowercase kebab-case")


def require_measured_system(context: ImportContext) -> None:
    validate_source_label(context.source_label)
    if context.system_id is None:
        raise SourceFormatError(f"{context.source_label}: measured import requires system")


def source_record(record: object, context: ImportContext) -> Mapping[str, object]:
    if not isinstance(record, Mapping):
        raise SourceFormatError(f"{context.source_label}: non-object record")
    return record


def statistics(value: object, context: ImportContext) -> list[dict[str, object]]:
    if not isinstance(value, Mapping):
        raise SourceFormatError(f"{context.source_label}: invalid timing statistics")
    output: list[dict[str, object]] = []
    for name in ("min", "mean", "p50", "p95", "max"):
        number = value.get(name)
        if not isinstance(number, (int, float)) or isinstance(number, bool) or number < 0:
            raise SourceFormatError(f"{context.source_label}: invalid timing statistics")
        output.append({"statistic": name, "value": number, "unit": "ms"})
    return output


def nonnegative_integer(value: object, context: ImportContext, record_type: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise SourceFormatError(f"{context.source_label}: invalid {record_type} record")
    return value
