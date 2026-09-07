import type { AtlasData, CanonicalRecord, RunRecord } from "../../../types/atlas";
import { adaptV1ModelGraph } from "../../model-graph/domain/adaptV1ModelGraph";
import {
  adaptRuntimeRealization,
  isRuntimeRealizationRecord,
} from "../../runtime/domain/adaptRuntimeRealization";
import { createRooflineIndex, indexRoofline } from "../data/indexRoofline";
import {
  interactiveSourceBasisIsLossless,
  materializeInteractiveRoofline,
  parseInteractiveWorkload,
  type InteractiveWorkload,
} from "../data/materialize";
import { rooflineBasisContract } from "../domain/basisContract";
import type {
  BandwidthCeiling,
  ComputeCeiling,
  RooflineBasisRecord,
  RooflineCeilingRecord,
  RooflinePointRecord,
  RooflineScenarioRecord,
  RooflineWorkload,
} from "../domain/types";

const PI0_MODEL_ID = "pi0";
const DEFAULT_PRECISION_PATH_ID = "bf16_dense";
const DEFAULT_WORKLOAD: InteractiveWorkload = {
  executedCameraViews: 3,
  executedPromptTokens: 48,
  actionHorizon: 50,
  denoiseSteps: 10,
};

export interface Pi0AnalyticalSlice {
  scenario: RooflineScenarioRecord;
  ceiling: RooflineCeilingRecord;
  bandwidthCeiling: BandwidthCeiling;
  atomicBasis: RooflineBasisRecord;
  stageBasis: RooflineBasisRecord;
  atomicPoints: readonly RooflinePointRecord[];
  modelTotal: RooflinePointRecord | null;
  stages: readonly RooflinePointRecord[];
}

export type Pi0AnalyticalResult =
  | { status: "available"; value: Pi0AnalyticalSlice }
  | { status: "unavailable"; reason: string };

export interface OperatorRooflineRow {
  point: RooflinePointRecord;
  computeCeilings: readonly ComputeCeiling[];
  bandwidthCeiling: BandwidthCeiling;
  hardwareId: string;
  precisionPathId: string;
  workload: InteractiveWorkload;
  timingBasis: RooflineBasisRecord["time_basis"];
}

export interface OperatorRooflineSummary {
  logicalRef: string;
  scenario: RooflineScenarioRecord;
  basis: RooflineBasisRecord;
  rows: readonly OperatorRooflineRow[];
}

function unavailable(reason: string): Pi0AnalyticalResult {
  return { status: "unavailable", reason };
}

function workloadFallback(source: RooflineWorkload): RooflineWorkload {
  return {
    ...source,
    active_camera_views: DEFAULT_WORKLOAD.executedCameraViews,
    executed_camera_views: DEFAULT_WORKLOAD.executedCameraViews,
    executed_prompt_tokens: DEFAULT_WORKLOAD.executedPromptTokens,
    action_horizon: DEFAULT_WORKLOAD.actionHorizon,
    denoise_steps: DEFAULT_WORKLOAD.denoiseSteps,
  };
}

function runWorkload(run: RunRecord): InteractiveWorkload | null {
  const workload = run.workload.vla;
  if (!workload
    || workload.camera_views === null
    || workload.executed_prompt_tokens === null
    || workload.action_chunk === null
    || workload.denoise_steps === null) return null;
  return {
    executedCameraViews: workload.camera_views,
    executedPromptTokens: workload.executed_prompt_tokens,
    actionHorizon: workload.action_chunk,
    denoiseSteps: workload.denoise_steps,
  };
}

function encodedWorkload(value: string) {
  return value.split(",").every((part) =>
    /^(?:v|p|a|n|V|L_PROMPT|T_ACTION|N_DENOISE)=-?\d+$/.test(part.trim()),
  );
}

function workloadKey(workload: InteractiveWorkload) {
  return [
    workload.executedCameraViews,
    workload.executedPromptTokens,
    workload.actionHorizon,
    workload.denoiseSteps,
  ].join("/");
}

function resolveWorkload(
  data: AtlasData,
  binding: string | null,
  hardwareId: string | null,
  source: RooflineScenarioRecord,
  graphRecord: CanonicalRecord,
): { status: "available"; value: InteractiveWorkload } | { status: "unavailable"; reason: string } {
  if (!binding) return { status: "available", value: DEFAULT_WORKLOAD };

  const configurationRuns = data.datasets.runs.filter((run) =>
    run.configuration_id === binding
    && run.model_id === PI0_MODEL_ID
    && (!hardwareId || run.device_id === hardwareId),
  );
  if (configurationRuns.length) {
    const resolved = configurationRuns.map(runWorkload);
    if (resolved.some((workload) => workload === null)) {
      return { status: "unavailable", reason: "该配置没有完整的 V/P/A/N 工作负载记录。" };
    }
    const unique = new Map(resolved.map((workload) => [workloadKey(workload!), workload!]));
    if (unique.size !== 1) {
      return { status: "unavailable", reason: "该配置对应多个不同的 V/P/A/N 工作负载。" };
    }
    return { status: "available", value: [...unique.values()][0]! };
  }

  if (!encodedWorkload(binding)) {
    return { status: "unavailable", reason: "当前工作负载既不是 Pi0 配置，也不是可解析的 V/P/A/N。" };
  }
  const graph = adaptV1ModelGraph(graphRecord);
  const prompt = graph.editableSymbols.find((symbol) => symbol.symbol === "L_PROMPT");
  return {
    status: "available",
    value: parseInteractiveWorkload(binding, workloadFallback(source.workload), {
      promptMinimum: prompt?.minimum ?? 1,
      promptMaximum: prompt?.maximum ?? null,
    }),
  };
}

export function materializeCurrentPi0Roofline(input: {
  data: AtlasData;
  workloadBinding: string | null;
  precisionPathId: string | null;
  hardwareId: string | null;
}): Pi0AnalyticalResult {
  const canonical = indexRoofline(input.data);
  const precisionPathId = input.precisionPathId ?? DEFAULT_PRECISION_PATH_ID;
  const scenarios = canonical.scenarios.filter((scenario) =>
    scenario.model_id === PI0_MODEL_ID
    && scenario.origin === "default_precomputed"
    && scenario.precision_path.precision_path_id === precisionPathId,
  );
  if (scenarios.length !== 1) {
    return unavailable(`没有唯一的 Pi0 ${precisionPathId} 默认解析场景。`);
  }
  const sourceScenario = scenarios[0]!;
  const graphRecord = input.data.datasets.model_graphs.find((record) =>
    record.model_graph_id === sourceScenario.model_graph_id,
  ) ?? null;
  if (!graphRecord) return unavailable("Pi0 解析场景缺少对应的模型图。");

  const workload = resolveWorkload(
    input.data,
    input.workloadBinding,
    input.hardwareId,
    sourceScenario,
    graphRecord,
  );
  if (workload.status === "unavailable") return workload;

  const expectedRealizationId = sourceScenario.precision_path.realization_ids.length === 1
    ? sourceScenario.precision_path.realization_ids[0]!
    : null;
  const realizationRecord = expectedRealizationId
    ? input.data.datasets.runtime_realizations.find((record) =>
      record.realization_id === expectedRealizationId,
    ) ?? null
    : null;
  const realization = realizationRecord && isRuntimeRealizationRecord(realizationRecord, PI0_MODEL_ID)
    ? adaptRuntimeRealization(realizationRecord)
    : null;

  const sourceBases = canonical.bases.filter((basis) =>
    basis.scenario_id === sourceScenario.scenario_id
    && (!input.hardwareId || basis.device_id === input.hardwareId),
  ).filter((basis) => interactiveSourceBasisIsLossless(basis, sourceScenario, realization));
  const contracts = new Map<string, RooflineBasisRecord[]>();
  sourceBases.forEach((basis) => {
    const contract = rooflineBasisContract(basis);
    contracts.set(contract, [...(contracts.get(contract) ?? []), basis]);
  });
  if (contracts.size !== 1) {
    return unavailable("当前 Pi0 场景没有唯一的同硬件 Stage/Atomic 解析口径。");
  }
  const pairedBases = [...contracts.values()][0]!;
  const stageBases = pairedBases.filter((basis) => basis.level === "stage");
  const atomicBases = pairedBases.filter((basis) => basis.level === "atomic");
  if (stageBases.length !== 1 || atomicBases.length !== 1) {
    return unavailable("当前 Pi0 解析口径不能唯一配对 Stage 与 Atomic basis。");
  }
  const sourceAtomicBasis = atomicBases[0]!;
  const ceiling = canonical.ceilingById.get(sourceAtomicBasis.ceiling_id) ?? null;
  const bandwidthCeiling = ceiling?.bandwidth.find((candidate) =>
    candidate.bandwidth_ceiling_id === sourceAtomicBasis.bandwidth_ceiling_id,
  ) ?? null;
  if (!ceiling || !bandwidthCeiling || !bandwidthCeiling.byte_per_second) {
    return unavailable("当前 Atomic basis 缺少可用的带宽上限。");
  }

  try {
    const materialized = materializeInteractiveRoofline(
      graphRecord,
      sourceScenario,
      ceiling,
      workload.value,
      realizationRecord,
      bandwidthCeiling.bandwidth_ceiling_id,
    );
    const generated = createRooflineIndex(
      [ceiling],
      [materialized.scenario],
      materialized.bases,
      materialized.points,
    );
    const atomicBasis = materialized.bases.find((basis) => basis.level === "atomic")!;
    const stageBasis = materialized.bases.find((basis) => basis.level === "stage")!;
    const atomicPoints = generated.pointsByBasisId.get(atomicBasis.basis_id) ?? [];
    const stagePoints = generated.pointsByBasisId.get(stageBasis.basis_id) ?? [];
    return {
      status: "available",
      value: {
        scenario: materialized.scenario,
        ceiling,
        bandwidthCeiling,
        atomicBasis,
        stageBasis,
        atomicPoints,
        modelTotal: stagePoints.find((point) => point.entity.kind === "model_total") ?? null,
        stages: stagePoints.filter((point) => point.entity.kind === "stage"),
      },
    };
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : "Pi0 Roofline 解析失败。");
  }
}

export function buildOperatorRooflineSummary(
  slice: Pick<Pi0AnalyticalSlice, "atomicPoints" | "scenario" | "atomicBasis" | "ceiling" | "bandwidthCeiling">,
  logicalRef: string,
): OperatorRooflineSummary | null {
  const points = slice.atomicPoints.filter((point) =>
    point.entity.logical_refs.includes(logicalRef),
  );
  if (!points.length) return null;
  const workload: InteractiveWorkload = {
    executedCameraViews: slice.scenario.workload.executed_camera_views,
    executedPromptTokens: slice.scenario.workload.executed_prompt_tokens,
    actionHorizon: slice.scenario.workload.action_horizon,
    denoiseSteps: slice.scenario.workload.denoise_steps,
  };
  const rows = points.map((point): OperatorRooflineRow => {
    const computeClasses = new Set(point.work.components.flatMap((component) =>
      component.compute_class ? [component.compute_class] : [],
    ));
    return {
      point,
      computeCeilings: slice.ceiling.compute.filter((ceiling) =>
        computeClasses.has(ceiling.compute_class),
      ),
      bandwidthCeiling: slice.bandwidthCeiling,
      hardwareId: slice.atomicBasis.device_id,
      precisionPathId: slice.scenario.precision_path.precision_path_id,
      workload,
      timingBasis: slice.atomicBasis.time_basis,
    };
  });
  return {
    logicalRef,
    scenario: slice.scenario,
    basis: slice.atomicBasis,
    rows,
  };
}
