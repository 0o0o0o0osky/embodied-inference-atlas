import { useMemo, useState } from "react";
import type { RoutePatch, RouteState } from "../../app/routes";
import { RouteLink } from "../../components/RouteLink";
import type { AtlasData, CanonicalRecord, ModelRecord } from "../../types/atlas";
import { adaptV1ModelGraph } from "../model-graph/domain/adaptV1ModelGraph";
import { workloadOverrides } from "../model-graph/domain/workload";
import { buildKernelRows } from "../performance/domain/buildKernelRows";
import { adaptProfilerEvidence } from "../profiler/domain/adaptProfilerEvidence";
import { indexProfilerEvidence } from "../profiler/domain/indexProfilerEvidence";
import { buildTimelineView } from "../timeline/domain/buildTimelineView";
import { timelineEventEntity } from "../workbench/entityKeys";
import { Pi0ImplementationDagSection } from "./components/Pi0ImplementationDagSection";
import { Pi0KernelSection } from "./components/Pi0KernelSection";
import { Pi0NsysSection } from "./components/Pi0NsysSection";
import { Pi0SystemMetricsSection } from "./components/Pi0SystemMetricsSection";
import { adaptRuntimeRealization, isRuntimeRealizationRecord } from "./domain/adaptRuntimeRealization";
import { buildRuntimeSystemSummary } from "./domain/buildRuntimeSystemSummary";
import { scopeRuntimeProfiler } from "./domain/scopeRuntimeProfiler";
import { buildRuntimeStackSummaries, resolveRuntimeCandidates } from "./domain/resolveRuntimeRealization";

interface Pi0RuntimeWorkspaceProps {
  data: AtlasData;
  model: ModelRecord;
  record: CanonicalRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

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
  return (route.workload ?? "v=2,p=22").split(",").map((binding) => {
    const [name, value] = binding.split("=", 2);
    return `${aliases[name!.trim()] ?? name!.trim()}=${value}`;
  }).join(",");
}

export function Pi0RuntimeWorkspace({ data, model, record, route, navigate }: Pi0RuntimeWorkspaceProps) {
  const [dagOpen, setDagOpen] = useState(false);
  const defaultGraph = useMemo(() => adaptV1ModelGraph(record), [record]);
  const normalizedWorkload = useMemo(() => graphWorkload(data, route), [data, route]);
  const overrides = useMemo(() => workloadOverrides(normalizedWorkload, defaultGraph.editableSymbols), [normalizedWorkload, defaultGraph.editableSymbols]);
  const slice = useMemo(() => ({ cameraViews: overrides.V ?? 2, promptTokens: overrides.L_PROMPT ?? 22 }), [overrides]);
  const workload = route.workload ?? "v=2,p=22";
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
  const summary = useMemo(() => buildRuntimeSystemSummary({ data, profiler, summaries, modelId: model.model_id, hardwareId: route.hardware, slice }),
    [data, profiler, summaries, model.model_id, route.hardware, slice]);
  const { data: scopedData, evidence: scopedProfiler, actualPrecision } = useMemo(() => scopeRuntimeProfiler(data, profiler, {
    modelId: model.model_id, runtimeId: route.runtime, hardwareId: route.hardware,
    precisionId: route.runtimePrecision, slice,
  }), [data, profiler, model.model_id, route.runtime, route.hardware, route.runtimePrecision, slice]);
  const activeRealization = activeCandidate?.actualPrecisionId === actualPrecision ? activeCandidate.realization : null;
  const profilerIndex = useMemo(() => indexProfilerEvidence(scopedProfiler), [scopedProfiler]);
  const nsys = useMemo(() => {
    const captures = scopedProfiler.captures.filter((capture) => capture.tool === "nsys"
      && profilerIndex.timelinesByCaptureId.has(capture.captureId));
    const requested = captures.find((capture) => capture.captureId === route.timelineCapture);
    const graph = captures.find((capture) => capture.nsys?.reportMode === "graph" && capture.nsys.schedulerScope !== "system_wide");
    const view = buildTimelineView(scopedData, scopedProfiler, profilerIndex, {
      modelId: model.model_id, runtimeId: route.runtime, hardwareId: route.hardware,
      captureId: requested?.captureId ?? graph?.captureId ?? null, entity: route.entity,
    });
    return { ...view, requestedCaptureUnavailable: route.timelineCapture !== null && !requested };
  }, [scopedData, scopedProfiler, profilerIndex, model.model_id, route.runtime, route.hardware, route.timelineCapture, route.entity]);
  const kernels = useMemo(() => buildKernelRows(scopedData, scopedProfiler, profilerIndex, {
    modelId: model.model_id, runtimeId: route.runtime, hardwareId: route.hardware, entity: null,
  }), [scopedData, scopedProfiler, profilerIndex, model.model_id, route.runtime, route.hardware]);
  const scopePatch = { workload: `v=${slice.cameraViews},p=${slice.promptTokens}`, runtime: route.runtime, hardware: route.hardware, runtimePrecision: actualPrecision };

  return (
    <section className="model-graph-workspace pi0-workspace pi0-runtime-workspace" aria-labelledby="pi0-runtime-title">
      <nav className="pi0-runtime-toolbar" aria-label="Pi0 模型工作台视图">
        <h2 id="pi0-runtime-title">Pi0 <span>v{defaultGraph.version.split(".")[0]}</span></h2>
        <RouteLink route={route} navigate={navigate} patch={{ tab: "logical" }}>理论模型</RouteLink>
        <span className="graph-view-current" aria-current="page">推理性能</span>
        <RouteLink route={route} navigate={navigate} patch={{ tab: "roofline-kernels", rooflineLevel: "overview", entity: null }}>理论总览</RouteLink>
      </nav>
      <Pi0SystemMetricsSection summary={summary} selectedRuntimeId={route.runtime} selectedPrecisionId={actualPrecision}
        onSliceChange={(next) => navigate({ workload: `v=${next.cameraViews},p=${next.promptTokens}`, entity: null, timelineCapture: null })}
        onSelectRow={(runtime, runtimePrecision) => navigate({ runtime, runtimePrecision, workload: `v=${slice.cameraViews},p=${slice.promptTokens}`, entity: null, timelineCapture: null })} />
      <Pi0NsysSection view={nsys}
        onCaptureChange={(timelineCapture) => navigate({ ...scopePatch, timelineCapture, entity: null })}
        onSelectEvent={(event) => nsys.active && navigate({ ...scopePatch, tab: "timeline", timelineCapture: nsys.active.capture.captureId, entity: timelineEventEntity(nsys.active.timeline.timelineId, event.eventId) })}
        onOpenDetails={() => navigate({ ...scopePatch, tab: "timeline", timelineCapture: nsys.active?.capture.captureId ?? null, entity: null })} />
      <Pi0KernelSection view={kernels} realization={activeRealization} dagOpen={dagOpen}
        onOpenDetails={() => navigate({ ...scopePatch, tab: "roofline-kernels", rooflineLevel: "kernel", entity: null, basis: null })}
        onOpenDag={() => setDagOpen((open) => !open)} />
      {dagOpen ? <section className="pi0-funnel-section" aria-labelledby="pi0-dag-title">
        <header className="pi0-funnel-heading">
          <h3 id="pi0-dag-title">完整实现图</h3>
        </header>
        <div id="pi0-implementation-dag">
          <Pi0ImplementationDagSection record={record} route={{ ...route, workload: normalizedWorkload }} activeRealization={activeRealization}
            selectedRuntimeName={summaries.find((item) => item.runtimeId === route.runtime)?.displayName ?? null} navigate={navigate} />
        </div>
      </section> : null}
    </section>
  );
}
