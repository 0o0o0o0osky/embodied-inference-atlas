import type { RoutePatch, RouteState } from "../../../app/routes";
import type { AtlasData } from "../../../types/atlas";
import { logicalRefFromEntity, parseEntityKey } from "../../workbench/entityKeys";
import {
  createModelCapabilityRegistry,
  modelCapabilityPair,
  modelWorkloadIsCompatible,
  type ModelCapabilities,
  type ModelCapabilityRegistry,
} from "../../workbench/modelCapabilities";

function entityIsCompatible(capabilities: ModelCapabilities, entity: string | null): boolean {
  const parsed = parseEntityKey(entity);
  if (!parsed) return false;
  if (parsed.kind === "logical") {
    const ref = logicalRefFromEntity(entity);
    return ref !== null && capabilities.logicalRefs.has(ref);
  }
  if (parsed.kind === "stage") {
    return parsed.modelGraphId === capabilities.modelGraphId && capabilities.stageIds.has(parsed.stageId);
  }
  if (parsed.kind === "runtime-group") {
    return capabilities.realizationGroups.has(modelCapabilityPair(parsed.realizationId, parsed.executionGroupId));
  }
  if (parsed.kind === "kernel") {
    return capabilities.kernelObservations.has(modelCapabilityPair(parsed.captureId, parsed.kernelObservationId));
  }
  if (parsed.kind === "timeline-event") {
    return capabilities.timelineEvents.has(modelCapabilityPair(parsed.timelineId, parsed.eventId));
  }
  if (parsed.kind === "run") return capabilities.runIds.has(parsed.runId);
  return capabilities.legacyPointIds.has(parsed.pointId);
}

export function modelSwitchPatch(
  data: AtlasData,
  modelId: string,
  current: RouteState,
  registry: ModelCapabilityRegistry = createModelCapabilityRegistry(data),
): RoutePatch {
  const capabilities = registry.get(modelId);
  if (!capabilities) {
    return {
      model: modelId,
      runtime: null,
      hardware: null,
      workload: null,
      precision: null,
      runtimePrecision: null,
      entity: null,
      timelineCapture: null,
      basis: null,
    };
  }

  const runtime = current.runtime && capabilities.runtimeIds.has(current.runtime)
    ? current.runtime
    : null;
  const hardware = current.hardware && capabilities.hardwareIds.has(current.hardware)
    ? current.hardware
    : null;
  const workload = modelWorkloadIsCompatible(capabilities, current.workload)
    ? current.workload
    : null;
  const precision = current.precision && capabilities.rooflinePrecisionIds.has(current.precision)
    ? current.precision
    : null;
  const runtimePrecision = runtime && current.runtimePrecision &&
    capabilities.runtimePrecisionIds.get(runtime)?.has(current.runtimePrecision)
    ? current.runtimePrecision
    : null;
  const timelineCapture = current.timelineCapture && capabilities.captureIds.has(current.timelineCapture)
    ? current.timelineCapture
    : null;
  const basis = current.basis && capabilities.rooflineBasisIds.has(current.basis)
    ? current.basis
    : null;
  const entity = current.entity && entityIsCompatible(capabilities, current.entity)
    ? current.entity
    : null;

  return {
    model: modelId,
    runtime,
    hardware,
    workload,
    precision,
    runtimePrecision,
    entity,
    timelineCapture,
    basis,
  };
}
