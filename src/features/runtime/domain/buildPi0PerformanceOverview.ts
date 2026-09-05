import type { AtlasData, ComparisonContextRecord, RunRecord } from "../../../types/atlas";
import {
  buildEvidenceRows,
  type EvidenceRow,
  type TimingStatistic,
} from "../../end-to-end/domain/buildEvidenceRows";

export const PI0_PERFORMANCE_TARGET = {
  promptTokens: 48,
  denoiseSteps: 10,
  cameraViews: [1, 2, 3],
  actionChunks: [20, 50],
} as const;

export interface Pi0PerformanceWorkload {
  cameraViews: number;
  promptTokens: number;
  actionChunk: number;
  denoiseSteps: number;
}

export interface Pi0PerformanceSelection {
  facetId: string;
  runtimeId: string;
  precisionId: string;
  hardwareId: string;
  runId: string;
  configurationId: string;
  workload: Pi0PerformanceWorkload;
}

export interface Pi0PerformanceLatency {
  statistic: TimingStatistic;
  value: number;
  unit: string;
}

export type Pi0PerformancePendingReason =
  | "not_measured"
  | "latency_missing"
  | "multiple_exact_measurements";

export interface Pi0PerformancePendingCell {
  state: "pending";
  cameraViews: number;
  actionChunk: number;
  reason: Pi0PerformancePendingReason;
}

export interface Pi0PerformanceMeasuredCell {
  state: "measured";
  cameraViews: number;
  actionChunk: number;
  latency: Pi0PerformanceLatency;
  selection: Pi0PerformanceSelection;
}

export type Pi0PerformanceCell = Pi0PerformancePendingCell | Pi0PerformanceMeasuredCell;

export interface Pi0PerformanceSeries {
  actionChunk: number;
  cells: readonly Pi0PerformanceCell[];
}

export interface Pi0PerformanceContract {
  modelArtifactId: string;
  systemId: string | null;
  batchSize: number;
  inputContractId: string;
  outputContractId: string;
  actionDimension: number | null;
  imageHeight: number | null;
  imageWidth: number | null;
  timingBoundaryId: string;
  stateReuse: string;
  warmPolicy: string;
  warmupIterations: number | null;
  operatingPointId: string;
  measurementMethod: string;
  workUnit: string;
  statistic: TimingStatistic | null;
  unit: string | null;
}

export interface Pi0PerformanceFacet {
  id: string;
  runtimeId: string;
  runtimeLabel: string;
  hardwareId: string;
  precisionId: string;
  comparisonContext: ComparisonContextRecord;
  contract: Pi0PerformanceContract;
  series: readonly Pi0PerformanceSeries[];
  measuredCellCount: number;
  observedScope: {
    promptTokens: readonly number[];
    actionChunks: readonly number[];
    denoiseSteps: readonly number[];
    hasMissingDenoise: boolean;
  };
}

export interface Pi0PerformanceOverviewModel {
  target: typeof PI0_PERFORMANCE_TARGET;
  hardwareId: string | null;
  hardwareLabel: string;
  facets: readonly Pi0PerformanceFacet[];
  measuredCellCount: number;
  targetCellCount: number;
}

interface FacetAccumulator {
  id: string;
  runtimeId: string;
  runtimeLabel: string;
  hardwareId: string;
  precisionId: string;
  comparisonContext: ComparisonContextRecord;
  contract: Pi0PerformanceContract;
  rows: EvidenceRow[];
}

function selectedStatistic(row: EvidenceRow): TimingStatistic | null {
  return row.selected?.statistic ?? null;
}

function selectedUnit(row: EvidenceRow): string | null {
  return row.selected?.unit
    ?? row.measurement.statistics.find((value) => value.unit)?.unit
    ?? null;
}

function contractFor(row: EvidenceRow): Pi0PerformanceContract {
  const { run } = row;
  const vla = run.workload.vla;
  return {
    modelArtifactId: run.model_artifact_id,
    systemId: run.system_id,
    batchSize: run.workload.common.batch_size,
    inputContractId: run.workload.common.input_contract_id,
    outputContractId: run.workload.common.output_contract_id,
    actionDimension: vla?.action_dimension ?? null,
    imageHeight: vla?.image_height ?? null,
    imageWidth: vla?.image_width ?? null,
    timingBoundaryId: run.timing.timing_boundary_id,
    stateReuse: run.timing.state_reuse,
    warmPolicy: run.timing.warm_policy,
    warmupIterations: run.timing.warmup_iterations,
    operatingPointId: run.operating_point.operating_point_id,
    measurementMethod: row.measurement.measurementMethod,
    workUnit: row.measurement.workUnit,
    statistic: selectedStatistic(row),
    unit: selectedUnit(row),
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function pi0PerformanceFacetContext(context: ComparisonContextRecord): unknown {
  const workload = context.workload;
  const vla = workload.vla;
  if (!vla) return context;
  const {
    camera_views: _cameraViews,
    executed_prompt_tokens: _promptTokens,
    semantic_prompt_tokens: _semanticPromptTokens,
    action_chunk: _actionChunk,
    denoise_steps: _denoiseSteps,
    ...fixedVla
  } = vla;
  return {
    ...context,
    workload: { ...workload, vla: fixedVla },
  };
}

export function pi0PerformanceFacetContextKey(context: ComparisonContextRecord): string {
  return stableJson(pi0PerformanceFacetContext(context));
}

function facetId(row: EvidenceRow, contract: Pi0PerformanceContract): string {
  const key = stableJson({
    comparisonContext: pi0PerformanceFacetContextKey(row.run.comparison_context),
    measurementMethod: contract.measurementMethod,
    statistic: contract.statistic,
    unit: contract.unit,
    workUnit: contract.workUnit,
  });
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= BigInt(key.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `pi0-facet-${hash.toString(36)}`;
}

function workloadMatches(row: EvidenceRow, cameraViews: number, actionChunk: number): boolean {
  const workload = row.run.workload.vla;
  return workload?.camera_views === cameraViews
    && workload.executed_prompt_tokens === PI0_PERFORMANCE_TARGET.promptTokens
    && workload.action_chunk === actionChunk
    && workload.denoise_steps === PI0_PERFORMANCE_TARGET.denoiseSteps;
}

function pendingCell(
  rows: readonly EvidenceRow[],
  cameraViews: number,
  actionChunk: number,
): Pi0PerformancePendingCell {
  return {
    state: "pending",
    cameraViews,
    actionChunk,
    reason: rows.length ? "latency_missing" : "not_measured",
  };
}

function cellFor(
  rows: readonly EvidenceRow[],
  facetId: string,
  cameraViews: number,
  actionChunk: number,
): Pi0PerformanceCell {
  const exactRows = rows.filter((row) => workloadMatches(row, cameraViews, actionChunk));
  const measuredRows = exactRows.filter((row) => row.selected?.value !== null && row.selected?.value !== undefined);
  if (measuredRows.length !== 1) {
    if (measuredRows.length > 1) {
      return { state: "pending", cameraViews, actionChunk, reason: "multiple_exact_measurements" };
    }
    return pendingCell(exactRows, cameraViews, actionChunk);
  }

  const row = measuredRows[0]!;
  const selected = row.selected!;
  const workload: Pi0PerformanceWorkload = {
    cameraViews,
    promptTokens: PI0_PERFORMANCE_TARGET.promptTokens,
    actionChunk,
    denoiseSteps: PI0_PERFORMANCE_TARGET.denoiseSteps,
  };
  return {
    state: "measured",
    cameraViews,
    actionChunk,
    latency: {
      statistic: selected.statistic,
      value: selected.value!,
      unit: selected.unit,
    },
    selection: {
      facetId,
      runtimeId: row.run.runtime_id,
      precisionId: row.run.precision.precision_id,
      hardwareId: row.run.device_id,
      runId: row.run.run_id,
      configurationId: row.run.configuration_id,
      workload,
    },
  };
}

export function buildPi0PerformanceOverview({
  data,
  hardwareId,
}: {
  data: AtlasData;
  hardwareId: string | null;
}): Pi0PerformanceOverviewModel {
  const measuredRows = buildEvidenceRows(data, "pi0", {
    runtimeId: null,
    hardwareId,
    entity: null,
  }).allRows.filter((row) =>
    row.measurement.evidence === "measured_local"
    && row.run.evidence === "measured_local"
    && row.measurement.metric === "latency"
    && row.run.workload.vla !== undefined,
  );
  const facets = new Map<string, FacetAccumulator>();

  measuredRows.forEach((row) => {
    const contract = contractFor(row);
    const id = facetId(row, contract);
    const facet = facets.get(id) ?? {
      id,
      runtimeId: row.run.runtime_id,
      runtimeLabel: row.runtimeLabel,
      hardwareId: row.run.device_id,
      precisionId: row.run.precision.precision_id,
      comparisonContext: row.run.comparison_context,
      contract,
      rows: [],
    };
    facet.rows.push(row);
    facets.set(id, facet);
  });

  const builtFacets = [...facets.values()]
    .sort((left, right) =>
      left.runtimeId.localeCompare(right.runtimeId)
      || left.precisionId.localeCompare(right.precisionId)
      || left.id.localeCompare(right.id),
    )
    .map((facet): Pi0PerformanceFacet => {
      const series = PI0_PERFORMANCE_TARGET.actionChunks.map((actionChunk): Pi0PerformanceSeries => ({
        actionChunk,
        cells: PI0_PERFORMANCE_TARGET.cameraViews.map((cameraViews) =>
          cellFor(facet.rows, facet.id, cameraViews, actionChunk),
        ),
      }));
      return {
        id: facet.id,
        runtimeId: facet.runtimeId,
        runtimeLabel: facet.runtimeLabel,
        hardwareId: facet.hardwareId,
        precisionId: facet.precisionId,
        comparisonContext: facet.comparisonContext,
        contract: facet.contract,
        series,
        measuredCellCount: series.reduce(
          (count, item) => count + item.cells.filter((cell) => cell.state === "measured").length,
          0,
        ),
        observedScope: {
          promptTokens: [...new Set(facet.rows.flatMap((row) => row.run.workload.vla?.executed_prompt_tokens == null
            ? [] : [row.run.workload.vla.executed_prompt_tokens]))].sort((left, right) => left - right),
          actionChunks: [...new Set(facet.rows.flatMap((row) => row.run.workload.vla?.action_chunk == null
            ? [] : [row.run.workload.vla.action_chunk]))].sort((left, right) => left - right),
          denoiseSteps: [...new Set(facet.rows.flatMap((row) => row.run.workload.vla?.denoise_steps == null
            ? [] : [row.run.workload.vla.denoise_steps]))].sort((left, right) => left - right),
          hasMissingDenoise: facet.rows.some((row) => row.run.workload.vla?.denoise_steps == null),
        },
      };
    });
  const targetCellCount = builtFacets.length
    * PI0_PERFORMANCE_TARGET.cameraViews.length
    * PI0_PERFORMANCE_TARGET.actionChunks.length;
  const measuredCellCount = builtFacets.reduce((count, facet) => count + facet.measuredCellCount, 0);
  const hardwareLabel = hardwareId === null
    ? "全部硬件"
    : data.datasets.devices.find((device) => device.device_id === hardwareId)?.display_name ?? hardwareId;

  return {
    target: PI0_PERFORMANCE_TARGET,
    hardwareId,
    hardwareLabel,
    facets: builtFacets,
    measuredCellCount,
    targetCellCount,
  };
}
