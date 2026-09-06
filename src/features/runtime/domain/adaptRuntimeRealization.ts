import type { CanonicalRecord } from "../../../types/atlas";
import type {
  EvidenceRef,
  ExecutionGroup,
  LogicalTarget,
  PrecisionPath,
  RepeatSelector,
  RuntimeMapping,
  RuntimeRealizationRecord,
  RuntimeReuseDescriptor,
} from "./types";

type RawRecord = Record<string, unknown>;

function records(value: unknown): RawRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is RawRecord => typeof item === "object" && item !== null && !Array.isArray(item))
    : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Runtime realization contains an invalid string field");
  return value;
}

function nullableText(value: unknown): string | null {
  if (value === null) return null;
  return text(value);
}

function nullableInteger(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error("Runtime realization contains an invalid positive integer");
  }
  return Number(value);
}

function repeatSelector(raw: RawRecord): RepeatSelector {
  return {
    scopeRef: text(raw.scope_ref),
    selection: text(raw.selection) as RepeatSelector["selection"],
    indices: Array.isArray(raw.indices)
      ? raw.indices.filter((item): item is number => Number.isSafeInteger(item))
      : [],
  };
}

function repeatSelectors(value: unknown): RepeatSelector[] {
  return records(value).map(repeatSelector);
}

function logicalTarget(raw: RawRecord): LogicalTarget {
  return { ref: text(raw.ref), repeatSelectors: repeatSelectors(raw.repeat_selectors) };
}

function evidence(raw: RawRecord): EvidenceRef {
  return {
    evidenceId: text(raw.evidence_id),
    kind: text(raw.kind) as EvidenceRef["kind"],
    sourceId: nullableText(raw.source_id),
    revision: nullableText(raw.revision),
    locator: nullableText(raw.locator),
    runIds: strings(raw.run_ids),
    observationIds: strings(raw.observation_ids),
  };
}

function precisionPath(raw: RawRecord): PrecisionPath {
  return {
    precisionPathId: text(raw.precision_path_id),
    label: text(raw.label),
    weightDtype: nullableText(raw.weight_dtype),
    activationDtype: nullableText(raw.activation_dtype),
    accumulationDtype: nullableText(raw.accumulation_dtype),
    outputDtype: nullableText(raw.output_dtype),
    quantScheme: text(raw.quant_scheme),
    missingFields: strings(raw.missing_fields),
    missingReasonCode: nullableText(raw.missing_reason_code),
    evidenceIds: strings(raw.evidence_ids),
  };
}

function executionGroup(raw: RawRecord): ExecutionGroup {
  return {
    executionGroupId: text(raw.execution_group_id),
    label: text(raw.label),
    kind: text(raw.kind) as ExecutionGroup["kind"],
    implementation: nullableText(raw.implementation),
    precisionPathId: text(raw.precision_path_id),
    repeatSelectors: repeatSelectors(raw.repeat_selectors),
    dependencyGroupIds: strings(raw.dependency_group_ids),
    kernelSignatureIds: strings(raw.kernel_signature_ids),
    kernelResolution: text(raw.kernel_resolution) as ExecutionGroup["kernelResolution"],
    unmappedReasonCode: nullableText(raw.unmapped_reason_code),
    evidenceIds: strings(raw.evidence_ids),
  };
}

function mapping(raw: RawRecord): RuntimeMapping {
  return {
    mappingId: text(raw.mapping_id),
    logicalTargets: records(raw.logical_targets).map(logicalTarget),
    executionGroupIds: strings(raw.execution_group_ids),
    relation: text(raw.relation) as RuntimeMapping["relation"],
    path: text(raw.path) as RuntimeMapping["path"],
    certainty: text(raw.certainty) as RuntimeMapping["certainty"],
    method: text(raw.method) as RuntimeMapping["method"],
    confidence: text(raw.confidence) as RuntimeMapping["confidence"],
    reasonCode: nullableText(raw.reason_code),
    evidenceIds: strings(raw.evidence_ids),
  };
}

function optionalCost(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function reuseDescriptor(raw: RawRecord): RuntimeReuseDescriptor {
  return {
    reuseId: text(raw.reuse_id), label: text(raw.label),
    kind: text(raw.kind) as RuntimeReuseDescriptor["kind"],
    producerRefs: strings(raw.producer_refs), consumerRefs: strings(raw.consumer_refs),
    lifetime: text(raw.lifetime) as RuntimeReuseDescriptor["lifetime"],
    repeatScope: text(raw.repeat_scope), valueDependencies: strings(raw.value_dependencies),
    invalidationConditions: strings(raw.invalidation_conditions),
    implementationStatus: text(raw.implementation_status) as RuntimeReuseDescriptor["implementationStatus"],
    evidenceIds: strings(raw.evidence_ids), storageBytes: optionalCost(raw.storage_bytes),
    preparationNs: optionalCost(raw.preparation_ns), readNs: optionalCost(raw.read_ns),
  };
}

export function isRuntimeRealizationRecord(
  record: CanonicalRecord,
  modelId?: string,
): boolean {
  return (
    typeof record.realization_id === "string" &&
    typeof record.model_id === "string" &&
    (modelId === undefined || record.model_id === modelId) &&
    typeof record.model_graph_id === "string" &&
    Array.isArray(record.precision_paths) &&
    Array.isArray(record.execution_groups) &&
    Array.isArray(record.mappings)
  );
}

export function adaptRuntimeRealization(record: CanonicalRecord): RuntimeRealizationRecord {
  if (!isRuntimeRealizationRecord(record)) {
    throw new Error("The selected record is not a runtime realization");
  }
  const launch = record.launch as RawRecord;
  const workload = record.workload_applicability as RawRecord;
  return {
    reuse: records(record.reuse).map(reuseDescriptor),
    realizationId: text(record.realization_id),
    modelId: text(record.model_id),
    modelGraphId: text(record.model_graph_id),
    runtimeId: text(record.runtime_id),
    runtimeRevision: text(record.runtime_revision),
    availability: text(record.availability) as RuntimeRealizationRecord["availability"],
    availabilityReasonCode: text(record.availability_reason_code),
    mappingLevel: text(record.mapping_level) as RuntimeRealizationRecord["mappingLevel"],
    mappingCoverage: text(record.mapping_coverage) as RuntimeRealizationRecord["mappingCoverage"],
    modelArtifactIds: strings(record.model_artifact_ids),
    configurationIds: strings(record.configuration_ids),
    deviceIds: strings(record.device_ids),
    launch: {
      submissionMode: text(launch.submission_mode) as RuntimeRealizationRecord["launch"]["submissionMode"],
      cudaGraphState: text(launch.cuda_graph_state) as RuntimeRealizationRecord["launch"]["cudaGraphState"],
      captureScope: text(launch.capture_scope) as RuntimeRealizationRecord["launch"]["captureScope"],
      evidenceIds: strings(launch.evidence_ids),
    },
    workloadApplicability: {
      runtimeActionHorizon: nullableInteger(workload.runtime_action_horizon),
      runtimeInternalActionDimension: nullableInteger(workload.runtime_internal_action_dimension),
      publicActionHorizon: nullableInteger(workload.public_action_horizon),
      publicActionDimension: nullableInteger(workload.public_action_dimension),
      denoiseSteps: nullableInteger(workload.denoise_steps),
      missingReasonCode: nullableText(workload.missing_reason_code),
      evidenceIds: strings(workload.evidence_ids),
    },
    precisionPaths: records(record.precision_paths).map(precisionPath),
    evidence: records(record.evidence).map(evidence),
    executionGroups: records(record.execution_groups).map(executionGroup),
    mappings: records(record.mappings).map(mapping),
  };
}
