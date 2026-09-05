import type { AtlasData, RunRecord } from "../../../types/atlas";
import type { ProfilerEvidenceIndex } from "../../profiler/domain/indexProfilerEvidence";
import type {
  KernelObservation,
  KernelSignature,
  OperatorKernelLink,
  ProfilerCapture,
  ProfilerEvidence,
  ProfilerMetric,
} from "../../profiler/domain/types";
import { parseEntityKey } from "../../workbench/entityKeys";

export interface KernelRow {
  observation: KernelObservation;
  signature: KernelSignature;
  capture: ProfilerCapture;
  run: RunRecord;
  metrics: ReadonlyMap<ProfilerMetric["metricName"], ProfilerMetric>;
  links: readonly OperatorKernelLink[];
}

export interface KernelInventory {
  captures: number;
  nsysCaptures: number;
  ncuCaptures: number;
  timelines: number;
  signatures: number;
  observations: number;
  ncuReplays: number;
  profilerMetrics: number;
  numericMetrics: number;
  missingMetrics: number;
  links: number;
  telemetry: number;
  rooflineEligibleKernelPoints: number;
  sectionReplays: number;
  explicitInvocationReplays: number;
  selectedMatchReplays: number;
}

export interface KernelRowsModel {
  rows: readonly KernelRow[];
  selectedRow: KernelRow | null;
  relatedNsys: KernelRow | null;
  relatedNcu: KernelRow | null;
  inventory: KernelInventory;
  unclassified: {
    launches: number;
    totalLaunches: number;
    durationNs: number;
    totalDurationNs: number;
  } | null;
  activeFilter: string;
}

const DEFAULT_OBSERVATION = "kernel-observation-pi0-flashrt-nsys-node-006";

function metricMap(metrics: readonly ProfilerMetric[]) {
  return new Map(metrics.map((metric) => [metric.metricName, metric]));
}

function modelEvidence(
  data: AtlasData,
  evidence: ProfilerEvidence,
  index: ProfilerEvidenceIndex,
  modelId: string,
) {
  const modelRunIds = new Set(data.datasets.runs
    .filter((run) => run.model_id === modelId)
    .map((run) => run.run_id));
  const signatureIds = new Set(evidence.signatures.filter((signature) => signature.modelId === modelId).map((signature) => signature.kernelSignatureId));
  const observations = evidence.observations.filter((observation) => signatureIds.has(observation.kernelSignatureId));
  const captures = evidence.captures.filter((capture) => modelRunIds.has(capture.runId));
  const captureIds = new Set(captures.map((capture) => capture.captureId));
  return {
    signatures: evidence.signatures.filter((signature) => signatureIds.has(signature.kernelSignatureId)),
    observations,
    captures,
    timelines: evidence.timelines.filter((timeline) => captureIds.has(timeline.captureId)),
    metrics: evidence.metrics.filter((metric) => modelRunIds.has(metric.runId)),
    links: evidence.links.filter((link) => modelRunIds.has(link.runId)),
    telemetry: evidence.telemetry.filter((item) => captureIds.has(item.captureId)),
    rooflineEligibleKernelPoints: (() => {
      const scenariosById = new Map(data.datasets.roofline_scenarios.flatMap((record) =>
        typeof record.scenario_id === "string" && typeof record.model_id === "string"
          ? [[record.scenario_id, record.model_id] as const]
          : [],
      ));
      const modelBasisIds = new Set(data.datasets.roofline_bases.flatMap((record) =>
        typeof record.basis_id === "string"
        && typeof record.scenario_id === "string"
        && scenariosById.get(record.scenario_id) === modelId
          ? [record.basis_id]
          : [],
      ));
      return data.datasets.roofline_points.filter((point) => {
        const entity = point.entity;
        return typeof point.basis_id === "string"
          && modelBasisIds.has(point.basis_id)
          && typeof entity === "object" && entity !== null && !Array.isArray(entity)
          && (entity as Record<string, unknown>).kind === "kernel";
      }).length;
    })(),
    sectionReplays: observations.filter((observation) =>
      observation.observationKind === "ncu_replayed_launch"
      && index.metricsBySubjectId.get(`kernel_observation:${observation.observationId}`)?.some((metric) => metric.metricName === "gpc_cycle_rate_hz"),
    ).length,
  };
}

function buildInventory(
  model: ReturnType<typeof modelEvidence>,
): KernelInventory {
  const ncuCaptures = model.captures.filter((capture) => capture.tool === "ncu");
  return {
    captures: model.captures.length,
    nsysCaptures: model.captures.filter((capture) => capture.tool === "nsys").length,
    ncuCaptures: ncuCaptures.length,
    timelines: model.timelines.length,
    signatures: model.signatures.length,
    observations: model.observations.length,
    ncuReplays: model.observations.filter((observation) => observation.observationKind === "ncu_replayed_launch").length,
    profilerMetrics: model.metrics.length,
    numericMetrics: model.metrics.filter((metric) => metric.value !== null).length,
    missingMetrics: model.metrics.filter((metric) => metric.missingReason !== null).length,
    links: model.links.length,
    telemetry: model.telemetry.length,
    rooflineEligibleKernelPoints: model.rooflineEligibleKernelPoints,
    sectionReplays: model.sectionReplays,
    explicitInvocationReplays: ncuCaptures.filter((capture) => capture.selectionPolicy === "explicit_invocation").length,
    selectedMatchReplays: ncuCaptures.filter((capture) => capture.selectionPolicy === "name_filter_selected_match").length,
  };
}

function unclassifiedCoverage(
  data: AtlasData,
  evidence: ProfilerEvidence,
  query: { modelId: string; runtimeId: string | null; hardwareId: string | null },
) {
  const runById = new Map(data.datasets.runs.map((run) => [run.run_id, run]));
  const timeline = evidence.timelines.find((item) => {
    const capture = evidence.captures.find((candidate) => candidate.captureId === item.captureId);
    const run = capture ? runById.get(capture.runId) : null;
    return capture?.nsys?.reportMode === "node"
      && run?.model_id === query.modelId
      && (!query.runtimeId || run.runtime_id === query.runtimeId)
      && (!query.hardwareId || run.device_id === query.hardwareId);
  });
  if (!timeline) return null;
  const kernels = timeline.events.filter((event) => event.eventKind === "kernel");
  const unclassified = kernels.filter((event) => event.kernelSignatureId === null);
  return {
    launches: unclassified.length,
    totalLaunches: kernels.length,
    durationNs: unclassified.reduce((sum, event) => sum + event.durationNs, 0),
    totalDurationNs: kernels.reduce((sum, event) => sum + event.durationNs, 0),
  };
}

export function buildKernelRows(
  data: AtlasData,
  evidence: ProfilerEvidence,
  index: ProfilerEvidenceIndex,
  query: { modelId: string; runtimeId: string | null; hardwareId: string | null; entity: string | null },
): KernelRowsModel {
  const model = modelEvidence(data, evidence, index, query.modelId);
  const runById = new Map(data.datasets.runs.map((run) => [run.run_id, run]));
  const rows = model.observations.flatMap((observation): KernelRow[] => {
    const signature = index.signatureById.get(observation.kernelSignatureId);
    const capture = index.captureById.get(observation.captureId);
    const run = runById.get(observation.runId);
    if (!signature || !capture || !run) return [];
    if (query.runtimeId && run.runtime_id !== query.runtimeId) return [];
    if (query.hardwareId && run.device_id !== query.hardwareId) return [];
    return [{
      observation,
      signature,
      capture,
      run,
      metrics: metricMap(index.metricsBySubjectId.get(`kernel_observation:${observation.observationId}`) ?? []),
      links: index.linksByObservationId.get(observation.observationId) ?? [],
    }];
  });

  const shareBySignature = new Map<string, number>();
  rows.forEach((row) => {
    if (row.observation.observationKind.startsWith("nsys_") && row.observation.durationShare) {
      shareBySignature.set(row.signature.kernelSignatureId, row.observation.durationShare.value);
    }
  });
  rows.sort((left, right) => {
    const share = (shareBySignature.get(right.signature.kernelSignatureId) ?? -1)
      - (shareBySignature.get(left.signature.kernelSignatureId) ?? -1);
    if (share) return share;
    const signature = left.signature.labelSanitized.localeCompare(right.signature.labelSanitized);
    if (signature) return signature;
    const rank = (row: KernelRow) => row.observation.observationKind.startsWith("nsys_") ? 0 : 1;
    return rank(left) - rank(right) || left.observation.observationId.localeCompare(right.observation.observationId);
  });

  const parsed = parseEntityKey(query.entity);
  const requested = parsed?.kind === "kernel"
    ? rows.find((row) => row.observation.captureId === parsed.captureId && row.observation.observationId === parsed.kernelObservationId) ?? null
    : null;
  const selectedRow = requested
    ?? rows.find((row) => row.observation.observationId === DEFAULT_OBSERVATION)
    ?? rows[0]
    ?? null;
  const siblings = selectedRow
    ? rows.filter((row) => row.signature.kernelSignatureId === selectedRow.signature.kernelSignatureId)
    : [];
  const labels = [query.runtimeId ? `runtime ${query.runtimeId}` : null, query.hardwareId ? `hardware ${query.hardwareId}` : null]
    .filter((value): value is string => value !== null);
  return {
    rows,
    selectedRow,
    relatedNsys: siblings.find((row) => row.observation.observationKind.startsWith("nsys_")) ?? null,
    relatedNcu: siblings.find((row) => row.observation.observationKind === "ncu_replayed_launch") ?? null,
    inventory: buildInventory(model),
    unclassified: unclassifiedCoverage(data, evidence, query),
    activeFilter: labels.length ? labels.join(" / ") : "all profiler evidence for this model",
  };
}
