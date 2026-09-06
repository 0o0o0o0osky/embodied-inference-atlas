import { useCallback, useMemo, useState } from "react";
import type { RoutePatch, RouteState } from "../../app/routes";
import type { AtlasData, CanonicalRecord, ModelRecord } from "../../types/atlas";
import { adaptV1ModelGraph } from "../model-graph/domain/adaptV1ModelGraph";
import { workloadOverrides } from "../model-graph/domain/workload";
import { buildKernelRows } from "../performance/domain/buildKernelRows";
import { buildEvidenceRows } from "../end-to-end/domain/buildEvidenceRows";
import { adaptProfilerEvidence } from "../profiler/domain/adaptProfilerEvidence";
import { indexProfilerEvidence } from "../profiler/domain/indexProfilerEvidence";
import { buildTimelineView } from "../timeline/domain/buildTimelineView";
import { kernelEntity, timelineEventEntity } from "../workbench/entityKeys";
import { Pi0ImplementationDagSection } from "./components/Pi0ImplementationDagSection";
import { Pi0KernelSection } from "./components/Pi0KernelSection";
import { Pi0NsysSection } from "./components/Pi0NsysSection";
import { Pi0PerformanceNavigation } from "./components/Pi0PerformanceNavigation";
import {
  Pi0PerformanceOverviewChart,
  type Pi0RoutablePerformanceSelection,
} from "./components/Pi0PerformanceOverviewChart";
import { Pi0SelectedRuntimeSummary } from "./components/Pi0SelectedRuntimeSummary";
import { RuntimeBoundSummary } from "./components/RuntimeBoundSummary";
import { resolveRuntimeBounds } from "./domain/runtimeBounds";
import { materializeCurrentPi0Roofline } from "../roofline/presentation/buildOperatorRooflineSummary";
import { pi0PrecisionLabel } from "./components/runtimePresentation";
import { adaptRuntimeRealization, isRuntimeRealizationRecord } from "./domain/adaptRuntimeRealization";
import { buildPi0PerformanceOverview, PI0_PERFORMANCE_TARGET } from "./domain/buildPi0PerformanceOverview";
import {
  runtimeProfilerSlice,
  scopeRuntimeProfiler,
  selectIndependentNcuReplayEvidence,
  selectRuntimeProfilerCaptures,
} from "./domain/scopeRuntimeProfiler";
import { pi0EmbeddedTimelineSelectionPatch } from "./domain/pi0PerformanceNavigation";
import { buildRuntimeStackSummaries, resolveRuntimeCandidates } from "./domain/resolveRuntimeRealization";

interface Pi0RuntimeWorkspaceProps {
  data: AtlasData;
  model: ModelRecord;
  record: CanonicalRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

const PI0_TARGET_WORKLOAD = "v=2,p=48,a=50,n=10";

function graphWorkload(data: AtlasData, route: RouteState) {
  const configuration = data.datasets.runs.find((run) => run.configuration_id === route.workload
    && run.model_id === route.model && run.device_id === route.hardware
    && (!route.runtime || run.runtime_id === route.runtime)
    && (!route.runtimePrecision || run.precision.precision_id === route.runtimePrecision));
  if (configuration?.workload.vla) {
    const vla = configuration.workload.vla;
    return [["V", vla.camera_views], ["L_PROMPT", vla.executed_prompt_tokens],
      ["T_ACTION", vla.action_chunk], ["N_DENOISE", vla.denoise_steps]]
      .filter(([, value]) => value != null).map(([name, value]) => `${name}=${value}`).join(",");
  }
  const aliases: Record<string, string> = { v: "V", p: "L_PROMPT", a: "T_ACTION", n: "N_DENOISE" };
  return (route.workload ?? PI0_TARGET_WORKLOAD).split(",").map((binding) => {
    const [name, value] = binding.split("=", 2);
    return `${aliases[name!.trim()] ?? name!.trim()}=${value}`;
  }).join(",");
}

export function Pi0RuntimeWorkspace({ data, model, record, route, navigate }: Pi0RuntimeWorkspaceProps) {
  const [analysisSection, setAnalysisSection] = useState<"system" | "implementation" | "kernel">("system");
  const defaultGraph = useMemo(() => adaptV1ModelGraph(record), [record]);
  const normalizedWorkload = useMemo(() => graphWorkload(data, route), [data, route]);
  const overrides = useMemo(() => workloadOverrides(normalizedWorkload, defaultGraph.editableSymbols), [normalizedWorkload, defaultGraph.editableSymbols]);
  const performanceOverview = useMemo(() => buildPi0PerformanceOverview({ data, hardwareId: route.hardware }), [data, route.hardware]);
  const selectedFacet = useMemo(() => {
    const matching = performanceOverview.facets.filter((facet) => facet.runtimeId === route.runtime
      && facet.precisionId === route.runtimePrecision);
    return matching.find((facet) => facet.id === route.runtimeFacet)
      ?? (route.runtimeFacet === null && matching.length === 1 ? matching[0]! : null);
  }, [performanceOverview.facets, route.runtime, route.runtimeFacet, route.runtimePrecision]);
  const slice = useMemo(() => runtimeProfilerSlice(
    data,
    route.workload,
    selectedFacet?.comparisonContext ?? null,
  ), [data, route.workload, selectedFacet]);
  const workload = route.workload ?? PI0_TARGET_WORKLOAD;
  const realizations = useMemo(() => data.datasets.runtime_realizations
    .filter((item) => isRuntimeRealizationRecord(item, model.model_id)).map(adaptRuntimeRealization),
  [data.datasets.runtime_realizations, model.model_id]);
  const canonicalConfigurationIds = useMemo(() => new Set([
    ...data.datasets.runs.map((run) => run.configuration_id),
    ...realizations.flatMap((realization) => realization.configurationIds),
  ]), [data.datasets.runs, realizations]);
  const summaries = useMemo(() => buildRuntimeStackSummaries({
    modelId: model.model_id, modelGraphId: defaultGraph.graphId, hardwareId: route.hardware,
    workload: null, runtimes: data.datasets.runtimes, realizations, runs: data.datasets.runs, canonicalConfigurationIds,
  }), [canonicalConfigurationIds, data.datasets.runs, data.datasets.runtimes, defaultGraph.graphId, model.model_id, realizations, route.hardware]);
  const candidates = useMemo(() => route.runtime && route.hardware ? resolveRuntimeCandidates(realizations, data.datasets.runs, {
    modelId: model.model_id, modelGraphId: defaultGraph.graphId, runtimeId: route.runtime,
    hardwareId: route.hardware, workload, precisionId: route.runtimePrecision, canonicalConfigurationIds,
  }) : [], [canonicalConfigurationIds, data.datasets.runs, defaultGraph.graphId, model.model_id, realizations, route.hardware, route.runtime, route.runtimePrecision, workload]);
  const activeCandidate = candidates.length === 1 ? candidates[0]! : null;
  const profiler = useMemo(() => adaptProfilerEvidence(data), [data]);
  const { data: scopedData, evidence: scopedProfiler, actualPrecision, partialContextRunIds } = useMemo(() => scopeRuntimeProfiler(data, profiler, {
    modelId: model.model_id, runtimeId: route.runtime, hardwareId: route.hardware,
    precisionId: route.runtimePrecision, slice,
  }), [data, profiler, model.model_id, route.runtime, route.hardware, route.runtimePrecision, slice]);
  const independentNcu = useMemo(() => !scopedProfiler.captures.some((capture) => capture.tool === "ncu")
    ? selectIndependentNcuReplayEvidence(data, profiler, {
      modelId: model.model_id, runtimeId: route.runtime, hardwareId: route.hardware,
      precisionId: route.runtimePrecision, slice,
    }) : null,
  [data, model.model_id, profiler, route.hardware, route.runtime, route.runtimePrecision, scopedProfiler.captures, slice]);
  const kernelData = useMemo(() => independentNcu && independentNcu.runIds.size ? {
    ...scopedData,
    datasets: { ...scopedData.datasets, runs: [...scopedData.datasets.runs, ...independentNcu.data.datasets.runs] },
  } : scopedData, [independentNcu, scopedData]);
  const profilerWithIndependentNcu = useMemo(() => independentNcu && independentNcu.runIds.size ? {
    ...scopedProfiler,
    captures: [...scopedProfiler.captures, ...independentNcu.evidence.captures],
    observations: [...scopedProfiler.observations, ...independentNcu.evidence.observations],
    metrics: [...scopedProfiler.metrics, ...independentNcu.evidence.metrics],
    links: [...scopedProfiler.links, ...independentNcu.evidence.links],
    telemetry: [...scopedProfiler.telemetry, ...independentNcu.evidence.telemetry],
  } : scopedProfiler, [independentNcu, scopedProfiler]);
  const kernelPartialContextRunIds = useMemo(() => new Set([
    ...partialContextRunIds,
    ...(independentNcu?.partialContextRunIds ?? []),
  ]), [independentNcu, partialContextRunIds]);
  const activeRealization = activeCandidate?.actualPrecisionId === actualPrecision ? activeCandidate.realization : null;
  // Source-only overlays remain inspectable without claiming correlation to a measured configuration.
  const sourceRealizations = realizations.filter((item) => item.runtimeId === route.runtime
    && (!route.hardware || item.deviceIds.includes(route.hardware))
    && item.precisionPaths.some((path) => path.precisionPathId === (actualPrecision ?? route.runtimePrecision)));
  const implementationRealization = activeRealization ?? (sourceRealizations.length === 1 ? sourceRealizations[0]! : null);
  const renderedDagOpen = Boolean(analysisSection === "implementation" && implementationRealization);
  const profilerIndex = useMemo(() => indexProfilerEvidence(scopedProfiler), [scopedProfiler]);
  const profilerCaptureSelection = useMemo(() =>
    selectRuntimeProfilerCaptures(scopedProfiler, route.timelineCapture), [scopedProfiler, route.timelineCapture]);
  const nsys = useMemo(() => {
    const timelineProfiler = scopedProfiler;
    const view = buildTimelineView(scopedData, timelineProfiler, profilerIndex, {
      modelId: model.model_id, runtimeId: route.runtime, hardwareId: route.hardware,
      captureId: profilerCaptureSelection.timelineCaptureId, entity: route.entity,
    });
    return { ...view, requestedCaptureUnavailable: profilerCaptureSelection.requestedCaptureUnavailable };
  }, [scopedData, scopedProfiler, profilerIndex, model.model_id, route.runtime, route.hardware, route.entity, profilerCaptureSelection]);
  const kernelProfiler = useMemo(() => {
    const captureIds = new Set(profilerWithIndependentNcu.captures.filter((capture) =>
      capture.tool === "ncu" || capture.captureId === profilerCaptureSelection.kernelCaptureId)
      .map((capture) => capture.captureId));
    const observations = profilerWithIndependentNcu.observations.filter((item) => captureIds.has(item.captureId));
    const observationIds = new Set(observations.map((item) => item.observationId));
    return {
      ...profilerWithIndependentNcu,
      captures: profilerWithIndependentNcu.captures.filter((capture) => captureIds.has(capture.captureId)),
      timelines: profilerWithIndependentNcu.timelines.filter((timeline) => captureIds.has(timeline.captureId)),
      observations,
      metrics: profilerWithIndependentNcu.metrics.filter((item) => captureIds.has(item.captureId)),
      links: profilerWithIndependentNcu.links.filter((item) => observationIds.has(item.observationId)),
      telemetry: profilerWithIndependentNcu.telemetry.filter((item) => captureIds.has(item.captureId)),
    };
  }, [profilerCaptureSelection.kernelCaptureId, profilerWithIndependentNcu]);
  const kernelProfilerIndex = useMemo(() => indexProfilerEvidence(kernelProfiler), [kernelProfiler]);
  const kernels = useMemo(() => buildKernelRows(kernelData, kernelProfiler, kernelProfilerIndex, {
    modelId: model.model_id, runtimeId: route.runtime, hardwareId: route.hardware, entity: null,
  }), [kernelData, kernelProfiler, kernelProfilerIndex, model.model_id, route.runtime, route.hardware]);
  const scopePatch = {
    workload,
    runtime: route.runtime,
    hardware: route.hardware,
    runtimePrecision: actualPrecision,
    runtimeFacet: route.runtimeFacet,
  };
  const selectedRun = useMemo(() => data.datasets.runs.find((run) =>
    run.configuration_id === route.workload
    && run.model_id === model.model_id
    && run.runtime_id === route.runtime
    && run.device_id === route.hardware
    && run.precision.precision_id === actualPrecision,
  ) ?? null, [actualPrecision, data.datasets.runs, model.model_id, route.hardware, route.runtime, route.workload]);
  const selectedEvidence = useMemo(() => selectedRun ? buildEvidenceRows(data, model.model_id, {
    runtimeId: route.runtime,
    hardwareId: route.hardware,
    entity: null,
  }).allRows.find((row) => row.run.run_id === selectedRun.run_id) ?? null : null,
  [data, model.model_id, route.hardware, route.runtime, selectedRun]);
  const runtimeBounds = useMemo(() => resolveRuntimeBounds(data, selectedRun, implementationRealization), [data, selectedRun, implementationRealization]);
  const modelReference = useMemo(() => route.runtime ? materializeCurrentPi0Roofline({
    data, workloadBinding: normalizedWorkload, hardwareId: route.hardware, precisionPathId: "bf16_dense",
  }) : null, [data, normalizedWorkload, route.hardware, route.runtime]);
  const runtimeLabel = summaries.find((item) => item.runtimeId === route.runtime)?.displayName ?? route.runtime ?? "未选择";
  const precisionFallback = summaries.find((item) => item.runtimeId === route.runtime)?.actualPrecisions
    .find((precision) => precision.id === actualPrecision)?.label ?? actualPrecision ?? "未记录";
  const precisionLabel = pi0PrecisionLabel(actualPrecision ?? "unknown", precisionFallback);
  const selectedWorkload = selectedRun?.workload.vla ?? {
    camera_views: overrides.V ?? 2,
    executed_prompt_tokens: overrides.L_PROMPT ?? 48,
    action_chunk: overrides.T_ACTION ?? 50,
    denoise_steps: overrides.N_DENOISE ?? 10,
  };
  const selectedWorkloadIncomplete = selectedRun !== null && [
    selectedWorkload.camera_views,
    selectedWorkload.executed_prompt_tokens,
    selectedWorkload.action_chunk,
    selectedWorkload.denoise_steps,
  ].some((item) => item === null);
  const selectedCoordinatesAreTarget = selectedRun !== null
    && selectedRun.timing.warmup_iterations === PI0_PERFORMANCE_TARGET.warmupIterations
    && selectedEvidence?.measurement.sampleCount === PI0_PERFORMANCE_TARGET.sampleCount
    && selectedWorkload.executed_prompt_tokens === PI0_PERFORMANCE_TARGET.promptTokens
    && selectedWorkload.denoise_steps === PI0_PERFORMANCE_TARGET.denoiseSteps
    && PI0_PERFORMANCE_TARGET.cameraViews.some((cameraViews) => cameraViews === selectedWorkload.camera_views)
    && PI0_PERFORMANCE_TARGET.actionChunks.some((actionChunk) => actionChunk === selectedWorkload.action_chunk);
  const selectedHasMeasuredLatency = selectedRun?.evidence === "measured_local"
    && selectedEvidence?.measurement.evidence === "measured_local"
    && selectedEvidence.measurement.metric === "latency"
    && selectedEvidence.selected?.value !== null
    && selectedEvidence.selected?.value !== undefined;
  const selectionKind = selectedHasMeasuredLatency && selectedCoordinatesAreTarget
    ? "target_measurement"
    : selectedHasMeasuredLatency && selectedRun && !selectedCoordinatesAreTarget
      ? "native_evidence"
      : "symbolic_target";
  const workloadStatus = selectionKind === "symbolic_target" || !selectedWorkloadIncomplete
    ? "complete"
    : "partial";
  const openPerformanceEvidence = useCallback((selection: Pi0RoutablePerformanceSelection) => {
    setAnalysisSection("system");
    navigate({
    runtime: selection.runtimeId,
    runtimePrecision: selection.precisionId,
    runtimeFacet: selection.facetId,
    hardware: selection.hardwareId,
    workload: selection.configurationId,
    entity: null,
    timelineCapture: null,
    basis: null,
    rooflineLevel: "overview",
    });
  }, [navigate]);

  return (
    <section className="model-graph-workspace pi0-workspace pi0-runtime-workspace" aria-labelledby="pi0-runtime-title">
      <h2 id="pi0-runtime-title" className="visually-hidden">Pi0 性能对比</h2>
      <Pi0PerformanceNavigation route={route} navigate={navigate} surface="runtime" />
      {!route.runtime ? <Pi0PerformanceOverviewChart model={performanceOverview} selectedRunId={null}
        onInspectRuntime={(runtime, runtimePrecision, coordinate) => {
          setAnalysisSection("implementation");
          navigate({ runtime, runtimePrecision, runtimeFacet: null,
            workload: `v=${coordinate.cameraViews},p=48,a=${coordinate.actionChunk},n=10`, entity: null, timelineCapture: null });
        }}
        onSelectEvidence={openPerformanceEvidence} /> : <Pi0SelectedRuntimeSummary
          runtimeLabel={runtimeLabel}
          precisionLabel={precisionLabel}
          latency={selectedEvidence?.selected ?? null}
          workload={selectedWorkload}
          workloadStatus={workloadStatus}
          selectionKind={selectionKind}
        />}
      {route.runtime ? <>
      {modelReference ? <RuntimeBoundSummary bounds={runtimeBounds} reference={modelReference}
        onOpenImplementation={() => setAnalysisSection("implementation")}
        onOpenTheory={() => navigate({ tab: "roofline-kernels", runtime: null, runtimePrecision: null,
          runtimeFacet: null, entity: null, basis: null, rooflineLevel: "stage", precision: "bf16_dense", workload: normalizedWorkload })} /> : null}
      <nav className="pi0-runtime-analysis-tabs" aria-label="推理栈分析层级">
        {([["system", "系统时间线"], ["implementation", "算子实现"], ["kernel", "Kernel 诊断"]] as const).map(([id, label]) =>
          <button type="button" key={id} aria-pressed={analysisSection === id} onClick={() => setAnalysisSection(id)}>{label}</button>)}
      </nav>
      {analysisSection === "system" ? <><Pi0NsysSection view={nsys}
        onCaptureChange={(timelineCapture) => navigate({ ...scopePatch, timelineCapture, entity: null })}
        onSelectEvent={(event) => nsys.active && navigate(pi0EmbeddedTimelineSelectionPatch({
          ...scopePatch,
          workload,
          captureId: nsys.active.capture.captureId,
          entity: timelineEventEntity(nsys.active.timeline.timelineId, event.eventId),
        }), true)}
        onOpenDetails={() => navigate({ ...scopePatch, tab: "timeline", timelineCapture: nsys.active?.capture.captureId ?? null, entity: route.entity })} />
      {nsys.active && partialContextRunIds.has(nsys.active.run.run_id)
        ? <p className="pi0-funnel-note"><strong>Nsys：独立采集 · 部分上下文。</strong> {slice.anchorRunId === nsys.active.run.run_id
          ? "采集属于当前运行；仍有未记录的上下文字段。"
          : "与端到端计时独立采集；仍有未记录的上下文字段。"}</p>
        : null}</> : null}
      {analysisSection === "kernel" ? <Pi0KernelSection view={kernels} realization={implementationRealization} partialContextRunIds={kernelPartialContextRunIds}
        independentNcu={independentNcu} dagOpen={renderedDagOpen}
        onOpenDetails={() => navigate({ ...scopePatch, tab: "roofline-kernels", rooflineLevel: "kernel", entity: null, basis: null })}
        onOpenNcuContext={kernels.rows.some((row) => row.observation.observationKind === "ncu_replayed_launch")
          ? () => {
            const row = kernels.rows.find((item) => item.observation.observationKind === "ncu_replayed_launch")!;
            navigate({ ...scopePatch, tab: "roofline-kernels", rooflineLevel: "kernel",
              entity: kernelEntity(row.capture.captureId, row.observation.observationId), basis: null });
          } : null}
        onOpenDag={() => setAnalysisSection("implementation")} /> : null}
      {renderedDagOpen ? <section className="pi0-funnel-section" aria-labelledby="pi0-dag-title">
        <h3 id="pi0-dag-title" className="visually-hidden">模型 DAG 上的实现差异</h3>
        <div id="pi0-implementation-dag">
          <Pi0ImplementationDagSection record={record} bounds={runtimeBounds} route={{ ...route, workload: normalizedWorkload }} activeRealization={implementationRealization}
            selectedRuntimeName={summaries.find((item) => item.runtimeId === route.runtime)?.displayName ?? null} navigate={navigate} />
        </div>
      </section> : analysisSection === "implementation" ? <p className="pi0-funnel-empty">当前推理栈尚无对应精度的源码实现映射。</p> : null}</> : null}
    </section>
  );
}
