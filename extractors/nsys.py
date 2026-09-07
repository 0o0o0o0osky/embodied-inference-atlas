from __future__ import annotations

import copy
import sqlite3
from collections import defaultdict
from collections.abc import Mapping, Sequence
from pathlib import Path
from urllib.parse import quote

from extractors.common import SourceFormatError, record_id
from extractors.profiler_common import (
    ProfilerImportContext,
    require_profiler_run,
)


_COMMON_COLUMNS: dict[str, set[str]] = {
    "CUPTI_ACTIVITY_KIND_KERNEL": {
        "start", "end", "demangledName", "gridX", "gridY", "gridZ",
        "blockX", "blockY", "blockZ", "registersPerThread",
        "staticSharedMemory", "dynamicSharedMemory",
    },
    "CUPTI_ACTIVITY_KIND_MEMCPY": {"start", "end", "bytes", "copyKind"},
    "CUPTI_ACTIVITY_KIND_RUNTIME": {"start", "end", "nameId"},
    "CUPTI_ACTIVITY_KIND_SYNCHRONIZATION": {
        "start", "end", "deviceId", "contextId", "streamId", "correlationId",
        "globalPid", "syncType",
    },
    "NVTX_EVENTS": {"start", "end", "text", "textId", "globalTid"},
    "OSRT_API": {"start", "end", "globalTid", "nameId", "returnValue", "nestingLevel"},
    "SCHED_EVENTS": {"start", "cpu", "isSchedIn", "globalTid", "threadState", "threadBlock"},
    "StringIds": {"id", "value"},
    "PROCESSES": {"globalPid", "name"},
    "ThreadNames": {"nameId", "globalTid"},
    "PROFILER_OVERHEAD": {"start", "end"},
    "META_DATA_EXPORT": {"name", "value"},
    "TARGET_INFO_SYSTEM_ENV": {"name", "value"},
}
_GRAPH_COLUMNS = {
    "CUPTI_ACTIVITY_KIND_GRAPH_TRACE": {"start", "end"},
    "CUDA_GRAPH_EVENTS": {"start", "end", "eventClass", "nameId"},
}
_NODE_COLUMNS = {
    "CUDA_GRAPH_NODE_EVENTS": {"start", "end", "eventClass", "nameId"},
}
_COPY_DIRECTIONS = {1: "h2d", 2: "d2h", 8: "d2d", 9: "h2h"}
_CONTROLLED_GRAPH_LABELS = {"vision-graph", "encoder-action-graph"}
_CONTROLLED_API_LABELS = {"cuda-device-synchronize", "cuda-stream-synchronize", "cuda-graph-launch"}


def parse_nsys_sqlite(
    connection: sqlite3.Connection,
    context: ProfilerImportContext,
    policy: Mapping[str, object],
) -> dict[str, object]:
    run = require_profiler_run(context, "nsys")
    _validate_policy(context, policy)
    try:
        connection.execute("PRAGMA query_only=ON")
        _validate_schema(connection, context, str(policy["report_mode"]))
        tool_version = _metadata_value(
            connection, "META_DATA_EXPORT", "EXPORT_PRODUCT_VERSION", context
        )
        schema_version = _metadata_value(
            connection, "META_DATA_EXPORT", "EXPORT_SCHEMA_VERSION", context
        )
        if schema_version != policy["sqlite_schema_version"]:
            raise SourceFormatError(f"{context.source_label}: incompatible Nsys export metadata")
        logical_cpu_count = _metadata_integer(
            connection, "TARGET_INFO_SYSTEM_ENV", "CpuCores", context
        )
        cpu_target_mhz = _metadata_integer(
            connection, "TARGET_INFO_SYSTEM_ENV", "CpuSpeedMhz", context
        )
        emc_target_mhz = _metadata_integer(
            connection, "TARGET_INFO_SYSTEM_ENV", "CpuEmcSpeedMhz", context
        )
        window_start, window_end, target_tid = _target_window(connection, context, policy)
        duration_ns = window_end - window_start

        scheduler = _scheduler_intervals(
            connection, window_start, window_end, target_tid, context, policy
        )
        graph_spans = _graph_spans(
            connection, window_start, window_end, context, policy
        )
        kernel_rows = _kernel_rows(
            connection, window_start, window_end, context,
            enabled=policy["report_mode"] == "node",
        )
        copy_rows = _copy_rows(connection, window_start, window_end, context)
        api_rows = _api_rows(connection, window_start, window_end, context, policy)
        overhead_rows = _overhead_rows(connection, window_start, window_end, context)
    except SourceFormatError:
        raise
    except sqlite3.Error as error:
        raise SourceFormatError(f"{context.source_label}: incompatible Nsys database") from error

    lanes: list[dict[str, object]] = []
    events: list[dict[str, object]] = []

    def lane(kind: str, role: str, coverage: str) -> str:
        lane_id = f"lane-{len(lanes) + 1:03d}"
        lanes.append({
            "lane_id": lane_id,
            "kind": kind,
            "role": role,
            "ordinal": len(lanes),
            "coverage": coverage,
        })
        return lane_id

    def event(
        lane_id: str,
        event_kind: str,
        label: str,
        start_ns: int,
        event_duration: int,
        *,
        signature_id: str | None = None,
        size_bytes: int | None = None,
        direction: str | None = None,
        semantics: str = "exact_interval",
    ) -> str:
        event_id = f"event-{len(events) + 1:05d}"
        events.append({
            "event_id": event_id,
            "lane_id": lane_id,
            "event_kind": event_kind,
            "label": label,
            "start_ns": start_ns,
            "duration_ns": event_duration,
            "count": 1,
            "kernel_signature_id": signature_id,
            "bytes": size_bytes,
            "copy_direction": direction,
            "evidence_semantics": semantics,
        })
        return event_id

    scheduler_lane_refs: dict[object, str] = {}
    scheduler_roles = ("target-main", "target-worker", "cuda-event-handler")
    for role in scheduler_roles:
        thread_keys = []
        for item in scheduler:
            if item[3] == role and item[4] not in thread_keys:
                thread_keys.append(item[4])
        for thread_key in thread_keys:
            scheduler_lane_refs[thread_key] = lane("cpu_thread", role, "complete")
    for role in ("non-profiler-all-processes", "profiler-excluded"):
        if any(item[3] == role for item in scheduler):
            scheduler_lane_refs[role] = lane(
                "cpu_aggregate", role, "excluded" if role == "profiler-excluded" else "complete"
            )
    scheduler_event_refs: dict[str, list[str]] = defaultdict(list)
    for start, end, _cpu, role, thread_key in scheduler:
        lane_key: object = thread_key if role in scheduler_roles else role
        ref = scheduler_lane_refs[lane_key]
        scheduler_event_refs[role].append(event(
            ref, "scheduler", "predict", start, end - start,
            semantics="scheduler_running_interval",
        ))

    api_lane = lane("cuda_api", "target-main", "complete") if api_rows else None
    api_refs: dict[str, list[str]] = defaultdict(list)
    if api_lane is not None:
        for start, end, label in api_rows:
            api_refs[label].append(event(api_lane, "cuda_api", label, start, end - start))

    graph_lane = lane("cuda_graph", "graph-execution", "complete") if graph_spans else None
    graph_refs: list[str] = []
    if graph_lane is not None:
        for start, end, label in graph_spans:
            graph_refs.append(event(
                graph_lane, "cuda_graph", label, start, end - start,
                semantics="cuda_graph_execution_span",
            ))

    rules = _signature_rules(policy)
    rule_by_name_id = {rule["demangled_name_id"]: rule for rule in rules}
    anchor_seen: set[int] = set()
    classified: dict[str, list[dict[str, int]]] = defaultdict(list)
    unclassified = 0
    kernel_lane = None
    if kernel_rows:
        for row in kernel_rows:
            raw_name_id = row["demangled_name_id"]
            rule = rule_by_name_id.get(raw_name_id)
            if rule is None:
                unclassified += 1
            else:
                if row["grid"] == rule["grid"] and row["block"] == rule["block"]:
                    anchor_seen.add(raw_name_id)
                signature = rule["signature"]
                assert isinstance(signature, Mapping)
                signature_id = signature["kernel_signature_id"]
                assert isinstance(signature_id, str)
                row["kernel_signature_id"] = signature_id
                classified[signature_id].append(row)
        if anchor_seen != set(rule_by_name_id):
            raise SourceFormatError(
                f"{context.source_label}: Nsys signature anchor not observed"
            )
        kernel_lane = lane(
            "gpu_kernel", "kernel-stream", "partial" if unclassified else "complete"
        )
        for row in kernel_rows:
            event(
                kernel_lane, "kernel", "kernel", row["start_ns"], row["duration_ns"],
                signature_id=row.get("kernel_signature_id"),
            )

    copy_lane = lane("gpu_memcpy", "copy-stream", "complete") if copy_rows else None
    if copy_lane is not None:
        for start, end, size_bytes, direction in copy_rows:
            event(
                copy_lane, "memcpy", "memcpy", start, end - start,
                size_bytes=size_bytes, direction=direction,
            )

    overhead_lane = lane("profiler_overhead", "profiler-excluded", "excluded") if overhead_rows else None
    if overhead_lane is not None:
        for start, end in overhead_rows:
            event(
                overhead_lane, "profiler_overhead", "predict", start, end - start,
            )

    summaries = _summaries(
        duration_ns=duration_ns,
        graph_spans=graph_spans,
        graph_lane=graph_lane,
        kernel_rows=kernel_rows,
        kernel_lane=kernel_lane,
        copy_rows=copy_rows,
        copy_lane=copy_lane,
        api_rows=api_rows,
        api_lane=api_lane,
        scheduler=scheduler,
        scheduler_lane_refs=scheduler_lane_refs,
        logical_cpu_count=logical_cpu_count,
    )
    missing = {"cpu_idle_conclusion": "not_computable_from_scheduler_activity"}
    if policy["report_mode"] == "graph":
        missing.update({
            "exact_gpu_busy_union": "graph_node_trace_not_collected",
            "gpu_kernel_lane": "not_collected_at_trace_mode",
        })
    if unclassified:
        missing["kernel_signature_coverage"] = "unclassified_raw_symbols"

    run_id = run["run_id"]
    assert isinstance(run_id, str)
    capture_id = record_id("capture", context, 1)
    timeline_id = record_id("timeline", context, 1)
    warnings = []
    if policy["report_mode"] == "node":
        warnings.extend(("intrusive_node_trace", "partial_kernel_signature_coverage"))
    if policy["scheduler_scope"] == "system_wide":
        warnings.append("profiler_scheduler_activity_present")
    capture = {
        "capture_id": capture_id,
        "run_id": run_id,
        "source_id": context.source_id,
        "evidence": "measured_local",
        "tool": "nsys",
        "tool_version": tool_version,
        "collection_scope": "prediction_window",
        "target_window_label": "predict",
        "target_window_count": 1,
        "selection_policy": "single_predict_window",
        "coverage": {
            "population": "one_profiled_prediction",
            "observed_count": 1,
            "is_complete_for_population": True,
        },
        "warnings": warnings,
        "nsys": {
            "report_mode": policy["report_mode"],
            "scheduler_scope": policy["scheduler_scope"],
            "logical_cpu_count": logical_cpu_count,
            "cuda_graph_trace_present": policy["report_mode"] == "graph",
            "graph_node_trace_present": policy["report_mode"] == "node",
            "scheduler_trace_present": True,
            "profiler_overhead_trace_present": True,
        },
        "ncu": None,
        "missing": {"ncu": "not_applicable"},
    }
    timeline = {
        "timeline_id": timeline_id,
        "capture_id": capture_id,
        "run_id": run_id,
        "source_id": context.source_id,
        "window": {"label": "predict", "start_ns": 0, "duration_ns": duration_ns},
        "time_basis": "relative_to_target_window_start",
        "lanes": lanes,
        "events": events,
        "summaries": summaries,
        "missing": missing,
    }
    signatures = []
    observations = []
    total_kernel_duration = sum(row["duration_ns"] for row in kernel_rows)
    for rule in rules:
        signature = copy.deepcopy(dict(rule["signature"]))
        signature["runtime_id"] = run["runtime_id"]
        signature["model_id"] = run["model_id"]
        signature_id = signature["kernel_signature_id"]
        rows = classified.get(signature_id, [])
        if not rows:
            continue
        signatures.append(signature)
        launch_missing: dict[str, str] = {"launch.waves_per_sm": "not_collected"}
        launch: dict[str, object] = {"waves_per_sm": None}
        for field in (
            "grid", "block", "registers_per_thread",
            "static_shared_memory_bytes", "dynamic_shared_memory_bytes",
        ):
            launch[field], uniform = _uniform(rows, field)
            if not uniform:
                launch_missing[f"launch.{field}"] = "varies_across_population"
        duration_sum = sum(row["duration_ns"] for row in rows)
        observations.append({
            "observation_id": record_id("kernel-observation", context, len(observations) + 1),
            "capture_id": capture_id,
            "run_id": run_id,
            "source_id": context.source_id,
            "kernel_signature_id": signature_id,
            "observation_kind": "nsys_window_aggregate",
            "population": "all_matching_launches_in_one_predict_window",
            "calls": len(rows),
            "duration": {"statistic": "sum", "value_ns": duration_sum, "sample_count": len(rows)},
            "launch": launch,
            "duration_share": {
                "value": duration_sum * 100 / total_kernel_duration,
                "unit": "percent",
                "denominator": "kernel_duration_sum",
            },
            "quality": ["intrusive_node_trace"],
            "missing": launch_missing,
        })

    operating = run["operating_point"]
    assert isinstance(operating, Mapping)
    telemetry = _nsys_telemetry(
        context, capture_id, run_id, operating["operating_point_id"],
        duration_ns, emc_target_mhz, cpu_target_mhz,
    )
    return {
        "bundle_version": "1.0.0",
        "source_label": context.source_label,
        "datasets": {
            "runs": [copy.deepcopy(dict(run))],
            "profiler_captures": [capture],
            "timelines": [timeline],
            "kernel_signatures": signatures,
            "kernel_observations": observations,
            "profiler_metrics": [],
            "operator_kernel_links": [],
            "telemetry": telemetry,
        },
    }


def import_nsys_sqlite(
    input_file: Path,
    context: ProfilerImportContext,
    policy: Mapping[str, object],
) -> dict[str, object]:
    uri = f"file:{quote(str(input_file.resolve()))}?mode=ro&immutable=1"
    try:
        connection = sqlite3.connect(uri, uri=True)
    except sqlite3.Error as error:
        raise SourceFormatError(f"{context.source_label}: unable to open Nsys database") from error
    try:
        return parse_nsys_sqlite(connection, context, policy)
    finally:
        connection.close()


def _validate_policy(context: ProfilerImportContext, policy: Mapping[str, object]) -> None:
    required = {
        "policy_id", "window_policy_id", "sqlite_schema_version", "report_mode",
        "scheduler_scope", "target_window_text", "graph_stage_labels",
        "cuda_api_labels", "profiler_process_names", "cuda_event_handler_names",
        "signature_rules",
    }
    valid = (
        set(policy) == required
        and policy.get("policy_id") == context.signature_policy_id
        and policy.get("window_policy_id") == context.window_policy_id
        and policy.get("sqlite_schema_version") == "3.20.3"
        and policy.get("report_mode") in {"graph", "node"}
        and policy.get("scheduler_scope") in {"process_tree", "system_wide"}
        and isinstance(policy.get("target_window_text"), str)
        and isinstance(policy.get("graph_stage_labels"), list)
        and set(policy["graph_stage_labels"]).issubset(_CONTROLLED_GRAPH_LABELS)
        and isinstance(policy.get("cuda_api_labels"), Mapping)
        and set(policy["cuda_api_labels"].values()).issubset(_CONTROLLED_API_LABELS)
        and isinstance(policy.get("profiler_process_names"), list)
        and all(isinstance(item, str) for item in policy["profiler_process_names"])
        and isinstance(policy.get("cuda_event_handler_names"), list)
        and all(isinstance(item, str) for item in policy["cuda_event_handler_names"])
        and isinstance(policy.get("signature_rules"), list)
    )
    if not valid:
        raise SourceFormatError(f"{context.source_label}: invalid Nsys policy")
    if policy["report_mode"] == "graph" and len(policy["graph_stage_labels"]) != 2:
        raise SourceFormatError(f"{context.source_label}: invalid Nsys policy")
    if policy["report_mode"] == "node" and policy["graph_stage_labels"]:
        raise SourceFormatError(f"{context.source_label}: invalid Nsys policy")
    _signature_rules(policy)


def _signature_rules(policy: Mapping[str, object]) -> list[Mapping]:
    output: list[Mapping] = []
    matches: set[tuple[object, ...]] = set()
    raw_name_ids: set[int] = set()
    signature_ids: set[str] = set()
    for rule in policy["signature_rules"]:
        if not isinstance(rule, Mapping) or set(rule) != {"demangled_name_id", "grid", "block", "signature"}:
            raise SourceFormatError("profiler: invalid Nsys signature policy")
        if (
            not isinstance(rule.get("demangled_name_id"), int)
            or isinstance(rule.get("demangled_name_id"), bool)
            or not _dimension(rule.get("grid"))
            or not _dimension(rule.get("block"))
            or not isinstance(rule.get("signature"), Mapping)
        ):
            raise SourceFormatError("profiler: invalid Nsys signature policy")
        signature = rule["signature"]
        signature_id = signature.get("kernel_signature_id")
        match = (
            rule["demangled_name_id"],
            *rule["grid"],
            *rule["block"],
        )
        if (
            not isinstance(signature_id, str)
            or match in matches
            or rule["demangled_name_id"] in raw_name_ids
            or signature_id in signature_ids
        ):
            raise SourceFormatError("profiler: ambiguous Nsys signature policy")
        matches.add(match)
        raw_name_ids.add(rule["demangled_name_id"])
        signature_ids.add(signature_id)
        output.append(rule)
    return output


def _validate_schema(
    connection: sqlite3.Connection, context: ProfilerImportContext, report_mode: str
) -> None:
    required = dict(_COMMON_COLUMNS)
    if report_mode == "graph":
        required.pop("CUPTI_ACTIVITY_KIND_KERNEL")
    required.update(_GRAPH_COLUMNS if report_mode == "graph" else _NODE_COLUMNS)
    tables = {
        row[0] for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }
    for table, columns in required.items():
        if table not in tables:
            raise SourceFormatError(f"{context.source_label}: incompatible Nsys {table} table")
        actual = {row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')}
        if not columns.issubset(actual):
            raise SourceFormatError(f"{context.source_label}: incompatible Nsys {table} table")


def _metadata_value(
    connection: sqlite3.Connection, table: str, name: str,
    context: ProfilerImportContext,
) -> str:
    rows = connection.execute(
        f'SELECT value FROM "{table}" WHERE name = ?', (name,)
    ).fetchall()
    if len(rows) != 1 or not isinstance(rows[0][0], str):
        raise SourceFormatError(f"{context.source_label}: invalid Nsys metadata")
    return rows[0][0]


def _metadata_integer(
    connection: sqlite3.Connection, table: str, name: str,
    context: ProfilerImportContext,
) -> int:
    value = _metadata_value(connection, table, name, context)
    try:
        result = int(value)
    except ValueError as error:
        raise SourceFormatError(f"{context.source_label}: invalid Nsys metadata") from error
    if result < 0:
        raise SourceFormatError(f"{context.source_label}: invalid Nsys metadata")
    return result


def _target_window(
    connection: sqlite3.Connection,
    context: ProfilerImportContext,
    policy: Mapping[str, object],
) -> tuple[int, int, int]:
    rows = connection.execute(
        """
        SELECT n.start, n.end, n.globalTid
        FROM NVTX_EVENTS AS n
        LEFT JOIN StringIds AS s ON s.id = n.textId
        WHERE COALESCE(n.text, s.value) = ?
        """,
        (policy["target_window_text"],),
    ).fetchall()
    if len(rows) != 1:
        raise SourceFormatError(f"{context.source_label}: invalid Nsys target window")
    start, end, global_tid = rows[0]
    if not all(isinstance(value, int) for value in (start, end, global_tid)) or end <= start:
        raise SourceFormatError(f"{context.source_label}: invalid Nsys target window")
    return start, end, global_tid


def _graph_spans(
    connection: sqlite3.Connection,
    window_start: int,
    window_end: int,
    context: ProfilerImportContext,
    policy: Mapping[str, object],
) -> list[tuple[int, int, str]]:
    if policy["report_mode"] != "graph":
        return []
    rows = connection.execute(
        """
        SELECT start, end
        FROM CUPTI_ACTIVITY_KIND_GRAPH_TRACE
        WHERE start < ? AND end > ?
        ORDER BY start, end
        """,
        (window_end, window_start),
    ).fetchall()
    labels = policy["graph_stage_labels"]
    if len(rows) != len(labels):
        raise SourceFormatError(f"{context.source_label}: invalid Nsys graph trace")
    output = []
    for (start, end), label in zip(rows, labels):
        clipped = _clip(start, end, window_start, window_end, context, "graph trace")
        output.append((*clipped, label))
    return output


def _kernel_rows(
    connection: sqlite3.Connection,
    window_start: int,
    window_end: int,
    context: ProfilerImportContext,
    *,
    enabled: bool,
) -> list[dict[str, object]]:
    if not enabled:
        return []
    rows = connection.execute(
        """
        SELECT start, end, demangledName,
               gridX, gridY, gridZ, blockX, blockY, blockZ,
               registersPerThread, staticSharedMemory, dynamicSharedMemory
        FROM CUPTI_ACTIVITY_KIND_KERNEL
        WHERE start < ? AND end > ?
        ORDER BY start, end
        """,
        (window_end, window_start),
    ).fetchall()
    output: list[dict[str, object]] = []
    for row_index, row in enumerate(rows, start=1):
        if not all(isinstance(value, int) for value in row):
            raise SourceFormatError(f"{context.source_label}: invalid Nsys kernel row {row_index}")
        start, end = _clip(row[0], row[1], window_start, window_end, context, "kernel")
        grid = list(row[3:6])
        block = list(row[6:9])
        if not _dimension(grid) or not _dimension(block):
            raise SourceFormatError(f"{context.source_label}: invalid Nsys kernel row {row_index}")
        output.append({
            "start_ns": start,
            "duration_ns": end - start,
            "demangled_name_id": row[2],
            "grid": grid,
            "block": block,
            "registers_per_thread": row[9],
            "static_shared_memory_bytes": row[10],
            "dynamic_shared_memory_bytes": row[11],
        })
    return output


def _copy_rows(
    connection: sqlite3.Connection,
    window_start: int,
    window_end: int,
    context: ProfilerImportContext,
) -> list[tuple[int, int, int, str]]:
    rows = connection.execute(
        """
        SELECT start, end, bytes, copyKind
        FROM CUPTI_ACTIVITY_KIND_MEMCPY
        WHERE start < ? AND end > ?
        ORDER BY start, end
        """,
        (window_end, window_start),
    ).fetchall()
    output = []
    for row_index, (start, end, size_bytes, copy_kind) in enumerate(rows, start=1):
        if not all(isinstance(value, int) for value in (start, end, size_bytes, copy_kind)) or size_bytes < 0:
            raise SourceFormatError(f"{context.source_label}: invalid Nsys memcpy row {row_index}")
        clipped = _clip(start, end, window_start, window_end, context, "memcpy")
        output.append((*clipped, size_bytes, _COPY_DIRECTIONS.get(copy_kind, "unknown")))
    return output


def _api_rows(
    connection: sqlite3.Connection,
    window_start: int,
    window_end: int,
    context: ProfilerImportContext,
    policy: Mapping[str, object],
) -> list[tuple[int, int, str]]:
    mapping = policy["cuda_api_labels"]
    assert isinstance(mapping, Mapping)
    if not mapping:
        return []
    placeholders = ",".join("?" for _ in mapping)
    rows = connection.execute(
        f"""
        SELECT r.start, r.end, s.value
        FROM CUPTI_ACTIVITY_KIND_RUNTIME AS r
        JOIN StringIds AS s ON s.id = r.nameId
        WHERE r.start < ? AND r.end > ? AND s.value IN ({placeholders})
        ORDER BY r.start, r.end
        """,
        (window_end, window_start, *mapping.keys()),
    ).fetchall()
    output = []
    for row_index, (start, end, raw_name) in enumerate(rows, start=1):
        if raw_name not in mapping:
            raise SourceFormatError(f"{context.source_label}: invalid Nsys CUDA API row {row_index}")
        clipped = _clip(start, end, window_start, window_end, context, "CUDA API")
        output.append((*clipped, mapping[raw_name]))
    return output


def _overhead_rows(
    connection: sqlite3.Connection,
    window_start: int,
    window_end: int,
    context: ProfilerImportContext,
) -> list[tuple[int, int]]:
    rows = connection.execute(
        """
        SELECT start, end FROM PROFILER_OVERHEAD
        WHERE start < ? AND end > ? ORDER BY start, end
        """,
        (window_end, window_start),
    ).fetchall()
    return [
        _clip(start, end, window_start, window_end, context, "profiler overhead")
        for start, end in rows
    ]


def target_thread_role(global_tid, target_tid, thread_name, handler_names=()):
    """Classify only explicit names; target-process membership alone is no task attribution."""
    if global_tid == target_tid:
        return "target-main"
    if thread_name in {"[NSys]", "[NSys Comms]", "CUPTI worker thread"}:
        return "profiler-excluded"
    if thread_name == "cuda-EvtHandlr" or thread_name in handler_names:
        return "cuda-event-handler"
    return "target-worker"


def _scheduler_intervals(
    connection: sqlite3.Connection,
    window_start: int,
    window_end: int,
    target_tid: int,
    context: ProfilerImportContext,
    policy: Mapping[str, object],
) -> list[tuple[int, int, int, str, object]]:
    process_rows = connection.execute(
        "SELECT globalPid, name FROM PROCESSES"
    ).fetchall()
    profiler_names = set(policy["profiler_process_names"])
    profiler_pids = {
        global_pid for global_pid, name in process_rows if name in profiler_names
    }
    thread_names = {
        global_tid: name
        for global_tid, name in connection.execute(
            """
            SELECT t.globalTid, s.value
            FROM ThreadNames AS t JOIN StringIds AS s ON s.id = t.nameId
            """
        )
    }
    target_pid = _global_pid(target_tid)
    handler_names = set(policy["cuda_event_handler_names"])
    rows = connection.execute(
        "SELECT start, cpu, isSchedIn, globalTid FROM SCHED_EVENTS ORDER BY start"
    ).fetchall()
    active: dict[tuple[int, int], int] = {}
    raw_intervals: list[tuple[int, int, int, int]] = []
    for row_index, (start, cpu, is_sched_in, global_tid) in enumerate(rows, start=1):
        if not all(isinstance(value, int) for value in (start, cpu, is_sched_in, global_tid)):
            raise SourceFormatError(f"{context.source_label}: invalid Nsys scheduler row {row_index}")
        key = (cpu, global_tid)
        if is_sched_in == 1:
            active[key] = start
        elif is_sched_in == 0:
            begin = active.pop(key, None)
            if begin is not None and start > begin:
                raw_intervals.append((begin, start, cpu, global_tid))
        else:
            raise SourceFormatError(f"{context.source_label}: invalid Nsys scheduler row {row_index}")
    for (cpu, global_tid), begin in active.items():
        if begin < window_end:
            raw_intervals.append((begin, window_end, cpu, global_tid))

    worker_ordinals: dict[int, int] = {}
    output: list[tuple[int, int, int, str, object]] = []
    for begin, end, cpu, global_tid in sorted(raw_intervals):
        if begin >= window_end or end <= window_start:
            continue
        start_ns, end_ns = _clip(begin, end, window_start, window_end, context, "scheduler")
        process_id = _global_pid(global_tid)
        if process_id == target_pid:
            role = target_thread_role(global_tid, target_tid, thread_names.get(global_tid), handler_names)
            if global_tid not in worker_ordinals:
                worker_ordinals[global_tid] = len(worker_ordinals)
            lane_key: object = (role, worker_ordinals[global_tid])
        elif process_id in profiler_pids:
            role = "profiler-excluded"
            lane_key = role
        else:
            role = "non-profiler-all-processes"
            lane_key = role
        output.append((start_ns, end_ns, cpu, role, lane_key))
    return output


def _summaries(
    *,
    duration_ns: int,
    graph_spans: list[tuple[int, int, str]],
    graph_lane: str | None,
    kernel_rows: list[dict[str, object]],
    kernel_lane: str | None,
    copy_rows: list[tuple[int, int, int, str]],
    copy_lane: str | None,
    api_rows: list[tuple[int, int, str]],
    api_lane: str | None,
    scheduler: list[tuple[int, int, int, str, object]],
    scheduler_lane_refs: Mapping[object, str],
    logical_cpu_count: int,
) -> list[dict[str, object]]:
    summaries: list[dict[str, object]] = []

    def add(name: str, value: float | int, unit: str, denominator: str, derivation: str, refs: list[str]) -> None:
        summaries.append({
            "metric_name": name, "value": value, "unit": unit,
            "denominator": denominator, "derivation_version": derivation,
            "input_refs": refs,
        })

    graph_intervals = [(start, end) for start, end, _ in graph_spans]
    graph_union = _union(graph_intervals)
    graph_measure = _measure(graph_union)
    if graph_lane is not None:
        add("cuda_graph_span_union", graph_measure, "ns", "predict_window", "interval-union-v1", [graph_lane])
        if len(graph_union) >= 2:
            gap = sum(max(0, right[0] - left[1]) for left, right in zip(graph_union, graph_union[1:]))
            add("inter_graph_gap", gap, "ns", "adjacent_graph_spans", "interval-gap-v1", [graph_lane])
        add("outside_graph_span_union", duration_ns - graph_measure, "ns", "predict_window", "interval-complement-v1", [graph_lane])
    if api_lane is not None:
        for label, metric_name in (
            ("cuda-device-synchronize", "cuda_device_synchronize_wall_duration"),
            ("cuda-graph-launch", "cuda_graph_launch_wall_duration"),
        ):
            intervals = [(start, end) for start, end, row_label in api_rows if row_label == label]
            if intervals:
                add(metric_name, sum(end - start for start, end in intervals), "ns", "predict_window", "interval-sum-v1", [api_lane])
    kernel_intervals = [
        (int(row["start_ns"]), int(row["start_ns"]) + int(row["duration_ns"]))
        for row in kernel_rows
    ]
    if kernel_lane is not None:
        add("kernel_duration_sum", sum(end - start for start, end in kernel_intervals), "ns", "predict_window", "interval-sum-v1", [kernel_lane])
    copy_intervals = [(start, end) for start, end, _, _ in copy_rows]
    gpu_refs = [ref for ref in (kernel_lane, copy_lane) if ref is not None]
    gpu_union = _union([*kernel_intervals, *copy_intervals])
    if kernel_lane is not None:
        add("recorded_gpu_activity_union", _measure(gpu_union), "ns", "predict_window", "interval-union-v1", gpu_refs)
    elif copy_lane is not None:
        add("recorded_copy_activity_union", _measure(_union(copy_intervals)), "ns", "predict_window", "interval-union-v1", [copy_lane])

    role_intervals: dict[str, list[tuple[int, int]]] = defaultdict(list)
    for start, end, _cpu, role, _key in scheduler:
        role_intervals[role].append((start, end))
    target_intervals = [
        interval for role in ("target-main", "target-worker", "cuda-event-handler")
        for interval in role_intervals.get(role, [])
    ]
    target_refs = sorted({
        ref for key, ref in scheduler_lane_refs.items()
        if isinstance(key, tuple) and key[0] in {"target-main", "target-worker", "cuda-event-handler"}
    })
    if target_intervals and target_refs:
        add("target_scheduled_core_time_over_full_window", _measure(target_intervals), "ns", "predict_window", "interval-sum-v1", target_refs)
    if kernel_lane is not None and target_intervals and target_refs:
        refs = [*target_refs, *gpu_refs]
        add(
            "target_scheduled_core_time_overlapping_recorded_gpu_activity",
            _intersection_sum(target_intervals, gpu_union),
            "ns", "recorded_gpu_activity_union", "interval-intersection-v1", refs,
        )
        add(
            "target_wall_overlap_with_recorded_gpu_activity",
            _measure(_intersection(_union(target_intervals), gpu_union)),
            "ns", "recorded_gpu_activity_union", "interval-intersection-v1", refs,
        )
    if graph_union:
        if target_intervals and target_refs:
            add("target_scheduled_core_time_overlapping_graph_spans", _intersection_sum(target_intervals, graph_union), "ns", "cuda_graph_span_union", "interval-intersection-v1", target_refs + [graph_lane])
        background = role_intervals.get("non-profiler-all-processes", [])
        background_ref = scheduler_lane_refs.get("non-profiler-all-processes")
        nonprof = [*target_intervals, *background]
        nonprof_refs = [*target_refs]
        if isinstance(background_ref, str):
            nonprof_refs.append(background_ref)
        if nonprof and nonprof_refs:
            core_time = _intersection_sum(nonprof, graph_union)
            refs = [*nonprof_refs, graph_lane]
            add("non_profiler_scheduled_core_time_during_graph_spans", core_time, "ns", "cuda_graph_span_union", "interval-intersection-v1", refs)
            add("non_profiler_equivalent_scheduled_cores_during_graph_spans", core_time / graph_measure, "cores", "cuda_graph_span_union", "interval-ratio-v1", refs)
            add("non_profiler_scheduled_capacity_share_during_graph_spans", core_time * 100 / (graph_measure * logical_cpu_count), "percent", "logical_cpu_capacity_during_graph_spans", "interval-ratio-v1", refs)
            wall = _measure(_intersection(_union(nonprof), graph_union))
            add("non_profiler_wall_overlap_with_graph_spans", wall, "ns", "cuda_graph_span_union", "interval-intersection-v1", refs)
        profiler = role_intervals.get("profiler-excluded", [])
        profiler_ref = scheduler_lane_refs.get("profiler-excluded")
        if profiler and isinstance(profiler_ref, str):
            add("profiler_scheduled_core_time_during_graph_spans", _intersection_sum(profiler, graph_union), "ns", "cuda_graph_span_union", "interval-intersection-v1", [profiler_ref, graph_lane])
    return summaries


def _nsys_telemetry(
    context: ProfilerImportContext,
    capture_id: str,
    run_id: str,
    operating_point_id: object,
    duration_ns: int,
    emc_target_mhz: int,
    cpu_target_mhz: int,
) -> list[dict[str, object]]:
    common = {
        "run_id": run_id,
        "capture_id": capture_id,
        "source_id": context.source_id,
        "operating_point_id": operating_point_id,
    }
    output = []
    for metric_name, value in (
        ("emc_target_environment_frequency", emc_target_mhz),
        ("cpu_target_environment_frequency", cpu_target_mhz),
    ):
        output.append({
            "telemetry_id": record_id("telemetry", context, len(output) + 1),
            **common,
            "record_kind": "metadata_snapshot",
            "alignment": "metadata_only",
            "window": None,
            "metric_name": metric_name,
            "samples": [],
            "summary": {"statistic": "metadata_value", "value": value, "unit": "MHz", "sample_count": 0},
            "evidence_semantics": "profiler_target_environment_metadata",
            "missing_reason": None,
        })
    for metric_name in ("observed_emc_frequency", "throttle_status"):
        output.append({
            "telemetry_id": record_id("telemetry", context, len(output) + 1),
            **common,
            "record_kind": "sampled_series",
            "alignment": "same_capture_relative_time",
            "window": {"start_ns": 0, "duration_ns": duration_ns},
            "metric_name": metric_name,
            "samples": [],
            "summary": None,
            "evidence_semantics": "observed_samples",
            "missing_reason": "not_collected",
        })
    return output


def _clip(
    start: object,
    end: object,
    window_start: int,
    window_end: int,
    context: ProfilerImportContext,
    kind: str,
) -> tuple[int, int]:
    if not isinstance(start, int) or not isinstance(end, int):
        raise SourceFormatError(f"{context.source_label}: invalid Nsys {kind} row")
    clipped_start = max(start, window_start)
    clipped_end = min(end, window_end)
    if clipped_end <= clipped_start:
        raise SourceFormatError(f"{context.source_label}: invalid Nsys {kind} row")
    return clipped_start - window_start, clipped_end - window_start


def _global_pid(global_tid: int) -> int:
    return global_tid & ~((1 << 24) - 1)


def _dimension(value: object) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 3
        and all(isinstance(item, int) and not isinstance(item, bool) and item > 0 for item in value)
    )


def _uniform(
    rows: Sequence[Mapping[str, object]], field: str
) -> tuple[object, bool]:
    values = [row.get(field) for row in rows]
    if values and all(value == values[0] for value in values):
        return copy.deepcopy(values[0]), True
    return None, False


def _union(intervals: Sequence[tuple[int, int]]) -> list[tuple[int, int]]:
    merged: list[tuple[int, int]] = []
    for start, end in sorted(intervals):
        if not merged or start > merged[-1][1]:
            merged.append((start, end))
        else:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
    return merged


def _intersection(
    left: Sequence[tuple[int, int]], right: Sequence[tuple[int, int]]
) -> list[tuple[int, int]]:
    output = []
    for left_start, left_end in left:
        for right_start, right_end in right:
            start, end = max(left_start, right_start), min(left_end, right_end)
            if end > start:
                output.append((start, end))
    return _union(output)


def _intersection_sum(
    intervals: Sequence[tuple[int, int]], union_intervals: Sequence[tuple[int, int]]
) -> int:
    return sum(
        max(0, min(end, union_end) - max(start, union_start))
        for start, end in intervals
        for union_start, union_end in union_intervals
    )


def _measure(intervals: Sequence[tuple[int, int]]) -> int:
    return sum(end - start for start, end in intervals)
