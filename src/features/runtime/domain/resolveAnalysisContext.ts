import { parseEntityKey } from "../../workbench/entityKeys";
import type { RouteState } from "../../../app/routes";
import type { AtlasData, CanonicalRecord, ComparisonContextRecord, ModelRecord } from "../../../types/atlas";
import { adaptV1ModelGraph } from "../../model-graph/domain/adaptV1ModelGraph";
import { workloadOverrides } from "../../model-graph/domain/workload";
import { buildEvidenceRows } from "../../end-to-end/domain/buildEvidenceRows";
import { buildKernelRows } from "../../performance/domain/buildKernelRows";
import { adaptProfilerEvidence } from "../../profiler/domain/adaptProfilerEvidence";
import { indexProfilerEvidence } from "../../profiler/domain/indexProfilerEvidence";
import { buildTimelineView } from "../../timeline/domain/buildTimelineView";
import { adaptRuntimeRealization, isRuntimeRealizationRecord } from "./adaptRuntimeRealization";
import { buildRuntimeStackSummaries, resolveRuntimeCandidates } from "./resolveRuntimeRealization";
import { resolveRuntimeBounds } from "./runtimeBounds";
import { runtimeProfilerSlice, scopeRuntimeProfiler, selectIndependentNcuReplayEvidence, selectRuntimeProfilerCaptures } from "./scopeRuntimeProfiler";
import { buildTraceBatches, endToEndBatch } from './analysisSamples';

export interface AnalysisContextInput {
  data: AtlasData;
  model: ModelRecord;
  record: CanonicalRecord | null;
  route: RouteState;
  /** A resolved comparison facet for symbolic inputs; never an arbitrary run. */
  facetContext?: ComparisonContextRecord | null;
}

/** Shared selection for summaries, timelines, implementation and kernel diagnosis.
 * Independent captures retain identities; theoretical availability cannot hide timing.
 */
export function resolveAnalysisContext({ data, model, record, route, facetContext = null }: AnalysisContextInput) {
  const reasons: string[] = [];
  if (!route.workload && route.timelineCapture) {
    const capture = data.datasets.profiler_captures.find(item => item.capture_id === route.timelineCapture);
    const captureRun = data.datasets.runs.find(item => item.run_id === capture?.run_id
      && item.model_id === model.model_id && (!route.runtime || item.runtime_id === route.runtime)
      && (!route.hardware || item.device_id === route.hardware)
      && (!route.runtimePrecision || item.precision.precision_id === route.runtimePrecision));
    if (captureRun) route = {...route,workload:captureRun.configuration_id};
  }
  const defaultGraph = record ? adaptV1ModelGraph(record) : null;
  if (!defaultGraph) reasons.push("model_graph_unavailable");
  const defaultSymbols = defaultGraph?.editableSymbols ?? [];
  const contextRuns = data.datasets.runs.filter((run) => run.model_id === model.model_id
    && run.runtime_id === route.runtime && run.device_id === route.hardware
    && (!route.runtimePrecision || run.precision.precision_id === route.runtimePrecision));
  const configurationRuns = contextRuns.filter((run) => run.configuration_id === route.workload);
  const precisionIds = [...new Set((configurationRuns.length ? configurationRuns : contextRuns)
    .filter((run) => run.evidence === "measured_local").map((run) => run.precision.precision_id))];
  const actualPrecision = route.runtimePrecision ?? (precisionIds.length === 1 ? precisionIds[0]! : null);
  const selectedRuns = configurationRuns.filter((run) => run.precision.precision_id === actualPrecision
    && (!route.selectedRun || run.run_id === route.selectedRun));
  if (route.selectedRun && !selectedRuns.length) reasons.push("requested_run_unavailable");
  const stableRuns = selectedRuns.filter(run=>endToEndBatch(run)?.status==='stable')
    .sort((a,b)=>a.run_id.localeCompare(b.run_id));
  const selectedRun = selectedRuns.length === 1 ? selectedRuns[0]! : stableRuns[0] ?? null;
  if (selectedRuns.length > 1 && !selectedRun) reasons.push("ambiguous_run");
  const isConfiguration = route.workload !== null && !route.workload.includes("=");
  if (isConfiguration && !selectedRuns.length) reasons.push("configuration_unavailable");
  if (route.runtime && !actualPrecision) reasons.push("precision_unavailable_or_ambiguous");

  const aliases: Record<string, string> = { v: "V", p: "L_PROMPT", a: "T_ACTION", n: "N_DENOISE" };
  const vla = selectedRun?.workload.vla;
  const normalizedWorkload = selectedRun
    ? [["V", vla?.camera_views], ["L_PROMPT", vla?.executed_prompt_tokens],
      ["T_ACTION", vla?.action_chunk], ["N_DENOISE", vla?.denoise_steps]]
      .filter(([, value]) => value != null).map(([name, value]) => `${name}=${value}`).join(",")
    : route.workload && !isConfiguration ? route.workload.split(",").map((binding) => {
      const [name, value] = binding.split("=", 2);
      return `${aliases[name!.trim()] ?? name!.trim()}=${value}`;
    }).join(",") : defaultSymbols.map((symbol) => `${symbol.symbol}=${symbol.defaultValue}`).join(",");
  // Explicit input remains meaningful before the model DAG is authored.
  // Only declared dimensions enter this fallback; there are no model defaults.
  const explicitInput = Object.fromEntries(normalizedWorkload.split(',').flatMap(binding=>{
    const [name, encoded] = binding.split('=',2);
    const minimum = name === 'L_PROMPT' ? 0 : ['V','T_ACTION','N_DENOISE'].includes(name ?? '') ? 1 : null;
    const value = Number(encoded);
    return minimum !== null && encoded?.trim() && Number.isSafeInteger(value) && value >= minimum ? [[name!,value]] : [];
  }));
  const overrides = defaultGraph ? workloadOverrides(normalizedWorkload, defaultSymbols) : explicitInput;
  // Scope configuration lookup before calling the legacy helper: configuration
  // identifiers must never select another model, runtime or precision implicitly.
  const selectionData = { ...data, datasets: { ...data.datasets, runs: selectedRun ? [selectedRun] : [] } };
  const slice = runtimeProfilerSlice(selectionData, selectedRun?.configuration_id ?? normalizedWorkload,
    isConfiguration ? null : facetContext);
  if (!selectedRun) {
    slice.cameraViews = overrides.V ?? null;
    slice.promptTokens = overrides.L_PROMPT ?? null;
    slice.actionChunk = overrides.T_ACTION ?? null;
    slice.denoiseSteps = overrides.N_DENOISE ?? null;
  }
  const workload = selectedRun?.configuration_id ?? normalizedWorkload;
  const realizations = data.datasets.runtime_realizations
    .filter((item) => isRuntimeRealizationRecord(item, model.model_id)).map(adaptRuntimeRealization);
  const canonicalConfigurationIds = new Set([...data.datasets.runs.map((run) => run.configuration_id),
    ...realizations.flatMap((item) => item.configurationIds)]);
  const summaries = defaultGraph ? buildRuntimeStackSummaries({ modelId: model.model_id, modelGraphId: defaultGraph.graphId,
    hardwareId: route.hardware, workload: null, runtimes: data.datasets.runtimes, realizations,
    runs: data.datasets.runs, canonicalConfigurationIds }) : [];
  const candidates = defaultGraph && route.runtime && route.hardware ? resolveRuntimeCandidates(realizations, data.datasets.runs, {
    modelId: model.model_id, modelGraphId: defaultGraph.graphId, runtimeId: route.runtime,
    hardwareId: route.hardware, workload, precisionId: actualPrecision, canonicalConfigurationIds,
  }) : [];
  const query = { modelId: model.model_id, runtimeId: route.runtime, hardwareId: route.hardware,
    precisionId: actualPrecision, slice };
  const profiler = adaptProfilerEvidence(data);
  const { data: scopedData, evidence: scopedProfiler, partialContextRunIds } = scopeRuntimeProfiler(data, profiler, query);
  const independentNcu = !scopedProfiler.captures.some((capture) => capture.tool === "ncu")
    ? selectIndependentNcuReplayEvidence(data, profiler, query) : null;
  const kernelData = independentNcu?.runIds.size ? { ...scopedData,
    datasets: { ...scopedData.datasets, runs: [...scopedData.datasets.runs, ...independentNcu.data.datasets.runs] } } : scopedData;
  const combined = independentNcu?.runIds.size ? { ...scopedProfiler,
    captures: [...scopedProfiler.captures, ...independentNcu.evidence.captures],
    observations: [...scopedProfiler.observations, ...independentNcu.evidence.observations],
    metrics: [...scopedProfiler.metrics, ...independentNcu.evidence.metrics],
    links: [...scopedProfiler.links, ...independentNcu.evidence.links],
    telemetry: [...scopedProfiler.telemetry, ...independentNcu.evidence.telemetry],
  } : scopedProfiler;
  const kernelPartialContextRunIds = new Set([...partialContextRunIds, ...(independentNcu?.partialContextRunIds ?? [])]);
  const activeCandidate = candidates.length === 1 ? candidates[0]! : null;
  const activeRealization = activeCandidate?.actualPrecisionId === actualPrecision ? activeCandidate?.realization ?? null : null;
  const sourceRealizations = realizations.filter((item) => item.runtimeId === route.runtime
    && (!route.hardware || item.deviceIds.includes(route.hardware))
    && item.precisionPaths.some((path) => path.precisionPathId === actualPrecision));
  const implementationRealization = activeRealization ?? (sourceRealizations.length === 1 ? sourceRealizations[0]! : null);
  // Every analysis tab shares one real trace. Explicit selection wins; otherwise
  // prefer a verified representative from the same fixed input case.
  const selectedEntity = parseEntityKey(route.entity);
  const entityCapture = selectedEntity?.kind === "timeline-event"
    ? scopedProfiler.timelines.find(item => item.timelineId === selectedEntity.timelineId)?.captureId ?? null
    : selectedEntity?.kind === "kernel" ? selectedEntity.captureId : null;
  const batch = endToEndBatch(selectedRun);
  const traceBatches = buildTraceBatches(scopedProfiler).filter(item=>!batch || item.inputCaseId===batch.inputCaseId);
  const storedSummary = scopedProfiler.captures.map(c=>c.analysisSummary).find(s=>s?.status==='stable' && (!batch || s.inputCaseId===batch.inputCaseId));
  const representative = storedSummary?.representativeCaptureId ?? traceBatches.find(item=>item.status==='stable')?.representativeCaptureId ?? null;
  const defaultCapture = representative ?? traceBatches[0]?.samples[0]?.captureId
    ?? scopedProfiler.captures.find(item=>item.nsys?.reportMode==='node')?.captureId ?? null;
  const profilerCaptureSelection = selectRuntimeProfilerCaptures(scopedProfiler, route.timelineCapture ?? entityCapture ?? defaultCapture);
  const timeline = buildTimelineView(scopedData, scopedProfiler, indexProfilerEvidence(scopedProfiler), {
    modelId: model.model_id, runtimeId: route.runtime, hardwareId: route.hardware,
    captureId: profilerCaptureSelection.timelineCaptureId, entity: route.entity,
  });
  const traceSummary = timeline.active?.capture.analysisSummary ?? null;
  const nsys = { ...timeline, requestedCaptureUnavailable: profilerCaptureSelection.requestedCaptureUnavailable };
  const captureIds = new Set(combined.captures.filter((capture) => capture.tool === "ncu"
    || capture.captureId === profilerCaptureSelection.kernelCaptureId).map((capture) => capture.captureId));
  const observations = combined.observations.filter((item) => captureIds.has(item.captureId));
  const observationIds = new Set(observations.map((item) => item.observationId));
  const kernelProfiler = { ...combined, captures: combined.captures.filter((item) => captureIds.has(item.captureId)),
    timelines: combined.timelines.filter((item) => captureIds.has(item.captureId)), observations,
    metrics: combined.metrics.filter((item) => captureIds.has(item.captureId)),
    links: combined.links.filter((item) => observationIds.has(item.observationId)),
    telemetry: combined.telemetry.filter((item) => captureIds.has(item.captureId)) };
  const kernels = buildKernelRows(kernelData, kernelProfiler, indexProfilerEvidence(kernelProfiler), {
    modelId: model.model_id, runtimeId: route.runtime, hardwareId: route.hardware, entity: route.entity,
  });
  const selectedEvidence = selectedRun ? buildEvidenceRows(data, model.model_id, {
    runtimeId: route.runtime, hardwareId: route.hardware, entity: null,
  }).allRows.find((row) => row.run.run_id === selectedRun.run_id) ?? null : null;
  // Raw samples are authoritative when present; this is a batch median, never
  // the time of the selected trace or an average of separate summary records.
  if (selectedEvidence && batch?.summary) selectedEvidence.selected = {
    statistic:'p50',value:batch.summary.median/1e6,unit:'ms',
  };
  const runtimeBounds = resolveRuntimeBounds(data, selectedRun, implementationRealization);
  if (!implementationRealization) reasons.push("implementation_unavailable_or_ambiguous");
  if (!nsys.active) reasons.push("timeline_unavailable");
  if (profilerCaptureSelection.requestedCaptureUnavailable) reasons.push("requested_capture_unavailable");
  if (!runtimeBounds.endToEnd) reasons.push("end_to_end_bound_unavailable");
  const captureIdentity = (capture: typeof profiler.captures[number]) => ({
    captureId: capture.captureId, runId: capture.runId, sourceId: capture.sourceId, tool: capture.tool,
    timingBoundaryId: data.datasets.runs.find((run) => run.run_id === capture.runId)?.timing.timing_boundary_id ?? null,
    independentOfSelectedRun: capture.runId !== selectedRun?.run_id,
  });
  const captureIdentities = {
    endToEnd: selectedRun && selectedRun.capture_method !== "nsys" && selectedRun.capture_method !== "ncu"
      && selectedRun.evidence === "measured_local" ? { runId: selectedRun.run_id, sourceId: selectedRun.source_id,
      captureMethod: selectedRun.capture_method, timingBoundaryId: selectedRun.timing.timing_boundary_id } : null,
    nsys: scopedProfiler.captures.filter((item) => item.tool === "nsys").map(captureIdentity),
    ncu: kernelProfiler.captures.filter((item) => item.tool === "ncu").map(captureIdentity),
  };
  return { defaultGraph, normalizedWorkload, overrides, workload, realizations, summaries, candidates,
    actualPrecision, activeRealization, implementationRealization, slice, scopedData, scopedProfiler,
    partialContextRunIds, independentNcu, kernelPartialContextRunIds, profilerCaptureSelection,
    nsys, kernels, selectedRun, selectedEvidence, runtimeBounds, reasons, captureIdentities, batch, traceBatches, traceSummary };
}

export type AnalysisContext = ReturnType<typeof resolveAnalysisContext>;
