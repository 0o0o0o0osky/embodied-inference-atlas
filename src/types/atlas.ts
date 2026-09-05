export type EvidenceClass =
  | "measured_local"
  | "analytical"
  | "reported_external";

export interface ModelRecord {
  model_id: string;
  display_name: string;
  model_type: string;
  parameter_count: number | null;
  architecture_id: string;
  input_modalities: string[];
  output_modalities: string[];
  execution_modes: string[];
  artifacts: ModelArtifactRecord[];
}

export interface ModelArtifactRecord {
  artifact_id: string;
  label: string;
  public_model_id: string | null;
  public_revision: string | null;
}

export interface RuntimeSupportRecord {
  model_id: string;
  status: string;
  evidence: EvidenceClass;
  reason_code: string;
  has_canonical_measurement: boolean;
}

export interface RuntimeRecord {
  runtime_id: string;
  display_name: string;
  backend: string;
  model_support: RuntimeSupportRecord[];
}

export interface DeviceRecord {
  device_id: string;
  display_name: string;
  accelerator_architecture: string;
}

export interface SystemRecord {
  system_id: string;
  device_ids: string[];
}

export interface VlaWorkloadRecord {
  action_chunk: number | null;
  action_dimension: number | null;
  camera_views: number | null;
  denoise_steps: number | null;
  executed_prompt_tokens: number | null;
  image_height: number | null;
  image_width: number | null;
  semantic_prompt_tokens: number | null;
}

export interface WorkloadRecord {
  common: {
    batch_size: number;
    input_contract_id: string;
    output_contract_id: string;
  };
  vla?: VlaWorkloadRecord;
  world_model?: Record<string, never>;
  world_action_model?: Record<string, never>;
  hybrid?: Record<string, never>;
}

export interface PrecisionRecord {
  precision_id: string;
  requested: string;
  weight_dtype: string;
  activation_dtype: string;
  accumulation_dtype: string;
  execution_dtype: string;
  quant_scheme: string;
  granularity: string;
  scale_zero_point_bytes: number | null;
  dequant_strategy: string;
  fused: boolean;
}

export interface TimingRecord {
  timing_boundary_id: string;
  state_reuse: string;
  warm_policy: string;
  warmup_iterations: number | null;
}

export interface OperatingPointRecord {
  operating_point_id: string;
  power_mode: string | null;
  clock_policy: string | null;
  throttle_status: "none" | "observed" | "not_observed" | "unknown" | null;
}

export interface CorrectnessRecord {
  status: "passed" | "failed" | "not_assessed";
  criterion: string;
}

export interface ComparisonContextRecord {
  model_id: string;
  model_artifact_id: string;
  runtime_id: string;
  evidence: EvidenceClass;
  platform: {
    device_id: string;
    system_id: string | null;
    operating_point_id: string;
  };
  task: {
    task_id: string;
    input_contract_id: string;
    output_contract_id: string;
    correctness_policy_id: string;
  };
  workload: WorkloadRecord;
  precision: PrecisionRecord;
  timing: TimingRecord;
  runtime_overhead: string;
}

export interface RunRecord {
  schema_version: "1.0.0";
  run_id: string;
  configuration_id: string;
  model_id: string;
  model_artifact_id: string;
  runtime_id: string;
  device_id: string;
  system_id: string | null;
  source_id: string;
  evidence: EvidenceClass;
  capture_method: "wall_clock" | "cuda_event" | "nsys" | "ncu" | "telemetry" | "vla_perf" | "reported" | "derived";
  workload: WorkloadRecord;
  precision: PrecisionRecord;
  timing: TimingRecord;
  operating_point: OperatingPointRecord;
  correctness: CorrectnessRecord;
  comparison_context: ComparisonContextRecord;
  missing: Readonly<Record<string, string>>;
}

export type CanonicalRecord = Record<string, unknown>;

export interface AtlasDatasets {
  architectures: CanonicalRecord[];
  devices: DeviceRecord[];
  end_to_end: CanonicalRecord[];
  kernel_observations: CanonicalRecord[];
  kernel_signatures: CanonicalRecord[];
  models: ModelRecord[];
  model_graphs: CanonicalRecord[];
  operator_kernel_links: CanonicalRecord[];
  operators: CanonicalRecord[];
  profiler_captures: CanonicalRecord[];
  profiler_metrics: CanonicalRecord[];
  rooflines: CanonicalRecord[];
  roofline_bases: CanonicalRecord[];
  roofline_ceilings: CanonicalRecord[];
  roofline_points: CanonicalRecord[];
  roofline_scenarios: CanonicalRecord[];
  runtime_realizations: CanonicalRecord[];
  runs: RunRecord[];
  runtimes: RuntimeRecord[];
  sources: CanonicalRecord[];
  stages: CanonicalRecord[];
  systems: SystemRecord[];
  telemetry: CanonicalRecord[];
  timelines: CanonicalRecord[];
}

export interface AtlasData {
  format_version: "1.0.0";
  datasets: AtlasDatasets;
}

export interface EvidenceCounts {
  measured_local: number;
  analytical: number;
  reported_external: number;
}
