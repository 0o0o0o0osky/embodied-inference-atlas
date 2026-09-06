import { useMemo } from "react";

import type { RoutePatch, RouteState } from "../../app/routes";
import type { AtlasData, ModelRecord } from "../../types/atlas";
import { adaptProfilerEvidence } from "../profiler/domain/adaptProfilerEvidence";
import { indexProfilerEvidence } from "../profiler/domain/indexProfilerEvidence";
import { RooflineView } from "../roofline/components/RooflineView";
import { Pi0RooflineOverview } from "../roofline/components/Pi0RooflineOverview";
import { materializeCurrentPi0Roofline } from "../roofline/presentation/buildOperatorRooflineSummary";
import {
  runtimeProfilerSlice,
  scopeRuntimeProfiler,
  selectIndependentNcuReplayEvidence,
} from "../runtime/domain/scopeRuntimeProfiler";
import { buildPi0PerformanceOverview } from "../runtime/domain/buildPi0PerformanceOverview";
import { kernelEntity } from "../workbench/entityKeys";
import { KernelInspector } from "./components/KernelInspector";
import { KernelTable } from "./components/KernelTable";
import { Pi0ProfilerEvidenceSection } from "./components/Pi0ProfilerEvidenceSection";
import { buildKernelRows } from "./domain/buildKernelRows";
import { Pi0PerformanceNavigation } from "../runtime/components/Pi0PerformanceNavigation";

interface PerformanceViewProps {
  data: AtlasData;
  model: ModelRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

export function PerformanceView({ data, model, route, navigate }: PerformanceViewProps) {
  const evidence = useMemo(() => adaptProfilerEvidence(data), [data]);
  const performanceOverview = useMemo(() => model.model_id === "pi0"
    ? buildPi0PerformanceOverview({ data, hardwareId: route.hardware })
    : null, [data, model.model_id, route.hardware]);
  const pi0Analytical = useMemo(() => model.model_id === "pi0"
    ? materializeCurrentPi0Roofline({
      data,
      workloadBinding: route.workload,
      precisionPathId: route.precision,
      hardwareId: route.hardware,
    })
    : null, [data, model.model_id, route.hardware, route.precision, route.workload]);
  const selectedFacet = useMemo(() => {
    const matching = performanceOverview?.facets.filter((facet) => facet.runtimeId === route.runtime
      && facet.precisionId === route.runtimePrecision) ?? [];
    return matching.find((facet) => facet.id === route.runtimeFacet)
      ?? (route.runtimeFacet === null && matching.length === 1 ? matching[0]! : null);
  }, [performanceOverview, route.runtime, route.runtimeFacet, route.runtimePrecision]);
  const slice = useMemo(() => runtimeProfilerSlice(
    data,
    route.workload,
    selectedFacet?.comparisonContext ?? null,
  ), [data, route.workload, selectedFacet]);
  const scope = useMemo(() => model.model_id === "pi0" ? scopeRuntimeProfiler(data, evidence, {
    modelId: model.model_id, runtimeId: route.runtime, hardwareId: route.hardware,
    precisionId: route.runtimePrecision, slice,
  }) : { data, evidence, actualPrecision: route.runtimePrecision, partialContextRunIds: new Set<string>() },
  [data, evidence, model.model_id, route.runtime, route.hardware, route.runtimePrecision, slice]);
  const independentNcu = useMemo(() => model.model_id === "pi0"
    && !scope.evidence.captures.some((capture) => capture.tool === "ncu")
    ? selectIndependentNcuReplayEvidence(data, evidence, {
      modelId: model.model_id, runtimeId: route.runtime, hardwareId: route.hardware,
      precisionId: route.runtimePrecision, slice,
    }) : null,
  [data, evidence, model.model_id, route.hardware, route.runtime, route.runtimePrecision, scope.evidence.captures, slice]);
  const kernelScope = useMemo(() => independentNcu && independentNcu.runIds.size ? {
    data: { ...scope.data, datasets: {
      ...scope.data.datasets,
      runs: [...scope.data.datasets.runs, ...independentNcu.data.datasets.runs],
    } },
    evidence: {
      ...scope.evidence,
      captures: [...scope.evidence.captures, ...independentNcu.evidence.captures],
      observations: [...scope.evidence.observations, ...independentNcu.evidence.observations],
      metrics: [...scope.evidence.metrics, ...independentNcu.evidence.metrics],
      links: [...scope.evidence.links, ...independentNcu.evidence.links],
      telemetry: [...scope.evidence.telemetry, ...independentNcu.evidence.telemetry],
    },
  } : scope, [independentNcu, scope]);
  const partialContextRunIds = useMemo(() => new Set([
    ...scope.partialContextRunIds,
    ...(independentNcu?.partialContextRunIds ?? []),
  ]), [independentNcu, scope.partialContextRunIds]);
  const index = useMemo(() => indexProfilerEvidence(kernelScope.evidence), [kernelScope.evidence]);
  const view = useMemo(() => buildKernelRows(kernelScope.data, kernelScope.evidence, index, {
    modelId: model.model_id,
    runtimeId: route.runtime,
    hardwareId: route.hardware,
    entity: route.entity,
  }), [kernelScope, index, model.model_id, route.entity, route.hardware, route.runtime]);
  const inventory = view.inventory;

  if (model.model_id === "pi0") {
    return (
      <div className="performance-workspace performance-workspace--pi0">
        <Pi0PerformanceNavigation route={route} navigate={navigate}
          surface={route.rooflineLevel === "overview" ? "roofline" : "kernel"} />
        <section className="pi0-funnel-section pi0-roofline-summary" aria-labelledby="pi0-roofline-title">
          <header className="pi0-funnel-heading">
            <div><h3 id="pi0-roofline-title">理论 Roofline</h3><p>先选分析层级，再看对应上限；理论、融合实现与实测 Kernel 不混算。</p></div>
          </header>
          <Pi0RooflineLevelNavigation route={route} navigate={navigate} />
          {route.rooflineLevel === "overview" ? (
            <Pi0RooflineOverview data={data} result={pi0Analytical!} navigate={navigate} />
          ) : (
            <div className="pi0-roofline-active-level">
              <RooflineView data={data} model={model} route={route} navigate={navigate} />
            </div>
          )}
        </section>
        {route.runtime || route.rooflineLevel !== "overview" ? (
          <Pi0ProfilerEvidenceSection model={view} partialContextRunIds={partialContextRunIds}
            anchorRunId={slice.anchorRunId} independentNcu={independentNcu} route={route} navigate={navigate} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="performance-workspace">
      <RooflineView data={data} model={model} route={route} navigate={navigate} />

      <section className="profiler-diagnostics" aria-labelledby="profiler-diagnostics-title">
        <header className="profiler-intro">
          <div>
            <p>Profiler diagnostics / separate evidence plane</p>
            <h2 id="profiler-diagnostics-title">Capture-local kernel register</h2>
            <span>No Task 5 formula, point materialization, or chart geometry is reused here. Counter diagnostics remain outside the analytical roofline.</span>
          </div>
          <strong>
            {inventory.observations} capture-local observations / {inventory.ncuReplays} diagnostic NCU replays / {inventory.rooflineEligibleKernelPoints} roofline-eligible kernel points
            <small>Active scope: {view.activeFilter}{model.model_id === "pi0" ? ` / actual precision ${scope.actualPrecision ?? "not selected"} / V=${slice.cameraViews}, P=${slice.promptTokens}` : ""}</small>
          </strong>
        </header>

        <dl className="profiler-inventory" aria-label="Profiler evidence inventory">
          <Inventory label="Captures" value={`${inventory.captures} · ${inventory.nsysCaptures} Nsys / ${inventory.ncuCaptures} NCU`} />
          <Inventory label="Timeline records" value={inventory.timelines.toLocaleString()} />
          <Inventory label="Signatures" value={inventory.signatures.toLocaleString()} />
          <Inventory label="Metrics" value={`${inventory.profilerMetrics} · ${inventory.numericMetrics} numeric / ${inventory.missingMetrics} missing`} />
          <Inventory label="Exact links" value={inventory.links.toLocaleString()} />
          <Inventory label="Telemetry" value={inventory.telemetry.toLocaleString()} />
          <Inventory label="NCU selection" value={`${inventory.explicitInvocationReplays} explicit / ${inventory.selectedMatchReplays} selected-match`} />
          <Inventory label="Cycle/path sections" value={`${inventory.sectionReplays} of ${inventory.ncuReplays}`} />
        </dl>

        <section className="profiler-boundary-note" aria-label="Profiler interpretation boundary">
          <strong>{view.rows.length ? "Diagnostic evidence is separate from the analytical kernel roofline." : "No profiler observations match the selected execution scope."}</strong>
          <span>{view.rows.length ? "Unknown capture workload fields allow only partial context matching, not a claim of the same execution. Missing traffic, clocks, or operator links remain missing evidence." : "Select a runtime, hardware, actual precision, and matching input slice. No profiler evidence is borrowed from another configuration."}</span>
        </section>

        {view.unclassified ? (
          <p className="kernel-coverage-strip">
            <strong>{view.unclassified.launches.toLocaleString()} / {view.unclassified.totalLaunches.toLocaleString()} Nsys kernel launches remain unclassified</strong>
            <span>{formatMs(view.unclassified.durationNs)} / {formatMs(view.unclassified.totalDurationNs)} of the node-trace kernel duration sum. This is coverage, not idle or GPU-busy accounting.</span>
          </p>
        ) : null}

        <KernelTable
          rows={view.rows}
          selectedObservationId={view.selectedRow?.observation.observationId ?? null}
          onSelect={(row) => navigate({ entity: kernelEntity(row.capture.captureId, row.observation.observationId) }, true)}
        />
        <KernelInspector model={view} route={route} navigate={navigate} />
      </section>
    </div>
  );
}

const PI0_ROOFLINE_LEVELS: readonly {
  id: RouteState["rooflineLevel"];
  label: string;
}[] = [
  { id: "overview", label: "总览" },
  { id: "stage", label: "模型阶段" },
  { id: "atomic", label: "逻辑算子" },
  { id: "fused", label: "融合算子" },
  { id: "kernel", label: "实测 Kernel" },
];

function Pi0RooflineLevelNavigation({ route, navigate }: {
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}) {
  return (
    <nav className="pi0-roofline-levels" aria-label="Roofline 分析层级">
      {PI0_ROOFLINE_LEVELS.map((level) => (
        <button
          type="button"
          key={level.id}
          aria-current={route.rooflineLevel === level.id ? "page" : undefined}
          onClick={() => navigate({ rooflineLevel: level.id, basis: null, entity: null })}
        >{level.label}</button>
      ))}
    </nav>
  );
}

function Inventory({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function formatMs(valueNs: number) {
  return `${(valueNs / 1e6).toFixed(6)} ms`;
}
