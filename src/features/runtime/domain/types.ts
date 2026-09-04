import type { LogicalRef, NodeBox } from "../../model-graph/domain/types";

export type Availability = "measured" | "source_audited" | "unmeasured" | "not_supported";
export type MappingLevel = "custom_runtime" | "ggml_graph" | "pytorch_eager" | "kernel_correlated" | "none";
export type MappingRelation = "preserved" | "fused" | "split" | "eliminated" | "opaque";
export type MappingPath = "primary" | "fallback";
export type MappingCertainty = "exact" | "ambiguous";
export type Confidence = "high" | "medium" | "low";

export interface RepeatSelector {
  scopeRef: string;
  selection: "all" | "indices";
  indices: readonly number[];
}

export interface LogicalTarget {
  ref: LogicalRef;
  repeatSelectors: readonly RepeatSelector[];
}

export interface EvidenceRef {
  evidenceId: string;
  kind: "source_code" | "canonical_run" | "catalog_status" | "compiler_ir" | "runtime_trace" | "profiler_correlation";
  sourceId: string | null;
  revision: string | null;
  locator: string | null;
  runIds: readonly string[];
  observationIds: readonly string[];
}

export interface PrecisionPath {
  precisionPathId: string;
  label: string;
  weightDtype: string | null;
  activationDtype: string | null;
  accumulationDtype: string | null;
  outputDtype: string | null;
  quantScheme: string;
  missingFields: readonly string[];
  missingReasonCode: string | null;
  evidenceIds: readonly string[];
}

export interface ExecutionGroup {
  executionGroupId: string;
  label: string;
  kind: "framework_op" | "backend_op" | "custom_op" | "kernel_sequence" | "opaque_region";
  implementation: string | null;
  precisionPathId: string;
  repeatSelectors: readonly RepeatSelector[];
  dependencyGroupIds: readonly string[];
  kernelSignatureIds: readonly string[];
  kernelResolution: "resolved" | "partial" | "not_collected";
  unmappedReasonCode: string | null;
  evidenceIds: readonly string[];
}

export interface RuntimeMapping {
  mappingId: string;
  logicalTargets: readonly LogicalTarget[];
  executionGroupIds: readonly string[];
  relation: MappingRelation;
  path: MappingPath;
  certainty: MappingCertainty;
  method: "source_audit" | "compiler_ir" | "runtime_trace" | "profiler_correlation";
  confidence: Confidence;
  reasonCode: string | null;
  evidenceIds: readonly string[];
}

export interface WorkloadApplicability {
  runtimeActionHorizon: number | null;
  runtimeInternalActionDimension: number | null;
  publicActionHorizon: number | null;
  publicActionDimension: number | null;
  denoiseSteps: number | null;
  missingReasonCode: string | null;
  evidenceIds: readonly string[];
}

export interface RuntimeRealizationRecord {
  realizationId: string;
  modelId: string;
  modelGraphId: string;
  runtimeId: string;
  runtimeRevision: string;
  availability: Availability;
  availabilityReasonCode: string;
  mappingLevel: MappingLevel;
  mappingCoverage: "complete_at_level" | "partial" | "opaque" | "none";
  modelArtifactIds: readonly string[];
  configurationIds: readonly string[];
  deviceIds: readonly string[];
  launch: {
    submissionMode: "eager_dispatch" | "cuda_graph_replay" | "backend_graph_compute" | "none";
    cudaGraphState: "present" | "absent" | "unknown" | "not_applicable";
    captureScope: "stage_partitioned" | "whole_prediction" | "backend_managed" | "none" | "unknown";
    evidenceIds: readonly string[];
  };
  workloadApplicability: WorkloadApplicability;
  precisionPaths: readonly PrecisionPath[];
  evidence: readonly EvidenceRef[];
  executionGroups: readonly ExecutionGroup[];
  mappings: readonly RuntimeMapping[];
}

export interface RuntimeRealizationIndex {
  groupById: ReadonlyMap<string, ExecutionGroup>;
  mappingsByLogicalRef: ReadonlyMap<LogicalRef, readonly RuntimeMapping[]>;
  mappingsByGroupId: ReadonlyMap<string, readonly RuntimeMapping[]>;
  precisionById: ReadonlyMap<string, PrecisionPath>;
}

export interface RuntimeBadge {
  kind: "preserved" | "split" | "eliminated" | "opaque" | "ambiguous" | "fallback" | "precision";
  label: string;
  mappingId: string | null;
  groupId: string | null;
}

export interface RuntimeBoundary {
  fragmentId: string;
  groupId: string;
  nodeRefs: readonly LogicalRef[];
  box: NodeBox;
  relation: MappingRelation;
  certainty: MappingCertainty;
  precisionPathId: string;
}

export interface RuntimeOverlayModel {
  boundaries: readonly RuntimeBoundary[];
  badgesByNode: ReadonlyMap<LogicalRef, readonly RuntimeBadge[]>;
  highlightedLogicalRefs: ReadonlySet<LogicalRef>;
  highlightedGroupIds: ReadonlySet<string>;
  diagnostics: readonly string[];
}
