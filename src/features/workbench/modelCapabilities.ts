import type { AtlasData, CanonicalRecord } from "../../types/atlas";
import { adaptLogicalDag } from "../model-graph/domain/adaptLogicalDag";
import { adaptV1ModelGraph, isV1ModelGraphRecord } from "../model-graph/domain/adaptV1ModelGraph";
import type { EditableSymbol } from "../model-graph/domain/types";
import { adaptRuntimeRealization, isRuntimeRealizationRecord } from "../runtime/domain/adaptRuntimeRealization";
import type { RooflineScenarioRecord } from "../roofline/domain/types";

type PairKey = `${string}\u0000${string}`;

export interface ModelCapabilities {
  readonly modelId: string;
  readonly modelGraphId: string | null;
  readonly logicalRefs: ReadonlySet<string>;
  readonly stageIds: ReadonlySet<string>;
  readonly editableSymbols: readonly EditableSymbol[];
  readonly runtimeIds: ReadonlySet<string>;
  readonly runtimePrecisionIds: ReadonlyMap<string, ReadonlySet<string>>;
  readonly hardwareIds: ReadonlySet<string>;
  readonly configurationIds: ReadonlySet<string>;
  readonly runIds: ReadonlySet<string>;
  readonly captureIds: ReadonlySet<string>;
  readonly timelineEvents: ReadonlySet<PairKey>;
  readonly kernelObservations: ReadonlySet<PairKey>;
  readonly realizationGroups: ReadonlySet<PairKey>;
  readonly rooflinePrecisionIds: ReadonlySet<string>;
  readonly rooflineBasisIds: ReadonlySet<string>;
  readonly legacyPointIds: ReadonlySet<string>;
  readonly roofline: {
    readonly available: boolean;
    readonly defaultScenarioId: string | null;
    readonly reason: string | null;
  };
}

export type ModelCapabilityRegistry = ReadonlyMap<string, ModelCapabilities>;

function text(record: CanonicalRecord, field: string): string | null {
  return typeof record[field] === "string" ? record[field] : null;
}

function childRecords(record: CanonicalRecord, field: string): CanonicalRecord[] {
  const value = record[field];
  return Array.isArray(value)
    ? value.filter((item): item is CanonicalRecord => typeof item === "object" && item !== null && !Array.isArray(item))
    : [];
}

function pair(first: string, second: string): PairKey {
  return `${first}\u0000${second}`;
}

function addToMapSet(map: Map<string, Set<string>>, key: string, value: string) {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}

function modelIds(data: AtlasData): string[] {
  return [...new Set([
    ...data.datasets.models.map((model) => model.model_id),
    ...data.datasets.model_graphs.flatMap((record) => text(record, "model_id") ?? []),
    ...data.datasets.roofline_scenarios.flatMap((record) => text(record, "model_id") ?? []),
  ])];
}

export function createModelCapabilityRegistry(data: AtlasData): ModelCapabilityRegistry {
  const capturesById = new Map(data.datasets.profiler_captures.flatMap((record) => {
    const captureId = text(record, "capture_id");
    return captureId ? [[captureId, record] as const] : [];
  }));
  const scenarios = data.datasets.roofline_scenarios.filter((record): record is CanonicalRecord & RooflineScenarioRecord =>
    record.schema_version === "2.0.0" && typeof record.scenario_id === "string" && typeof record.model_id === "string",
  );

  return new Map(modelIds(data).map((modelId) => {
    const graphRecord = data.datasets.model_graphs.find((record) => isV1ModelGraphRecord(record, modelId)) ?? null;
    const graph = graphRecord ? adaptV1ModelGraph(graphRecord) : null;
    const dag = graph ? adaptLogicalDag(graph) : null;
    const modelRuns = data.datasets.runs.filter((run) => run.model_id === modelId);
    const runIds = new Set(modelRuns.map((run) => run.run_id));
    const runtimeIds = new Set<string>();
    const runtimePrecisionIds = new Map<string, Set<string>>();
    const hardwareIds = new Set<string>();
    const configurationIds = new Set<string>();

    data.datasets.runtimes.forEach((runtime) => {
      if (runtime.model_support.some((support) => support.model_id === modelId && support.status !== "not_supported")) {
        runtimeIds.add(runtime.runtime_id);
      }
    });
    modelRuns.forEach((run) => {
      runtimeIds.add(run.runtime_id);
      hardwareIds.add(run.device_id);
      configurationIds.add(run.configuration_id);
      addToMapSet(runtimePrecisionIds, run.runtime_id, run.precision.precision_id);
    });

    const modelRealizations = data.datasets.runtime_realizations
      .filter((record) => isRuntimeRealizationRecord(record, modelId))
      .map(adaptRuntimeRealization);
    const realizationGroups = new Set<PairKey>();
    modelRealizations.forEach((realization) => {
      if (realization.availability !== "not_supported") {
        runtimeIds.add(realization.runtimeId);
        realization.deviceIds.forEach((deviceId) => hardwareIds.add(deviceId));
        realization.configurationIds.forEach((configurationId) => configurationIds.add(configurationId));
        realization.precisionPaths.forEach((precision) =>
          addToMapSet(runtimePrecisionIds, realization.runtimeId, precision.precisionPathId),
        );
      }
      realization.executionGroups.forEach((group) =>
        realizationGroups.add(pair(realization.realizationId, group.executionGroupId)),
      );
    });

    const modelScenarios = scenarios.filter((scenario) => scenario.model_id === modelId);
    const rooflinePrecisionIds = new Set(modelScenarios.map((scenario) => scenario.precision_path.precision_path_id));
    const scenarioIds = new Set(modelScenarios.map((scenario) => scenario.scenario_id));
    const modelBases = data.datasets.roofline_bases.filter((basis) => {
      const scenarioId = text(basis, "scenario_id");
      return scenarioId !== null && scenarioIds.has(scenarioId);
    });
    const rooflineBasisIds = new Set(modelBases.flatMap((basis) => text(basis, "basis_id") ?? []));
    modelBases.forEach((basis) => {
      const deviceId = text(basis, "device_id");
      if (deviceId) hardwareIds.add(deviceId);
    });
    const graphId = graphRecord ? text(graphRecord, "model_graph_id") : null;
    const defaultScenarios = modelScenarios.filter((scenario) =>
      scenario.origin === "default_precomputed" && scenario.model_graph_id === graphId,
    );
    const defaultScenario = defaultScenarios.find((scenario) =>
      scenario.precision_path.precision_path_id === "bf16_dense",
    ) ?? defaultScenarios[0] ?? null;
    const defaultHasBasis = defaultScenario !== null && modelBases.some((basis) =>
      text(basis, "scenario_id") === defaultScenario.scenario_id,
    );
    const rooflineAvailable = graph !== null && defaultScenario !== null && defaultHasBasis;

    const modelCaptureIds = new Set<string>();
    capturesById.forEach((capture, captureId) => {
      const runId = text(capture, "run_id");
      if (runId && runIds.has(runId)) modelCaptureIds.add(captureId);
    });
    const timelineEvents = new Set<PairKey>();
    data.datasets.timelines.forEach((timeline) => {
      const timelineId = text(timeline, "timeline_id");
      const captureId = text(timeline, "capture_id");
      if (!timelineId || !captureId || !modelCaptureIds.has(captureId)) return;
      childRecords(timeline, "events").forEach((event) => {
        const eventId = text(event, "event_id");
        if (eventId) timelineEvents.add(pair(timelineId, eventId));
      });
    });
    const kernelObservations = new Set<PairKey>();
    data.datasets.kernel_observations.forEach((observation) => {
      const captureId = text(observation, "capture_id");
      const observationId = text(observation, "observation_id");
      if (captureId && observationId && modelCaptureIds.has(captureId)) {
        kernelObservations.add(pair(captureId, observationId));
      }
    });
    const legacyPointIds = new Set(data.datasets.roofline_points.flatMap((point) => {
      const basisId = text(point, "basis_id");
      const pointId = text(point, "point_id");
      return basisId && pointId && rooflineBasisIds.has(basisId) ? [pointId] : [];
    }));

    const capabilities: ModelCapabilities = {
      modelId,
      modelGraphId: graphId,
      logicalRefs: new Set(dag?.nodes.keys() ?? []),
      stageIds: new Set(dag?.stageOrder ?? []),
      editableSymbols: graph?.editableSymbols ?? [],
      runtimeIds,
      runtimePrecisionIds,
      hardwareIds,
      configurationIds,
      runIds,
      captureIds: modelCaptureIds,
      timelineEvents,
      kernelObservations,
      realizationGroups,
      rooflinePrecisionIds,
      rooflineBasisIds,
      legacyPointIds,
      roofline: {
        available: rooflineAvailable,
        defaultScenarioId: defaultScenario?.scenario_id ?? null,
        reason: rooflineAvailable
          ? null
          : graph === null
            ? "No canonical logical graph is available for this model."
            : defaultScenario === null
              ? "No default precomputed roofline scenario maps to this logical graph."
              : "The default roofline scenario has no canonical basis.",
      },
    };
    return [modelId, capabilities] as const;
  }));
}

export function modelWorkloadIsCompatible(
  capabilities: ModelCapabilities,
  encoded: string | null,
): boolean {
  if (!encoded) return true;
  if (encoded.startsWith("cfg-")) return capabilities.configurationIds.has(encoded);
  const aliases = new Map<string, string>([
    ["v", "V"], ["p", "L_PROMPT"], ["a", "T_ACTION"], ["n", "N_DENOISE"],
  ]);
  const symbols = new Map(capabilities.editableSymbols.map((symbol) => [symbol.symbol, symbol]));
  for (const part of encoded.split(",")) {
    const pieces = part.split("=", 2);
    const rawName = pieces[0]?.trim();
    const name = rawName ? aliases.get(rawName) ?? rawName : null;
    const value = Number(pieces[1]);
    const symbol = name ? symbols.get(name) : null;
    if (
      !symbol || !Number.isSafeInteger(value) || value < symbol.minimum ||
      (symbol.maximum !== null && value > symbol.maximum)
    ) return false;
  }
  return true;
}

export const modelCapabilityPair = pair;
