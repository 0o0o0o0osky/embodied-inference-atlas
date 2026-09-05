import type { RoutePatch, RouteState } from "../../../app/routes";
import type { AtlasData } from "../../../types/atlas";
import { adaptRuntimeRealization, isRuntimeRealizationRecord } from "../../runtime/domain/adaptRuntimeRealization";
import { resolveRuntimeCandidates } from "../../runtime/domain/resolveRuntimeRealization";
import { logicalRefFromEntity, parseEntityKey } from "../../workbench/entityKeys";
import {
  createModelCapabilityRegistry,
  modelCapabilityPair,
  modelWorkloadIsCompatible,
  type ModelCapabilities,
  type ModelCapabilityRegistry,
  type SelectionContext,
} from "../../workbench/modelCapabilities";

interface CompatibleSelection {
  runtime: string | null;
  hardware: string | null;
  workload: string | null;
  runtimePrecision: string | null;
}

function contextMatches(
  context: SelectionContext | undefined,
  selection: Pick<CompatibleSelection, "runtime" | "hardware" | "runtimePrecision">,
) {
  if (!context) return false;
  if (selection.runtime && context.runtimeId && context.runtimeId !== selection.runtime) return false;
  if (selection.hardware && context.hardwareIds.size && !context.hardwareIds.has(selection.hardware)) return false;
  if (selection.runtimePrecision && context.precisionIds.size && !context.precisionIds.has(selection.runtimePrecision)) return false;
  return true;
}

function runtimeWorkload(capabilities: ModelCapabilities, encoded: string | null): string | null {
  if (!encoded || capabilities.configurationIds.has(encoded)) return encoded;
  const aliases = new Map<string, string>([
    ["v", "V"], ["p", "L_PROMPT"], ["a", "T_ACTION"], ["n", "N_DENOISE"],
  ]);
  return encoded.split(",").map((part) => {
    const [rawName, rawValue] = part.split("=", 2);
    const name = rawName?.trim();
    return `${name ? aliases.get(name) ?? name : ""}=${rawValue?.trim() ?? ""}`;
  }).join(",");
}

function compatibleRuntimeSelection(
  data: AtlasData,
  capabilities: ModelCapabilities,
  selection: CompatibleSelection,
): CompatibleSelection {
  if (!selection.runtime || !capabilities.modelGraphId) return selection;
  const realizations = data.datasets.runtime_realizations
    .filter((record) => isRuntimeRealizationRecord(record, capabilities.modelId))
    .map(adaptRuntimeRealization)
    .filter((record) => record.runtimeId === selection.runtime && record.availability !== "not_supported");
  if (!realizations.length) return selection;
  const candidates = (
    hardware: string | null,
    workload: string | null,
    runtimePrecision: string | null,
  ) => resolveRuntimeCandidates(realizations, data.datasets.runs, {
    modelId: capabilities.modelId,
    modelGraphId: capabilities.modelGraphId!,
    runtimeId: selection.runtime!,
    hardwareId: hardware,
    workload: runtimeWorkload(capabilities, workload),
    precisionId: runtimePrecision,
  });
  if (!candidates(null, null, null).length) return selection;

  const alternatives: Array<Omit<CompatibleSelection, "runtime">> = [
    selection,
    { ...selection, runtimePrecision: null },
    { ...selection, workload: null },
    { ...selection, hardware: null },
    { ...selection, runtimePrecision: null, workload: null },
    { ...selection, runtimePrecision: null, hardware: null },
    { ...selection, workload: null, hardware: null },
    { ...selection, runtimePrecision: null, workload: null, hardware: null },
  ];
  const compatible = alternatives.find((candidate) =>
    candidates(candidate.hardware, candidate.workload, candidate.runtimePrecision).length > 0,
  );
  return compatible ? { runtime: selection.runtime, ...compatible } : selection;
}

function entityIsCompatible(
  capabilities: ModelCapabilities,
  entity: string | null,
  selection: CompatibleSelection,
  basis: string | null,
): boolean {
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
    const key = modelCapabilityPair(parsed.realizationId, parsed.executionGroupId);
    return capabilities.realizationGroups.has(key)
      && contextMatches(capabilities.realizationGroupContexts.get(key), selection);
  }
  if (parsed.kind === "kernel") {
    return capabilities.kernelObservations.has(modelCapabilityPair(parsed.captureId, parsed.kernelObservationId))
      && contextMatches(capabilities.captureContexts.get(parsed.captureId), selection);
  }
  if (parsed.kind === "timeline-event") {
    const key = modelCapabilityPair(parsed.timelineId, parsed.eventId);
    return capabilities.timelineEvents.has(key)
      && contextMatches(capabilities.timelineEventContexts.get(key), selection);
  }
  if (parsed.kind === "run") {
    return capabilities.runIds.has(parsed.runId)
      && contextMatches(capabilities.runContexts.get(parsed.runId), selection);
  }
  const pointBasisId = capabilities.legacyPointBasisIds.get(parsed.pointId);
  return capabilities.legacyPointIds.has(parsed.pointId)
    && (basis === null || pointBasisId === basis);
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

  const initialRuntime = current.runtime && capabilities.runtimeIds.has(current.runtime)
    ? current.runtime
    : null;
  const initialHardware = current.hardware && capabilities.hardwareIds.has(current.hardware)
    ? current.hardware
    : null;
  const initialWorkload = modelWorkloadIsCompatible(capabilities, current.workload)
    ? current.workload
    : null;
  const precision = current.precision && capabilities.rooflinePrecisionIds.has(current.precision)
    ? current.precision
    : null;
  const initialRuntimePrecision = initialRuntime && current.runtimePrecision &&
    capabilities.runtimePrecisionIds.get(initialRuntime)?.has(current.runtimePrecision)
    ? current.runtimePrecision
    : null;
  const selection = compatibleRuntimeSelection(data, capabilities, {
    runtime: initialRuntime,
    hardware: initialHardware,
    workload: initialWorkload,
    runtimePrecision: initialRuntimePrecision,
  });
  const basisContext = current.basis
    ? capabilities.rooflineBasisContexts.get(current.basis)
    : null;
  const basis = current.basis && basisContext
    && (current.rooflineLevel === "overview" || basisContext.level === current.rooflineLevel)
    && (!precision || basisContext.precisionIds.has(precision))
    && (!selection.hardware || basisContext.hardwareIds.has(selection.hardware))
    && (!basisContext.runtimeId || basisContext.runtimeId === selection.runtime)
    ? current.basis
    : null;
  const timelineCapture = current.timelineCapture
    && capabilities.timelineCaptureIds.has(current.timelineCapture)
    && contextMatches(capabilities.captureContexts.get(current.timelineCapture), selection)
    ? current.timelineCapture
    : null;
  const entity = current.entity && entityIsCompatible(capabilities, current.entity, selection, basis)
    ? current.entity
    : null;

  return {
    model: modelId,
    runtime: selection.runtime,
    hardware: selection.hardware,
    workload: selection.workload,
    precision,
    runtimePrecision: selection.runtimePrecision,
    entity,
    timelineCapture,
    basis,
  };
}
