import type { AtlasData, RunRecord } from "../../../types/atlas";
import { buildEvidenceRows, type TimingValue } from "../../end-to-end/domain/buildEvidenceRows";
import type { ProfilerEvidence, ProfilerTool } from "../../profiler/domain/types";
import type { RuntimeStackState, RuntimeStackSummary } from "./resolveRuntimeRealization";

export interface RuntimeSystemSlice {
  cameraViews: number;
  promptTokens: number;
}

export interface RuntimeSystemSliceOptions {
  cameraViews: readonly number[];
  promptTokens: readonly number[];
}

export interface RuntimeSystemContract {
  actionShape: readonly [number | null, number | null];
  inputContractId: string;
  outputContractId: string;
  timingBoundaryId: string;
  stateReuse: string;
  operatingPointId: string;
}

export type ProfilerCoverage =
  | { state: "available"; captureCount: number }
  | { state: "missing"; captureCount: 0 };

export type ProfilerCoverageByTool = Readonly<Record<ProfilerTool, ProfilerCoverage>>;

export interface RuntimeSystemMeasuredRow {
  runtimeId: string;
  runtimeLabel: string;
  precisionId: string;
  precisionLabel: string;
  latency: TimingValue | null;
  p95: TimingValue | null;
  sampleCount: number | null;
  profiler: ProfilerCoverageByTool;
}

export interface RuntimeSystemContractGroup {
  id: string;
  contract: RuntimeSystemContract;
  rows: readonly RuntimeSystemMeasuredRow[];
}

export interface RuntimeSystemUnavailableStack {
  runtimeId: string;
  displayName: string;
  state: Exclude<RuntimeStackState, "有实测配置">;
}

export interface RuntimeSystemSummaryModel {
  slice: RuntimeSystemSlice;
  sliceOptions: RuntimeSystemSliceOptions;
  contractGroups: readonly RuntimeSystemContractGroup[];
  unavailable: readonly RuntimeSystemUnavailableStack[];
}

function comparableSlices(data: AtlasData, modelId: string, hardwareId: string | null): RuntimeSystemSliceOptions {
  const rows = buildEvidenceRows(data, modelId, { runtimeId: null, hardwareId, entity: null }).allRows;
  const values = rows.flatMap((row) => {
    const vla = row.run.workload.vla;
    if (
      row.measurement.evidence !== "measured_local"
      || vla?.camera_views === null
      || vla?.camera_views === undefined
      || vla.executed_prompt_tokens === null
      || vla.executed_prompt_tokens === undefined
    ) return [];
    return [vla];
  });
  return {
    cameraViews: [...new Set(values.map((value) => value.camera_views!))].sort((a, b) => a - b),
    promptTokens: [...new Set(values.map((value) => value.executed_prompt_tokens!))].sort((a, b) => a - b),
  };
}

function contractFor(run: RunRecord): RuntimeSystemContract {
  const vla = run.workload.vla;
  return {
    actionShape: [vla?.action_chunk ?? null, vla?.action_dimension ?? null],
    inputContractId: run.workload.common.input_contract_id,
    outputContractId: run.workload.common.output_contract_id,
    timingBoundaryId: run.timing.timing_boundary_id,
    stateReuse: run.timing.state_reuse,
    operatingPointId: run.operating_point.operating_point_id,
  };
}

function contractId(contract: RuntimeSystemContract): string {
  return [
    contract.actionShape.join("x"),
    contract.inputContractId,
    contract.outputContractId,
    contract.timingBoundaryId,
    contract.stateReuse,
    contract.operatingPointId,
  ].join("|");
}

function profilerCounts(profiler: ProfilerEvidence, data: AtlasData, modelId: string, hardwareId: string | null) {
  const runs = new Map(data.datasets.runs.map((run) => [run.run_id, run]));
  const counts = new Map<string, Record<ProfilerTool, number>>();
  profiler.captures.forEach((capture) => {
    const run = runs.get(capture.runId);
    if (
      !run
      || run.evidence !== "measured_local"
      || run.model_id !== modelId
      || (hardwareId !== null && run.device_id !== hardwareId)
    ) return;
    const key = `${run.runtime_id}\u0000${run.precision.precision_id}`;
    const count = counts.get(key) ?? { nsys: 0, ncu: 0 };
    count[capture.tool] += 1;
    counts.set(key, count);
  });
  return counts;
}

function precisionLabel(summaries: readonly RuntimeStackSummary[], runtimeId: string, precisionId: string): string {
  return summaries.find((summary) => summary.runtimeId === runtimeId)
    ?.actualPrecisions.find((precision) => precision.id === precisionId)
    ?.label ?? precisionId;
}

export function buildRuntimeSystemSummary({
  data,
  profiler,
  summaries,
  modelId,
  hardwareId,
  slice,
}: {
  data: AtlasData;
  profiler: ProfilerEvidence;
  summaries: readonly RuntimeStackSummary[];
  modelId: string;
  hardwareId: string | null;
  slice: RuntimeSystemSlice;
}): RuntimeSystemSummaryModel {
  const evidence = buildEvidenceRows(data, modelId, { runtimeId: null, hardwareId, entity: null });
  const counts = profilerCounts(profiler, data, modelId, hardwareId);
  const groups = new Map<string, { contract: RuntimeSystemContract; rows: RuntimeSystemMeasuredRow[] }>();

  evidence.allRows.forEach((evidenceRow) => {
    const { run, measurement } = evidenceRow;
    const vla = run.workload.vla;
    if (
      measurement.evidence !== "measured_local"
      || vla?.camera_views !== slice.cameraViews
      || vla.executed_prompt_tokens !== slice.promptTokens
    ) return;
    const contract = contractFor(run);
    const id = contractId(contract);
    const group = groups.get(id) ?? { contract, rows: [] };
    const p95 = measurement.statistics.find((value) => value.statistic === "p95") ?? null;
    const count = counts.get(`${run.runtime_id}\u0000${run.precision.precision_id}`) ?? { nsys: 0, ncu: 0 };
    group.rows.push({
      runtimeId: run.runtime_id,
      runtimeLabel: evidenceRow.runtimeLabel,
      precisionId: run.precision.precision_id,
      precisionLabel: precisionLabel(summaries, run.runtime_id, run.precision.precision_id),
      latency: evidenceRow.selected,
      p95,
      sampleCount: measurement.sampleCount,
      profiler: {
        nsys: count.nsys ? { state: "available", captureCount: count.nsys } : { state: "missing", captureCount: 0 },
        ncu: count.ncu ? { state: "available", captureCount: count.ncu } : { state: "missing", captureCount: 0 },
      },
    });
    groups.set(id, group);
  });

  return {
    slice,
    sliceOptions: comparableSlices(data, modelId, hardwareId),
    contractGroups: [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, group]) => ({
        id,
        contract: group.contract,
        rows: group.rows.sort((left, right) => (
          left.runtimeId.localeCompare(right.runtimeId) || left.precisionId.localeCompare(right.precisionId)
        )),
      })),
    unavailable: summaries
      .filter((summary): summary is RuntimeStackSummary & { state: Exclude<RuntimeStackState, "有实测配置"> } => summary.state !== "有实测配置")
      .map(({ runtimeId, displayName, state }) => ({ runtimeId, displayName, state })),
  };
}
