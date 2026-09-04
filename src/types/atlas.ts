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
  artifacts: Array<{ artifact_id: string; label: string }>;
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

export interface RunRecord {
  run_id: string;
  configuration_id: string;
  model_id: string;
  model_artifact_id: string;
  runtime_id: string;
  device_id: string;
  evidence: EvidenceClass;
  precision: { precision_id: string };
  workload: {
    vla: {
      action_chunk: number;
      action_dimension: number;
      camera_views: number;
      denoise_steps: number | null;
      executed_prompt_tokens: number;
      image_height: number | null;
      image_width: number | null;
      semantic_prompt_tokens: number;
    };
  };
}

export type CanonicalRecord = Record<string, unknown>;

export interface AtlasDatasets {
  architectures: CanonicalRecord[];
  devices: DeviceRecord[];
  end_to_end: CanonicalRecord[];
  models: ModelRecord[];
  model_graphs: CanonicalRecord[];
  operators: CanonicalRecord[];
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
