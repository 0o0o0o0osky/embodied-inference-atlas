import type {
  AtlasData,
  CanonicalRecord,
  EvidenceClass,
  RunRecord,
} from "../../../types/atlas";
import { parseEntityKey } from "../../workbench/entityKeys";

export type TimingStatistic = "min" | "mean" | "p50" | "p95" | "max" | "sum" | "analytical_estimate";

export interface TimingValue {
  statistic: TimingStatistic;
  value: number | null;
  unit: string;
}

export interface TimingMeasurement {
  measurementId: string;
  runId: string;
  sourceId: string;
  evidence: EvidenceClass;
  measurementMethod: string;
  metric: string;
  statistics: readonly TimingValue[];
  sampleCount: number;
  percentileMethod: string | null;
  workUnit: string;
  timingBoundaryId: string;
  missingReason: string | null;
}

export interface StageMeasurement extends TimingMeasurement {
  stageId: string;
  parentStageId: string | null;
  aggregation: "interval" | "summary" | "analytical";
  additive: boolean;
  executionCount: number;
}

export interface EvidenceRow {
  run: RunRecord;
  measurement: TimingMeasurement;
  stages: readonly StageMeasurement[];
  runtimeLabel: string;
  hardwareLabel: string;
  selected: TimingValue | null;
  comparisonNote: string;
  workloadLabel: string;
}

export interface EvidencePlane {
  evidence: EvidenceClass;
  rows: readonly EvidenceRow[];
}

export interface EvidenceRowsModel {
  allRows: readonly EvidenceRow[];
  planes: readonly EvidencePlane[];
  selectedRow: EvidenceRow | null;
  modelCounts: Record<EvidenceClass, number>;
  visibleCounts: Record<EvidenceClass, number>;
  activeFilter: string;
}

const EVIDENCE_PLANES: readonly EvidenceClass[] = [
  "measured_local",
  "analytical",
  "reported_external",
];

const DEFAULT_RUNS: Readonly<Record<string, string>> = {
  pi0: "run-flashrt-pi0-matrix-008",
  pi05: "run-flashrt-pi05-matrix-008",
  smolvla: "run-lerobot-smolvla-matrix-006",
};

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function timingValues(value: unknown): TimingValue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const raw = item as CanonicalRecord;
    const statistic = text(raw.statistic);
    const unit = text(raw.unit);
    if (!statistic || !unit) return [];
    return [{
      statistic: statistic as TimingStatistic,
      value: raw.value === null ? null : finite(raw.value),
      unit,
    }];
  });
}

function adaptTiming(record: CanonicalRecord): TimingMeasurement | null {
  const measurementId = text(record.measurement_id);
  const runId = text(record.run_id);
  const sourceId = text(record.source_id);
  const evidence = text(record.evidence) as EvidenceClass | null;
  const measurementMethod = text(record.measurement_method);
  const metric = text(record.metric);
  const workUnit = text(record.work_unit);
  const timingBoundaryId = text(record.timing_boundary_id);
  const sampleCount = finite(record.sample_count);
  if (!measurementId || !runId || !sourceId || !evidence || !measurementMethod || !metric || !workUnit || !timingBoundaryId || sampleCount === null) {
    return null;
  }
  return {
    measurementId,
    runId,
    sourceId,
    evidence,
    measurementMethod,
    metric,
    statistics: timingValues(record.statistics),
    sampleCount,
    percentileMethod: record.percentile_method === null ? null : text(record.percentile_method),
    workUnit,
    timingBoundaryId,
    missingReason: record.missing_reason === null ? null : text(record.missing_reason),
  };
}

function adaptStage(record: CanonicalRecord): StageMeasurement | null {
  const timing = adaptTiming(record);
  const stageId = text(record.stage_id);
  const aggregation = text(record.aggregation) as StageMeasurement["aggregation"] | null;
  const executionCount = finite(record.execution_count);
  if (!timing || !stageId || !aggregation || executionCount === null || typeof record.additive !== "boolean") return null;
  return {
    ...timing,
    stageId,
    parentStageId: record.parent_stage_id === null ? null : text(record.parent_stage_id),
    aggregation,
    additive: record.additive,
    executionCount,
  };
}

export function selectedTiming(
  evidence: EvidenceClass,
  statistics: readonly TimingValue[],
): TimingValue | null {
  const order: readonly TimingStatistic[] = evidence === "analytical"
    ? ["analytical_estimate"]
    : ["mean", "p50"];
  for (const statistic of order) {
    const value = statistics.find((item) => item.statistic === statistic && item.value !== null);
    if (value) return value;
  }
  return null;
}

function workloadLabel(run: RunRecord): string {
  const workload = run.workload.vla;
  if (!workload) return `${run.workload.common.batch_size} batch · non-VLA contract`;
  const image = workload.image_height === null || workload.image_width === null
    ? "image not reported"
    : `${workload.image_height}×${workload.image_width}`;
  const prompt = workload.executed_prompt_tokens === null
    ? "prompt not reported"
    : `${workload.executed_prompt_tokens} executed tokens`;
  const action = workload.action_chunk === null || workload.action_dimension === null
    ? "action shape not reported"
    : `${workload.action_chunk}×${workload.action_dimension} action`;
  const views = workload.camera_views === null ? "views not reported" : `${workload.camera_views} view${workload.camera_views === 1 ? "" : "s"}`;
  const denoise = workload.denoise_steps === null ? "" : ` · ${workload.denoise_steps} denoise`;
  return `${views} · ${image} · ${prompt} · ${action}${denoise}`;
}

function comparisonNote(run: RunRecord): string {
  if (run.correctness.status === "failed") return "Ratio blocked · correctness failed";
  if (run.evidence === "analytical") return "Analytical estimate · no measured ratio";
  if (run.operating_point.operating_point_id === "unknown") {
    return "Values only · operating point invariant unknown";
  }
  if (run.correctness.status !== "passed") return "Values only · correctness not assessed";
  return "Single-run value · no ratio emitted";
}

function countRows(rows: readonly EvidenceRow[]) {
  return Object.fromEntries(EVIDENCE_PLANES.map((evidence) => [
    evidence,
    rows.filter((row) => row.measurement.evidence === evidence).length,
  ])) as Record<EvidenceClass, number>;
}

export function buildEvidenceRows(
  data: AtlasData,
  modelId: string,
  filters: { runtimeId: string | null; hardwareId: string | null; entity: string | null },
): EvidenceRowsModel {
  const runById = new Map(data.datasets.runs.map((run) => [run.run_id, run]));
  const stagesByRun = new Map<string, StageMeasurement[]>();
  data.datasets.stages.forEach((record) => {
    const stage = adaptStage(record);
    if (!stage) return;
    const values = stagesByRun.get(stage.runId) ?? [];
    values.push(stage);
    stagesByRun.set(stage.runId, values);
  });
  const runtimeLabels = new Map(data.datasets.runtimes.map((runtime) => [runtime.runtime_id, runtime.display_name]));
  const hardwareLabels = new Map(data.datasets.devices.map((device) => [device.device_id, device.display_name]));

  const modelRows = data.datasets.end_to_end.flatMap((record): EvidenceRow[] => {
    const measurement = adaptTiming(record);
    if (!measurement) return [];
    const run = runById.get(measurement.runId);
    if (!run || run.model_id !== modelId || run.evidence !== measurement.evidence) return [];
    return [{
      run,
      measurement,
      stages: stagesByRun.get(run.run_id) ?? [],
      runtimeLabel: runtimeLabels.get(run.runtime_id) ?? run.runtime_id,
      hardwareLabel: hardwareLabels.get(run.device_id) ?? run.device_id,
      selected: selectedTiming(measurement.evidence, measurement.statistics),
      comparisonNote: comparisonNote(run),
      workloadLabel: workloadLabel(run),
    }];
  });

  const rows = modelRows.filter((row) =>
    (!filters.runtimeId || row.run.runtime_id === filters.runtimeId)
    && (!filters.hardwareId || row.run.device_id === filters.hardwareId),
  );
  const parsed = parseEntityKey(filters.entity);
  const requestedRunId = parsed?.kind === "run" ? parsed.runId : null;
  const defaultRunId = DEFAULT_RUNS[modelId] ?? null;
  const selectedRow = rows.find((row) => row.run.run_id === requestedRunId)
    ?? rows.find((row) => row.run.run_id === defaultRunId)
    ?? rows[0]
    ?? null;
  const planes = EVIDENCE_PLANES.map((evidence) => ({
    evidence,
    rows: rows.filter((row) => row.measurement.evidence === evidence),
  }));
  const labels = [
    filters.runtimeId ? `runtime ${runtimeLabels.get(filters.runtimeId) ?? filters.runtimeId}` : null,
    filters.hardwareId ? `hardware ${hardwareLabels.get(filters.hardwareId) ?? filters.hardwareId}` : null,
  ].filter((value): value is string => value !== null);
  return {
    allRows: rows,
    planes,
    selectedRow,
    modelCounts: countRows(modelRows),
    visibleCounts: countRows(rows),
    activeFilter: labels.length ? labels.join(" / ") : "all canonical model timing records",
  };
}

export type StagePartitionStatus = "not_collected" | "additive_reconciled" | "non_additive_summaries" | "incomplete";

export function stagePartitionStatus(row: EvidenceRow): StagePartitionStatus {
  if (!row.stages.length) return "not_collected";
  if (row.stages.some((stage) => !stage.additive)) return "non_additive_summaries";
  if (!row.selected) return "incomplete";
  const values = row.stages.map((stage) => selectedTiming(stage.evidence, stage.statistics));
  if (values.some((value) => !value || value.value === null || value.unit !== row.selected!.unit)) return "incomplete";
  if (row.stages.some((stage) => stage.timingBoundaryId !== row.measurement.timingBoundaryId)) return "incomplete";
  const total = values.reduce((sum, value) => sum + value!.value!, 0);
  const tolerance = Math.max(0.001, row.selected.value! * 1e-9);
  return Math.abs(total - row.selected.value!) <= tolerance ? "additive_reconciled" : "incomplete";
}
