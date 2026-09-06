import type { AtlasData, ComparisonContextRecord, RunRecord } from "../../../types/atlas";
import {
  buildEvidenceRows,
  type EvidenceRow,
  type TimingStatistic,
} from "../../end-to-end/domain/buildEvidenceRows";
import { adaptRuntimeRealization, isRuntimeRealizationRecord } from "./adaptRuntimeRealization";
import type { RuntimeRealizationRecord } from "./types";

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

export interface Pi0NativeEvidenceWorkload {
  cameraViews: number | null;
  promptTokens: number | null;
  actionChunk: number | null;
  denoiseSteps: number | null;
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
  state: "pending_supported";
  cameraViews: number;
  actionChunk: number;
  reason: Pi0PerformancePendingReason;
}

export interface Pi0PerformanceUnsupportedCell {
  state: "unsupported";
  cameraViews: number;
  actionChunk: number;
  reason: "fixed_action_horizon" | "fixed_denoise_steps";
  realizationIds: readonly string[];
}

export interface Pi0PerformanceMeasuredCell {
  state: "measured";
  cameraViews: number;
  actionChunk: number;
  latency: Pi0PerformanceLatency;
  selection: Pi0PerformanceSelection;
}

export type Pi0PerformanceCell =
  | Pi0PerformancePendingCell
  | Pi0PerformanceUnsupportedCell
  | Pi0PerformanceMeasuredCell;

export interface Pi0NativeEvidenceSelection extends Omit<Pi0PerformanceSelection, "workload"> {
  workload: Pi0NativeEvidenceWorkload;
  workloadStatus: "complete" | "partial";
  latency: Pi0PerformanceLatency;
}

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
  nativeEvidenceSelection: Pi0NativeEvidenceSelection | null;
  measuredCellCount: number;
  observedScope: {
    promptTokens: readonly number[];
    actionChunks: readonly number[];
    denoiseSteps: readonly number[];
    hasMissingDenoise: boolean;
  };
}

export interface Pi0PerformanceCoordinate {
  cameraViews: number;
  actionChunk: number;
}

export interface Pi0PerformanceDefaultCoordinate extends Pi0PerformanceCoordinate {
  measuredGroupCount: number;
}

export type Pi0PerformanceGroupComparison =
  | {
    state: "measured";
    facet: Pi0PerformanceFacet;
    cell: Pi0PerformanceMeasuredCell;
  }
  | {
    state: "multiple_contracts";
    measurements: readonly {
      facet: Pi0PerformanceFacet;
      cell: Pi0PerformanceMeasuredCell;
    }[];
  }
  | {
    state: "unavailable";
  };

export interface Pi0PerformanceGroup {
  id: string;
  runtimeId: string;
  runtimeLabel: string;
  hardwareId: string;
  precisionId: string;
  facets: readonly Pi0PerformanceFacet[];
  primaryFacetId: string;
  comparison: Pi0PerformanceGroupComparison;
}

export interface Pi0PerformanceOverviewModel {
  target: typeof PI0_PERFORMANCE_TARGET;
  hardwareId: string | null;
  hardwareLabel: string;
  facets: readonly Pi0PerformanceFacet[];
  groups: readonly Pi0PerformanceGroup[];
  defaultCoordinate: Pi0PerformanceDefaultCoordinate;
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

function isTargetWorkload(row: EvidenceRow): boolean {
  const workload = row.run.workload.vla;
  return workload !== undefined
    && workload.executed_prompt_tokens === PI0_PERFORMANCE_TARGET.promptTokens
    && workload.denoise_steps === PI0_PERFORMANCE_TARGET.denoiseSteps
    && PI0_PERFORMANCE_TARGET.cameraViews.some((cameraViews) => cameraViews === workload.camera_views)
    && PI0_PERFORMANCE_TARGET.actionChunks.some((actionChunk) => actionChunk === workload.action_chunk);
}

function pendingCell(
  rows: readonly EvidenceRow[],
  cameraViews: number,
  actionChunk: number,
): Pi0PerformancePendingCell {
  return {
    state: "pending_supported",
    cameraViews,
    actionChunk,
    reason: rows.length ? "latency_missing" : "not_measured",
  };
}

function unsupportedCell(
  realizations: readonly RuntimeRealizationRecord[],
  cameraViews: number,
  actionChunk: number,
): Pi0PerformanceUnsupportedCell | null {
  const auditedRealizations = realizations.filter((realization) => {
    if (realization.availability !== "measured" && realization.availability !== "source_audited") return false;
    const applicabilityEvidenceIds = new Set(realization.workloadApplicability.evidenceIds);
    return realization.evidence.some((item) =>
      item.kind === "source_code" && applicabilityEvidenceIds.has(item.evidenceId));
  });
  if (auditedRealizations.length === 0) return null;
  const mismatches = auditedRealizations.map((realization) => {
    const applicability = realization.workloadApplicability;
    const fixedActionHorizon = applicability.publicActionHorizon ?? applicability.runtimeActionHorizon;
    if (fixedActionHorizon !== null && fixedActionHorizon !== actionChunk) return "fixed_action_horizon" as const;
    if (applicability.denoiseSteps !== null
      && applicability.denoiseSteps !== PI0_PERFORMANCE_TARGET.denoiseSteps) return "fixed_denoise_steps" as const;
    return null;
  });
  if (mismatches.some((mismatch) => mismatch === null)) return null;
  return {
    state: "unsupported",
    cameraViews,
    actionChunk,
    reason: mismatches.includes("fixed_action_horizon") ? "fixed_action_horizon" : "fixed_denoise_steps",
    realizationIds: auditedRealizations.map((realization) => realization.realizationId),
  };
}

function selectionForRow(row: EvidenceRow, facetId: string): Pi0NativeEvidenceSelection | null {
  const vla = row.run.workload.vla;
  const selected = row.selected;
  if (!vla || !selected || selected.value === null) return null;
  const workload: Pi0NativeEvidenceWorkload = {
    cameraViews: vla.camera_views,
    promptTokens: vla.executed_prompt_tokens,
    actionChunk: vla.action_chunk,
    denoiseSteps: vla.denoise_steps,
  };
  return {
    facetId,
    runtimeId: row.run.runtime_id,
    precisionId: row.run.precision.precision_id,
    hardwareId: row.run.device_id,
    runId: row.run.run_id,
    configurationId: row.run.configuration_id,
    workload,
    workloadStatus: Object.values(workload).some((value) => value === null) ? "partial" : "complete",
    latency: {
      statistic: selected.statistic,
      value: selected.value,
      unit: selected.unit,
    },
  };
}

function distanceFrom(value: number | null, target: number): number {
  return value === null ? Number.POSITIVE_INFINITY : Math.abs(value - target);
}

function nativeEvidenceSelection(rows: readonly EvidenceRow[], facetId: string): Pi0NativeEvidenceSelection | null {
  return rows
    .filter((row) => !isTargetWorkload(row))
    .flatMap((row) => {
      const selection = selectionForRow(row, facetId);
      return selection ? [selection] : [];
    })
    .sort((left, right) =>
      distanceFrom(left.workload.promptTokens, PI0_PERFORMANCE_TARGET.promptTokens)
        - distanceFrom(right.workload.promptTokens, PI0_PERFORMANCE_TARGET.promptTokens)
      || distanceFrom(left.workload.cameraViews, 2) - distanceFrom(right.workload.cameraViews, 2)
      || left.configurationId.localeCompare(right.configurationId)
      || left.runId.localeCompare(right.runId),
    )[0] ?? null;
}

function cellFor(
  rows: readonly EvidenceRow[],
  realizations: readonly RuntimeRealizationRecord[],
  facetId: string,
  cameraViews: number,
  actionChunk: number,
): Pi0PerformanceCell {
  const exactRows = rows.filter((row) => workloadMatches(row, cameraViews, actionChunk));
  const measuredRows = exactRows.filter((row) => row.selected?.value !== null && row.selected?.value !== undefined);
  if (measuredRows.length !== 1) {
    if (measuredRows.length > 1) {
      return { state: "pending_supported", cameraViews, actionChunk, reason: "multiple_exact_measurements" };
    }
    const unsupported = unsupportedCell(realizations, cameraViews, actionChunk);
    if (unsupported) return unsupported;
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

function measuredAt(
  facet: Pi0PerformanceFacet,
  coordinate: Pi0PerformanceCoordinate,
): Pi0PerformanceMeasuredCell | null {
  const series = facet.series.find((candidate) => candidate.actionChunk === coordinate.actionChunk);
  const cell = series?.cells.find((candidate) => candidate.cameraViews === coordinate.cameraViews);
  return cell?.state === "measured" ? cell : null;
}

function groupComparison(
  facets: readonly Pi0PerformanceFacet[],
  coordinate: Pi0PerformanceCoordinate,
): Pi0PerformanceGroupComparison {
  const measurements = facets.flatMap((facet) => {
    const cell = measuredAt(facet, coordinate);
    return cell ? [{ facet, cell }] : [];
  });
  if (measurements.length === 1) {
    return { state: "measured", ...measurements[0]! };
  }
  if (measurements.length > 1) return { state: "multiple_contracts", measurements };
  return { state: "unavailable" };
}

function defaultCoordinate(groups: readonly { facets: readonly Pi0PerformanceFacet[] }[]): Pi0PerformanceDefaultCoordinate {
  const coordinates = PI0_PERFORMANCE_TARGET.cameraViews.flatMap((cameraViews) =>
    PI0_PERFORMANCE_TARGET.actionChunks.map((actionChunk) => ({ cameraViews, actionChunk })),
  );
  return coordinates
    .map((coordinate) => ({
      ...coordinate,
      measuredGroupCount: groups.filter((group) =>
        groupComparison(group.facets, coordinate).state === "measured").length,
    }))
    .sort((left, right) =>
      right.measuredGroupCount - left.measuredGroupCount
      || right.actionChunk - left.actionChunk
      || left.cameraViews - right.cameraViews,
    )[0] ?? { cameraViews: 1, actionChunk: 50, measuredGroupCount: 0 };
}

function primaryFacet(
  facets: readonly Pi0PerformanceFacet[],
  comparison: Pi0PerformanceGroupComparison,
): Pi0PerformanceFacet {
  if (comparison.state === "measured") return comparison.facet;
  return [...facets].sort((left, right) =>
    right.measuredCellCount - left.measuredCellCount
    || Number(Boolean(right.nativeEvidenceSelection)) - Number(Boolean(left.nativeEvidenceSelection))
    || left.id.localeCompare(right.id),
  )[0]!;
}

export function buildPi0PerformanceOverview({
  data,
  hardwareId,
  realizations,
}: {
  data: AtlasData;
  hardwareId: string | null;
  realizations?: readonly RuntimeRealizationRecord[];
}): Pi0PerformanceOverviewModel {
  const availableRealizations = realizations ?? (data.datasets.runtime_realizations ?? [])
    .filter((record) => isRuntimeRealizationRecord(record, "pi0"))
    .map(adaptRuntimeRealization);
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
      const facetRealizations = availableRealizations.filter((realization) =>
        realization.modelId === "pi0"
        && realization.runtimeId === facet.runtimeId
        && realization.precisionPaths.some((path) => path.precisionPathId === facet.precisionId),
      );
      const series = PI0_PERFORMANCE_TARGET.actionChunks.map((actionChunk): Pi0PerformanceSeries => ({
        actionChunk,
        cells: PI0_PERFORMANCE_TARGET.cameraViews.map((cameraViews) =>
          cellFor(facet.rows, facetRealizations, facet.id, cameraViews, actionChunk),
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
        nativeEvidenceSelection: nativeEvidenceSelection(facet.rows, facet.id),
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
  const groupedFacets = new Map<string, Pi0PerformanceFacet[]>();
  builtFacets.forEach((facet) => {
    const key = `${facet.runtimeId}\u0000${facet.precisionId}`;
    groupedFacets.set(key, [...(groupedFacets.get(key) ?? []), facet]);
  });
  const groupedEntries = [...groupedFacets.values()];
  const selectedCoordinate = defaultCoordinate(groupedEntries.map((facets) => ({ facets })));
  const groups = groupedEntries.map((facets): Pi0PerformanceGroup => {
    const first = facets[0]!;
    const comparison = groupComparison(facets, selectedCoordinate);
    return {
      id: `pi0-group-${first.runtimeId}-${first.precisionId}`,
      runtimeId: first.runtimeId,
      runtimeLabel: first.runtimeLabel,
      hardwareId: first.hardwareId,
      precisionId: first.precisionId,
      facets,
      primaryFacetId: primaryFacet(facets, comparison).id,
      comparison,
    };
  });
  const hardwareLabel = hardwareId === null
    ? "全部硬件"
    : data.datasets.devices.find((device) => device.device_id === hardwareId)?.display_name ?? hardwareId;

  return {
    target: PI0_PERFORMANCE_TARGET,
    hardwareId,
    hardwareLabel,
    facets: builtFacets,
    groups,
    defaultCoordinate: selectedCoordinate,
    measuredCellCount,
    targetCellCount,
  };
}
