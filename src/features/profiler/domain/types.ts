export type ProfilerTool = "nsys" | "ncu";
export type ProfilerMissing = Readonly<Record<string, string>>;

export interface ProfilerCaptureCoverage {
  population: "one_profiled_prediction" | "one_replayed_launch";
  observedCount: number;
  isCompleteForPopulation: boolean;
}

export interface NsysCaptureDetails {
  reportMode: "graph" | "node";
  schedulerScope: "process_tree" | "system_wide";
  logicalCpuCount: number;
  cudaGraphTracePresent: boolean;
  graphNodeTracePresent: boolean;
  schedulerTracePresent: boolean;
  profilerOverheadTracePresent: boolean;
}

export interface NcuCaptureOrigins {
  selectionPolicy: string;
  replayMode: string;
  replayPasses: string;
  cacheControlRequest: string;
  clockControlRequest: string;
  warmupCount: string;
  backingStoreBytes: string;
  gpuFrequencyNotFixed: string | null;
  disableExtraSuffixes: string | null;
  externalClockControl: string | null;
}

export interface NcuCaptureDetails {
  replayMode: "kernel";
  replayPasses: number;
  cacheControlRequest: "all";
  clockControlRequest: "base" | "none";
  warmupCount: number;
  backingStoreBytes: number | null;
  disableExtraSuffixes: boolean | null;
  sectionMode: "scheduler_stats_with_sysmem_sectors" | "warp_state_stats" | null;
  sections: readonly string[] | null;
  explicitMetrics: readonly string[] | null;
  externalClockControl: { controller: string; state: string } | null;
  origins: NcuCaptureOrigins;
}

export interface ProfilerCapture {
  captureId: string;
  runId: string;
  sourceId: string;
  evidence: "measured_local";
  tool: ProfilerTool;
  toolVersion: string;
  collectionScope: "prediction_window" | "representative_kernel_launch";
  targetWindowLabel: "predict" | null;
  targetWindowCount: number;
  selectionPolicy: "explicit_invocation" | "name_filter_selected_match" | "single_predict_window";
  coverage: ProfilerCaptureCoverage;
  warnings: readonly string[];
  nsys: NsysCaptureDetails | null;
  ncu: NcuCaptureDetails | null;
  missing: ProfilerMissing;
}

export type TimelineLaneKind =
  | "cpu_thread"
  | "cpu_aggregate"
  | "cuda_api"
  | "cuda_graph"
  | "gpu_kernel"
  | "gpu_memcpy"
  | "profiler_overhead";

export interface TimelineLane {
  laneId: string;
  kind: TimelineLaneKind;
  role:
    | "target-main"
    | "target-worker"
    | "cuda-event-handler"
    | "non-profiler-all-processes"
    | "graph-execution"
    | "kernel-stream"
    | "copy-stream"
    | "profiler-excluded";
  ordinal: number;
  coverage: "complete" | "partial" | "excluded";
}

export type TimelineEventSemantics =
  | "exact_interval"
  | "cuda_graph_execution_span"
  | "scheduler_running_interval"
  | "aggregated_interval";

export interface TimelineEvent {
  eventId: string;
  laneId: string;
  eventKind: "scheduler" | "cuda_api" | "cuda_graph" | "kernel" | "memcpy" | "profiler_overhead";
  label: string;
  startNs: number;
  durationNs: number;
  count: number;
  kernelSignatureId: string | null;
  bytes: number | null;
  copyDirection: "h2d" | "d2h" | "d2d" | "h2h" | "unknown" | null;
  evidenceSemantics: TimelineEventSemantics;
}

export interface TimelineSummary {
  metricName: string;
  value: number;
  unit: "ns" | "percent" | "cores";
  denominator: string;
  derivationVersion: string;
  inputRefs: readonly string[];
}

export interface TimelineRecord {
  timelineId: string;
  captureId: string;
  runId: string;
  sourceId: string;
  window: {
    label: "predict";
    startNs: number;
    durationNs: number;
  };
  timeBasis: "relative_to_target_window_start";
  lanes: readonly TimelineLane[];
  events: readonly TimelineEvent[];
  summaries: readonly TimelineSummary[];
  missing: ProfilerMissing;
}

export interface KernelPrecisionPath {
  inputDtypeClass: "fp8_e4m3" | "fp16" | "fp32" | null;
  accumulatorDtypeClass: "fp16" | "fp32" | null;
  outputDtypeClass: "fp16" | "fp32" | null;
  sparsity: "on" | "off" | "unknown";
  missing: ProfilerMissing;
}

export interface KernelSignature {
  kernelSignatureId: string;
  runtimeId: string;
  modelId: string;
  labelSanitized: string;
  functionFamily: "gemm" | "attention" | "normalization" | "elementwise" | "quantize" | "copy" | "other";
  implementationFamily: string;
  precisionPath: KernelPrecisionPath;
  classificationMethod: "source_audit" | "allowlisted_symbol_rule" | "profiler_metric" | "combined";
  classificationConfidence: "high" | "medium" | "low" | "unknown";
  missing: ProfilerMissing;
}

export interface KernelLaunch {
  grid: readonly number[] | null;
  block: readonly number[] | null;
  registersPerThread: number | null;
  staticSharedMemoryBytes: number | null;
  dynamicSharedMemoryBytes: number | null;
  wavesPerSm: number | null;
}

export interface KernelObservation {
  observationId: string;
  captureId: string;
  runId: string;
  sourceId: string;
  kernelSignatureId: string;
  observationKind: "nsys_window_aggregate" | "nsys_launch" | "ncu_replayed_launch";
  population:
    | "all_matching_launches_in_one_predict_window"
    | "one_explicitly_selected_replayed_launch"
    | "one_name_filtered_selected_match_replayed_launch";
  calls: number;
  duration: {
    statistic: "single" | "sum";
    valueNs: number;
    sampleCount: number;
  };
  launch: KernelLaunch;
  durationShare: {
    value: number;
    unit: "percent";
    denominator: "kernel_duration_sum" | "window_duration";
  } | null;
  quality: readonly string[];
  missing: ProfilerMissing;
}

export type ProfilerMetricName =
  | "kernel_duration"
  | "sm_throughput_pct_of_peak_sustained_elapsed"
  | "tensor_cycles_active_pct_of_peak_sustained_elapsed"
  | "tensor_cycles_active_pct_of_peak_sustained_active"
  | "memory_sol_pct_of_peak_sustained_elapsed"
  | "memory_access_throughput_pct_of_peak_sustained_elapsed"
  | "l1tex_sector_hit_rate_percent"
  | "memory_request_throughput_pct_of_peak_sustained_elapsed"
  | "l2_sector_hit_rate_percent"
  | "memory_pipes_throughput_pct_of_peak_sustained_elapsed"
  | "l1_throughput_pct_of_peak_sustained_active"
  | "l2_throughput_pct_of_peak_sustained_elapsed"
  | "l2_sysmem_fill_pct_of_peak_sustained_elapsed"
  | "theoretical_occupancy_percent"
  | "achieved_occupancy_percent"
  | "gpc_cycle_rate_hz"
  | "sm_cycle_rate_hz"
  | "tensor_path_fp4_fp6_fp8_to_fp32_dense_pct_of_peak_elapsed"
  | "system_memory_throughput_pct_of_ceiling"
  | "system_memory_bytes"
  | "scheduler_issue_active_percent"
  | "scheduler_issue_active_per_active_cycle"
  | "scheduler_issue_active_pct_of_peak_sustained_active"
  | "scheduler_issue_inst0_percent"
  | "scheduler_active_warps_per_active_cycle"
  | "scheduler_eligible_warps_per_active_cycle"
  | "scheduler_maximum_warps_per_active_cycle"
  | "scheduler_warps_active_peak_sustained"
  | "l2_sysmem_fill_sectors"
  | "l2_sysmem_write_sectors"
  | "l2_sysmem_lookup_miss_sectors"
  | "average_warp_latency_cycles_per_issued_instruction"
  | "long_scoreboard_cycles_per_issued_instruction"
  | "short_scoreboard_cycles_per_issued_instruction"
  | "warp_stall_long_scoreboard_percent"
  | "warp_stall_short_scoreboard_percent"
  | "source_counter_attribution";

export interface ProfilerMetric {
  metricId: string;
  captureId: string;
  runId: string;
  sourceId: string;
  subject: {
    kind: "capture" | "timeline" | "kernel_observation";
    id: string;
  };
  metricName: ProfilerMetricName;
  rawCounterName: string | null;
  sectionName: string;
  basis: string;
  statistic: "single" | "sum" | "metadata_value";
  value: number | null;
  unit: "ns" | "percent" | "byte" | "count" | "hz" | "MHz" | "warp_per_cycle" | "warp" | "sector" | "cycles_per_instruction";
  confidence: "high" | "medium" | "low" | "unknown";
  missingReason: string | null;
}

export interface OperatorKernelLink {
  linkId: string;
  observationId: string;
  kernelSignatureId: string;
  runId: string;
  modelGraphId: string;
  logicalTargets: readonly {
    ref: string;
    repeatSelectors: readonly {
      scopeRef: string;
      selection: "all" | "indices";
      indices: readonly number[];
    }[];
  }[];
  realizationId: string | null;
  executionGroupIds: readonly string[];
  mappingMethod: string;
  status: "resolved" | "partial" | "ambiguous" | "unknown";
  confidence: "high" | "medium" | "low" | "unknown";
  coverage: { mappedLaunches: number; populationLaunches: number; unit: "launch" };
  evidenceIds: readonly string[];
  reasonCode: string | null;
}

export interface TelemetryRecord {
  telemetryId: string;
  runId: string;
  captureId: string;
  sourceId: string;
  operatingPointId: string;
  recordKind: "metadata_snapshot" | "sampled_series" | "sampled_summary";
  alignment: "same_capture_relative_time" | "same_run_unaligned" | "separate_run" | "metadata_only";
  window: { startNs: number; durationNs: number } | null;
  metricName: "emc_target_environment_frequency" | "cpu_target_environment_frequency" | "observed_emc_frequency" | "observed_gpu_frequency" | "observed_junction_temperature" | "observed_gpu_power" | "throttle_status";
  measurementSource: string | null;
  samples: readonly { offsetNs: number; value: number; unit: "MHz" | "percent" | "celsius" | "watt" | "mW" }[];
  summary: { statistic: "metadata_value" | "mean" | "max"; value: number; unit: "MHz" | "percent" | "celsius" | "watt" | "mW"; sampleCount: number } | null;
  evidenceSemantics: "profiler_target_environment_metadata" | "observed_samples";
  missingReason: string | null;
}

export interface ProfilerEvidence {
  captures: readonly ProfilerCapture[];
  timelines: readonly TimelineRecord[];
  signatures: readonly KernelSignature[];
  observations: readonly KernelObservation[];
  metrics: readonly ProfilerMetric[];
  links: readonly OperatorKernelLink[];
  telemetry: readonly TelemetryRecord[];
}
