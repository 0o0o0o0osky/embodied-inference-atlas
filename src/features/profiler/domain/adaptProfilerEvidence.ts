import type { AtlasData, CanonicalRecord } from "../../../types/atlas";
import type {
  KernelObservation,
  KernelSignature,
  OperatorKernelLink,
  ProfilerCapture,
  ProfilerEvidence,
  ProfilerMetric,
  ProfilerMissing,
  TelemetryRecord,
  TimelineEvent,
  TimelineLane,
  TimelineRecord,
  TimelineSummary,
} from "./types";

type RawRecord = Record<string, unknown>;

function record(value: unknown, label: string): RawRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as RawRecord;
}

function records(value: unknown, label: string): RawRecord[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => record(item, `${label}[${index}]`));
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label);
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  const result = numberValue(value, label);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} must be a safe integer`);
  return result;
}

function nullableNumber(value: unknown, label: string): number | null {
  return value === null ? null : numberValue(value, label);
}

function nullableInteger(value: unknown, label: string): number | null {
  return value === null ? null : integer(value, label);
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => text(item, `${label}[${index}]`));
}

function integers(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => integer(item, `${label}[${index}]`));
}

function nullableIntegers(value: unknown, label: string): number[] | null {
  return value === null ? null : integers(value, label);
}

function missing(value: unknown, label: string): ProfilerMissing {
  const raw = record(value, label);
  return Object.fromEntries(
    Object.entries(raw).map(([key, item]) => [key, text(item, `${label}.${key}`)]),
  );
}

function adaptCapture(raw: CanonicalRecord): ProfilerCapture {
  const coverage = record(raw.coverage, "profiler capture coverage");
  const rawNsys = raw.nsys === null ? null : record(raw.nsys, "profiler capture nsys");
  const rawNcu = raw.ncu === null ? null : record(raw.ncu, "profiler capture ncu");
  const origins = rawNcu ? record(rawNcu.origins, "profiler capture ncu.origins") : null;
  return {
    captureId: text(raw.capture_id, "capture_id"),
    runId: text(raw.run_id, "capture run_id"),
    sourceId: text(raw.source_id, "capture source_id"),
    evidence: text(raw.evidence, "capture evidence") as ProfilerCapture["evidence"],
    tool: text(raw.tool, "capture tool") as ProfilerCapture["tool"],
    toolVersion: text(raw.tool_version, "capture tool_version"),
    collectionScope: text(raw.collection_scope, "capture collection_scope") as ProfilerCapture["collectionScope"],
    targetWindowLabel: nullableText(raw.target_window_label, "capture target_window_label") as ProfilerCapture["targetWindowLabel"],
    targetWindowCount: integer(raw.target_window_count, "capture target_window_count"),
    selectionPolicy: text(raw.selection_policy, "capture selection_policy") as ProfilerCapture["selectionPolicy"],
    coverage: {
      population: text(coverage.population, "capture coverage.population") as ProfilerCapture["coverage"]["population"],
      observedCount: integer(coverage.observed_count, "capture coverage.observed_count"),
      isCompleteForPopulation: booleanValue(coverage.is_complete_for_population, "capture coverage.is_complete_for_population"),
    },
    warnings: strings(raw.warnings, "capture warnings"),
    nsys: rawNsys ? {
      reportMode: text(rawNsys.report_mode, "capture nsys.report_mode") as NonNullable<ProfilerCapture["nsys"]>["reportMode"],
      schedulerScope: text(rawNsys.scheduler_scope, "capture nsys.scheduler_scope") as NonNullable<ProfilerCapture["nsys"]>["schedulerScope"],
      logicalCpuCount: integer(rawNsys.logical_cpu_count, "capture nsys.logical_cpu_count"),
      cudaGraphTracePresent: booleanValue(rawNsys.cuda_graph_trace_present, "capture nsys.cuda_graph_trace_present"),
      graphNodeTracePresent: booleanValue(rawNsys.graph_node_trace_present, "capture nsys.graph_node_trace_present"),
      schedulerTracePresent: booleanValue(rawNsys.scheduler_trace_present, "capture nsys.scheduler_trace_present"),
      profilerOverheadTracePresent: booleanValue(rawNsys.profiler_overhead_trace_present, "capture nsys.profiler_overhead_trace_present"),
    } : null,
    ncu: rawNcu && origins ? {
      replayMode: text(rawNcu.replay_mode, "capture ncu.replay_mode") as "kernel",
      replayPasses: integer(rawNcu.replay_passes, "capture ncu.replay_passes"),
      cacheControlRequest: text(rawNcu.cache_control_request, "capture ncu.cache_control_request") as "all",
      clockControlRequest: text(rawNcu.clock_control_request, "capture ncu.clock_control_request") as "base",
      warmupCount: integer(rawNcu.warmup_count, "capture ncu.warmup_count"),
      backingStoreBytes: nullableInteger(rawNcu.backing_store_bytes, "capture ncu.backing_store_bytes"),
      origins: {
        selectionPolicy: text(origins.selection_policy, "capture ncu.origins.selection_policy"),
        replayMode: text(origins.replay_mode, "capture ncu.origins.replay_mode"),
        replayPasses: text(origins.replay_passes, "capture ncu.origins.replay_passes"),
        cacheControlRequest: text(origins.cache_control_request, "capture ncu.origins.cache_control_request"),
        clockControlRequest: text(origins.clock_control_request, "capture ncu.origins.clock_control_request"),
        warmupCount: text(origins.warmup_count, "capture ncu.origins.warmup_count"),
        backingStoreBytes: text(origins.backing_store_bytes, "capture ncu.origins.backing_store_bytes"),
        gpuFrequencyNotFixed: text(origins.gpu_frequency_not_fixed, "capture ncu.origins.gpu_frequency_not_fixed"),
      },
    } : null,
    missing: missing(raw.missing, "capture missing"),
  };
}

function adaptLane(raw: RawRecord): TimelineLane {
  return {
    laneId: text(raw.lane_id, "timeline lane_id"),
    kind: text(raw.kind, "timeline lane kind") as TimelineLane["kind"],
    role: text(raw.role, "timeline lane role") as TimelineLane["role"],
    ordinal: integer(raw.ordinal, "timeline lane ordinal"),
    coverage: text(raw.coverage, "timeline lane coverage") as TimelineLane["coverage"],
  };
}

function adaptEvent(raw: RawRecord): TimelineEvent {
  return {
    eventId: text(raw.event_id, "timeline event_id"),
    laneId: text(raw.lane_id, "timeline event lane_id"),
    eventKind: text(raw.event_kind, "timeline event kind") as TimelineEvent["eventKind"],
    label: text(raw.label, "timeline event label"),
    startNs: integer(raw.start_ns, "timeline event start_ns"),
    durationNs: integer(raw.duration_ns, "timeline event duration_ns"),
    count: integer(raw.count, "timeline event count"),
    kernelSignatureId: nullableText(raw.kernel_signature_id, "timeline event kernel_signature_id"),
    bytes: nullableInteger(raw.bytes, "timeline event bytes"),
    copyDirection: nullableText(raw.copy_direction, "timeline event copy_direction") as TimelineEvent["copyDirection"],
    evidenceSemantics: text(raw.evidence_semantics, "timeline event evidence_semantics") as TimelineEvent["evidenceSemantics"],
  };
}

function adaptSummary(raw: RawRecord): TimelineSummary {
  return {
    metricName: text(raw.metric_name, "timeline summary metric_name"),
    value: numberValue(raw.value, "timeline summary value"),
    unit: text(raw.unit, "timeline summary unit") as TimelineSummary["unit"],
    denominator: text(raw.denominator, "timeline summary denominator"),
    derivationVersion: text(raw.derivation_version, "timeline summary derivation_version"),
    inputRefs: strings(raw.input_refs, "timeline summary input_refs"),
  };
}

function adaptTimeline(raw: CanonicalRecord): TimelineRecord {
  const window = record(raw.window, "timeline window");
  return {
    timelineId: text(raw.timeline_id, "timeline_id"),
    captureId: text(raw.capture_id, "timeline capture_id"),
    runId: text(raw.run_id, "timeline run_id"),
    sourceId: text(raw.source_id, "timeline source_id"),
    window: {
      label: text(window.label, "timeline window.label") as "predict",
      startNs: integer(window.start_ns, "timeline window.start_ns"),
      durationNs: integer(window.duration_ns, "timeline window.duration_ns"),
    },
    timeBasis: text(raw.time_basis, "timeline time_basis") as TimelineRecord["timeBasis"],
    lanes: records(raw.lanes, "timeline lanes").map(adaptLane),
    events: records(raw.events, "timeline events").map(adaptEvent),
    summaries: records(raw.summaries, "timeline summaries").map(adaptSummary),
    missing: missing(raw.missing, "timeline missing"),
  };
}

function adaptSignature(raw: CanonicalRecord): KernelSignature {
  const precision = record(raw.precision_path, "kernel signature precision_path");
  return {
    kernelSignatureId: text(raw.kernel_signature_id, "kernel_signature_id"),
    runtimeId: text(raw.runtime_id, "kernel signature runtime_id"),
    modelId: text(raw.model_id, "kernel signature model_id"),
    labelSanitized: text(raw.label_sanitized, "kernel signature label_sanitized"),
    functionFamily: text(raw.function_family, "kernel signature function_family") as KernelSignature["functionFamily"],
    implementationFamily: text(raw.implementation_family, "kernel signature implementation_family"),
    precisionPath: {
      inputDtypeClass: nullableText(precision.input_dtype_class, "kernel precision input_dtype_class") as KernelSignature["precisionPath"]["inputDtypeClass"],
      accumulatorDtypeClass: nullableText(precision.accumulator_dtype_class, "kernel precision accumulator_dtype_class") as KernelSignature["precisionPath"]["accumulatorDtypeClass"],
      outputDtypeClass: nullableText(precision.output_dtype_class, "kernel precision output_dtype_class") as KernelSignature["precisionPath"]["outputDtypeClass"],
      sparsity: text(precision.sparsity, "kernel precision sparsity") as KernelSignature["precisionPath"]["sparsity"],
      missing: missing(precision.missing, "kernel precision missing"),
    },
    classificationMethod: text(raw.classification_method, "kernel signature classification_method") as KernelSignature["classificationMethod"],
    classificationConfidence: text(raw.classification_confidence, "kernel signature classification_confidence") as KernelSignature["classificationConfidence"],
    missing: missing(raw.missing, "kernel signature missing"),
  };
}

function adaptObservation(raw: CanonicalRecord): KernelObservation {
  const duration = record(raw.duration, "kernel observation duration");
  const launch = record(raw.launch, "kernel observation launch");
  const share = raw.duration_share === null ? null : record(raw.duration_share, "kernel observation duration_share");
  return {
    observationId: text(raw.observation_id, "observation_id"),
    captureId: text(raw.capture_id, "kernel observation capture_id"),
    runId: text(raw.run_id, "kernel observation run_id"),
    sourceId: text(raw.source_id, "kernel observation source_id"),
    kernelSignatureId: text(raw.kernel_signature_id, "kernel observation kernel_signature_id"),
    observationKind: text(raw.observation_kind, "kernel observation kind") as KernelObservation["observationKind"],
    population: text(raw.population, "kernel observation population") as KernelObservation["population"],
    calls: integer(raw.calls, "kernel observation calls"),
    duration: {
      statistic: text(duration.statistic, "kernel observation duration.statistic") as KernelObservation["duration"]["statistic"],
      valueNs: integer(duration.value_ns, "kernel observation duration.value_ns"),
      sampleCount: integer(duration.sample_count, "kernel observation duration.sample_count"),
    },
    launch: {
      grid: nullableIntegers(launch.grid, "kernel observation launch.grid"),
      block: nullableIntegers(launch.block, "kernel observation launch.block"),
      registersPerThread: nullableInteger(launch.registers_per_thread, "kernel observation launch.registers_per_thread"),
      staticSharedMemoryBytes: nullableInteger(launch.static_shared_memory_bytes, "kernel observation launch.static_shared_memory_bytes"),
      dynamicSharedMemoryBytes: nullableInteger(launch.dynamic_shared_memory_bytes, "kernel observation launch.dynamic_shared_memory_bytes"),
      wavesPerSm: nullableNumber(launch.waves_per_sm, "kernel observation launch.waves_per_sm"),
    },
    durationShare: share ? {
      value: numberValue(share.value, "kernel observation duration_share.value"),
      unit: text(share.unit, "kernel observation duration_share.unit") as "percent",
      denominator: text(share.denominator, "kernel observation duration_share.denominator") as "kernel_duration_sum" | "window_duration",
    } : null,
    quality: strings(raw.quality, "kernel observation quality"),
    missing: missing(raw.missing, "kernel observation missing"),
  };
}

function adaptMetric(raw: CanonicalRecord): ProfilerMetric {
  const subject = record(raw.subject, "profiler metric subject");
  return {
    metricId: text(raw.metric_id, "metric_id"),
    captureId: text(raw.capture_id, "profiler metric capture_id"),
    runId: text(raw.run_id, "profiler metric run_id"),
    sourceId: text(raw.source_id, "profiler metric source_id"),
    subject: {
      kind: text(subject.kind, "profiler metric subject.kind") as ProfilerMetric["subject"]["kind"],
      id: text(subject.id, "profiler metric subject.id"),
    },
    metricName: text(raw.metric_name, "profiler metric metric_name") as ProfilerMetric["metricName"],
    rawCounterName: nullableText(raw.raw_counter_name, "profiler metric raw_counter_name"),
    sectionName: text(raw.section_name, "profiler metric section_name"),
    basis: text(raw.basis, "profiler metric basis"),
    statistic: text(raw.statistic, "profiler metric statistic") as ProfilerMetric["statistic"],
    value: nullableNumber(raw.value, "profiler metric value"),
    unit: text(raw.unit, "profiler metric unit") as ProfilerMetric["unit"],
    confidence: text(raw.confidence, "profiler metric confidence") as ProfilerMetric["confidence"],
    missingReason: nullableText(raw.missing_reason, "profiler metric missing_reason"),
  };
}

function adaptLink(raw: CanonicalRecord): OperatorKernelLink {
  const coverage = record(raw.coverage, "operator kernel link coverage");
  return {
    linkId: text(raw.link_id, "link_id"),
    observationId: text(raw.observation_id, "operator link observation_id"),
    kernelSignatureId: text(raw.kernel_signature_id, "operator link kernel_signature_id"),
    runId: text(raw.run_id, "operator link run_id"),
    modelGraphId: text(raw.model_graph_id, "operator link model_graph_id"),
    logicalTargets: records(raw.logical_targets, "operator link logical_targets").map((target) => ({
      ref: text(target.ref, "operator link logical target ref"),
      repeatSelectors: records(target.repeat_selectors, "operator link repeat_selectors").map((selector) => ({
        scopeRef: text(selector.scope_ref, "operator link repeat selector scope_ref"),
        selection: text(selector.selection, "operator link repeat selector selection") as "all" | "indices",
        indices: integers(selector.indices, "operator link repeat selector indices"),
      })),
    })),
    realizationId: nullableText(raw.realization_id, "operator link realization_id"),
    executionGroupIds: strings(raw.execution_group_ids, "operator link execution_group_ids"),
    mappingMethod: text(raw.mapping_method, "operator link mapping_method"),
    status: text(raw.status, "operator link status") as OperatorKernelLink["status"],
    confidence: text(raw.confidence, "operator link confidence") as OperatorKernelLink["confidence"],
    coverage: {
      mappedLaunches: integer(coverage.mapped_launches, "operator link coverage.mapped_launches"),
      populationLaunches: integer(coverage.population_launches, "operator link coverage.population_launches"),
      unit: text(coverage.unit, "operator link coverage.unit") as "launch",
    },
    evidenceIds: strings(raw.evidence_ids, "operator link evidence_ids"),
    reasonCode: nullableText(raw.reason_code, "operator link reason_code"),
  };
}

function adaptTelemetry(raw: CanonicalRecord): TelemetryRecord {
  const window = raw.window === null ? null : record(raw.window, "telemetry window");
  const summary = raw.summary === null ? null : record(raw.summary, "telemetry summary");
  return {
    telemetryId: text(raw.telemetry_id, "telemetry_id"),
    runId: text(raw.run_id, "telemetry run_id"),
    captureId: text(raw.capture_id, "telemetry capture_id"),
    sourceId: text(raw.source_id, "telemetry source_id"),
    operatingPointId: text(raw.operating_point_id, "telemetry operating_point_id"),
    recordKind: text(raw.record_kind, "telemetry record_kind") as TelemetryRecord["recordKind"],
    alignment: text(raw.alignment, "telemetry alignment") as TelemetryRecord["alignment"],
    window: window ? {
      startNs: integer(window.start_ns, "telemetry window.start_ns"),
      durationNs: integer(window.duration_ns, "telemetry window.duration_ns"),
    } : null,
    metricName: text(raw.metric_name, "telemetry metric_name") as TelemetryRecord["metricName"],
    samples: records(raw.samples, "telemetry samples").map((sample) => ({
      offsetNs: integer(sample.offset_ns, "telemetry sample offset_ns"),
      value: numberValue(sample.value, "telemetry sample value"),
      unit: text(sample.unit, "telemetry sample unit") as "MHz" | "percent",
    })),
    summary: summary ? {
      statistic: text(summary.statistic, "telemetry summary statistic") as "metadata_value" | "mean" | "max",
      value: numberValue(summary.value, "telemetry summary value"),
      unit: text(summary.unit, "telemetry summary unit") as "MHz" | "percent",
      sampleCount: integer(summary.sample_count, "telemetry summary sample_count"),
    } : null,
    evidenceSemantics: text(raw.evidence_semantics, "telemetry evidence_semantics") as TelemetryRecord["evidenceSemantics"],
    missingReason: nullableText(raw.missing_reason, "telemetry missing_reason"),
  };
}

export function adaptProfilerEvidence(data: AtlasData): ProfilerEvidence {
  return {
    captures: data.datasets.profiler_captures.map(adaptCapture),
    timelines: data.datasets.timelines.map(adaptTimeline),
    signatures: data.datasets.kernel_signatures.map(adaptSignature),
    observations: data.datasets.kernel_observations.map(adaptObservation),
    metrics: data.datasets.profiler_metrics.map(adaptMetric),
    links: data.datasets.operator_kernel_links.map(adaptLink),
    telemetry: data.datasets.telemetry.map(adaptTelemetry),
  };
}
