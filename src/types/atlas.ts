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
  model_id: string;
  runtime_id: string;
  device_id: string;
  evidence: EvidenceClass;
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
