export type RooflineLevel = "stage" | "atomic" | "fused" | "kernel";
export type RooflineMode = "overview" | RooflineLevel;
export type ScenarioOrigin = "default_precomputed" | "interactive_analytical" | "captured_kernel" | "legacy_import";
export type PrecisionPathId =
  | "bf16_dense"
  | "fp16_dense"
  | "fp8_w8a8"
  | "nvfp4_w4a4"
  | "w8a16_bf16_compute"
  | "w4a16_bf16_compute"
  | "q8_0_weight_only_bf16_compute"
  | "runtime_mixed";
export type ComputeClass =
  | "tensor_bf16_dense"
  | "tensor_fp16_dense"
  | "tensor_fp8_e4m3_dense"
  | "tensor_fp4_e2m1_dense"
  | "tensor_nvfp4_e2m1_dense"
  | "tensor_fp16_sparse"
  | "tensor_fp4_e2m1_sparse"
  | "tensor_nvfp4_e2m1_sparse"
  | "scalar_fp32"
  | "sfu_exp_reciprocal";

export interface Derivation {
  kind: "divide_sparse_peak" | "scale_by_clock" | "scale_by_emc" | "legacy_copy" | "formula";
  expression: string;
  input_refs: readonly string[];
}

export interface Provenance {
  evidence: "measured_local" | "analytical" | "reported_external";
  class: "published_fact" | "mode_scaled_analytical" | "analytical_model" | "legacy_tool_assumption" | "measured_empirical" | "missing";
  source_ids: readonly string[];
  derivation: Derivation | null;
  condition: string | null;
}

export interface MissingValue {
  field: string;
  reason: string;
  detail: string;
}

export interface TensorEncoding {
  format: "fp32" | "bf16" | "fp16" | "fp8_e4m3" | "nvfp4_e2m1" | "int8_symmetric" | "int4_symmetric" | "q8_0";
  bits_per_value: 4 | 8 | 16 | 32;
  block_values: number | null;
  packed_data_bytes_per_block: number | null;
  scale_format: "none" | "fp16" | "fp32" | "fp8_e4m3" | "bf16";
  scale_bytes_per_block: number;
  zero_point_bytes_per_block: number;
  tensor_scale_bytes: number;
  padding: "none" | "pad_to_block";
  provenance: Provenance;
}

export interface PrecisionSegment {
  segment_id: string;
  selector: { kind: "all" | "logical_refs" | "execution_groups"; refs: readonly string[] };
  weight: TensorEncoding;
  activation: TensorEncoding;
  output: TensorEncoding;
  accumulator_dtype: "bf16" | "fp16" | "fp32";
  compute_class: ComputeClass;
  dequantization: {
    mode: "none" | "fused_to_bf16" | "materialized_bf16";
    floating_flop_per_weight: number;
    integer_op_per_weight: number;
    materialized_bytes_per_weight: number;
  };
}

export interface RooflineWorkload {
  batch_size: number;
  active_camera_views: number;
  executed_camera_views: number;
  raw_image_height: number | null;
  raw_image_width: number | null;
  executed_image_height: number | null;
  executed_image_width: number | null;
  semantic_prompt_tokens: number | null;
  executed_prompt_tokens: number;
  action_horizon: number;
  public_action_dimension: number | null;
  internal_action_dimension: number;
  denoise_steps: number;
  work_unit: "action_chunk";
}

export interface RooflineScenarioRecord {
  schema_version: "2.0.0";
  scenario_id: string;
  label: string;
  origin: ScenarioOrigin;
  model_id: string;
  model_graph_id: string | null;
  model_artifact_id: string;
  workload: RooflineWorkload;
  precision_path: {
    precision_path_id: PrecisionPathId;
    kind: "uniform" | "weight_only" | "mapped_mixed";
    segments: readonly PrecisionSegment[];
    runtime_support: "proven" | "unproven" | "unsupported" | "unknown";
    realization_ids: readonly string[];
  };
  modeling_scope: "ideal_analytical" | "implementation_modeled" | "legacy_component_envelope";
  provenance: Provenance;
  missing: readonly MissingValue[];
}

export interface RooflineBasisRecord {
  schema_version: "2.0.0";
  basis_id: string;
  label: string;
  level: RooflineLevel;
  scenario_id: string;
  precision_path_id: PrecisionPathId;
  ceiling_id: string;
  bandwidth_ceiling_id: string;
  device_id: string;
  operating_point_id: string;
  work_unit: "action_chunk" | "denoise_step" | "operator_invocation" | "execution_group" | "kernel_launch";
  time_basis: "analytical_roof" | "legacy_analytical_prediction" | "wall_clock" | "cuda_event" | "nsys_interval" | "ncu_kernel";
  traffic_basis: "atomic_materialized" | "fused_boundary_modeled" | "kernel_boundary_modeled" | "system_memory_measured" | "l2_measured" | "legacy_inverse_roofline" | "legacy_custom_resident_score";
  work_basis: "logical_formula" | "runtime_executed_formula" | "hardware_counter" | "legacy_component_aggregate";
  aggregation: "entity" | "dag_resource_and_critical_path";
  runtime_overhead: "included" | "excluded" | "not_applicable" | "unknown";
  runtime_id: string | null;
  realization_id: string | null;
  run_id: string | null;
  capture_id: string | null;
  comparison_mode: "inventory" | "same_coverage_only";
  provenance: Provenance;
  missing: readonly MissingValue[];
}

export interface ComputeCeiling {
  compute_ceiling_id: string;
  compute_class: ComputeClass;
  flop_per_second: number | null;
  requires_sparsity_on: boolean;
  provenance: Provenance;
}

export interface BandwidthCeiling {
  bandwidth_ceiling_id: string;
  memory_domain: "system_memory" | "l2" | "l1tex";
  byte_per_second: number | null;
  required_emc_clock_hz: number | null;
  provenance: Provenance;
}

export interface RooflineCeilingRecord {
  schema_version: "2.0.0";
  ceiling_id: string;
  label: string;
  device_id: string;
  operating_point: {
    operating_point_id: string;
    power_mode: "120W" | "maximum_specification" | null;
    gpu_clock_hz: number | null;
    emc_clock_hz: number | null;
    clock_basis: "published_max" | "mode_assumption" | "observed_locked" | "unknown";
    sparsity_on: boolean | null;
  };
  compute: readonly ComputeCeiling[];
  bandwidth: readonly BandwidthCeiling[];
  missing: readonly MissingValue[];
}

export interface WorkComponent {
  component_id: string;
  kind: string;
  compute_class: ComputeClass | null;
  flop: number;
  comparison_ops: number;
  transcendental_ops: number;
  integer_ops: number;
  provenance: Provenance;
}

export interface TrafficComponent {
  component_id: string;
  kind: string;
  byte: number;
  tensor_ref: string | null;
  provenance: Provenance;
}

export interface RooflinePointRecord {
  schema_version: "2.0.0";
  point_id: string;
  basis_id: string;
  entity: {
    kind: "model_total" | "stage" | "atomic_operator" | "execution_group" | "kernel" | "legacy_component";
    entity_id: string;
    label: string;
    shape_or_coverage: string;
    logical_refs: readonly string[];
    coverage_key: string;
  };
  calls: number;
  values_scope: "all_calls";
  work: { components: readonly WorkComponent[]; total_flop: number };
  traffic: {
    memory_domain: "system_memory" | "l2" | "l1tex";
    value_kind: "modeled" | "measured" | "legacy_derived";
    components: readonly TrafficComponent[];
    excluded_internal: readonly { tensor_ref: string; byte_avoided: number; evidence_ref: string }[];
    total_byte: number;
  };
  timing: {
    observed_second: number | null;
    statistic: "analytical" | "median" | "mean" | "single_observation" | "sum" | null;
    sample_count: number | null;
    timing_boundary_id: string;
  };
  aggregation: {
    member_point_ids: readonly string[];
    dependency_edges: readonly { source: string; target: string }[];
    dependency_lower_bound_second: number | null;
    resource_compute_lower_bound_second: number | null;
    resource_memory_lower_bound_second: number | null;
  };
  coverage: {
    status: "complete" | "partial" | "proxy" | "unmapped_legacy";
    included_refs: readonly string[];
    omitted: readonly { ref: string; reason: string }[];
  };
  derived: {
    status: "complete" | "partial_lower_bound" | "unavailable";
    arithmetic_intensity_flop_per_byte: number | null;
    compute_second: number | null;
    memory_second: number | null;
    roof_second: number | null;
    roof_flop_per_second: number | null;
    achieved_flop_per_second: number | null;
    efficiency: number | null;
    gap: number | null;
    limiter: "compute" | "memory" | "dependency" | "tie" | "unknown";
  };
  legacy_record_refs: readonly { dataset: "operators" | "rooflines"; record_id: string }[];
  provenance: Provenance;
  missing: readonly MissingValue[];
}
