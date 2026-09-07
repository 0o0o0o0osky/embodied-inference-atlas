import { useEffect, useMemo } from "react";

import type { RoutePatch, RouteState } from "../../app/routes";
import type { AtlasData, ModelRecord } from "../../types/atlas";
import { adaptProfilerEvidence } from "../profiler/domain/adaptProfilerEvidence";
import { indexProfilerEvidence } from "../profiler/domain/indexProfilerEvidence";
import { RooflineView } from "../roofline/components/RooflineView";
import { Pi0RooflineOverview } from "../roofline/components/Pi0RooflineOverview";
import { materializeCurrentModelRoofline } from "../roofline/presentation/buildOperatorRooflineSummary";
import {
  runtimeProfilerSlice,
  scopeRuntimeProfiler,
  selectIndependentNcuReplayEvidence,
} from "../runtime/domain/scopeRuntimeProfiler";
import { buildPi0PerformanceOverview } from "../runtime/domain/buildPi0PerformanceOverview";
import { Pi0ProfilerEvidenceSection } from "./components/Pi0ProfilerEvidenceSection";
import { buildKernelRows } from "./domain/buildKernelRows";
import { Pi0PerformanceNavigation } from "../runtime/components/Pi0PerformanceNavigation";
import { isPi0ModelTheory } from "../runtime/domain/pi0PerformanceNavigation";
import { KernelRooflineComparison } from "../roofline/components/KernelRooflineComparison";

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
  const pi0Analytical = useMemo(() => materializeCurrentModelRoofline({
      modelId: model.model_id,
      data,
      workloadBinding: route.workload,
      precisionPathId: route.precision,
      hardwareId: route.hardware,
    }), [data, model.model_id, route.hardware, route.precision, route.workload]);
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
  const modelTheory = isPi0ModelTheory(route);
  useEffect(() => {
    if (modelTheory) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [modelTheory]);
  const profilerSection = <Pi0ProfilerEvidenceSection model={view} partialContextRunIds={partialContextRunIds}
    anchorRunId={slice.anchorRunId} independentNcu={independentNcu} route={route} navigate={navigate} />;

    return (
      <div className="performance-workspace performance-workspace--pi0">
        <Pi0PerformanceNavigation route={route} navigate={navigate}
          surface={route.rooflineLevel === "kernel" ? "kernel" : "roofline"} />
        {route.rooflineLevel === "kernel" ? <>
          <KernelRooflineComparison data={data} runId={slice.anchorRunId} />
          {profilerSection}
        </> : null}
        {route.rooflineLevel !== "kernel" ? <section className="pi0-funnel-section pi0-roofline-summary" aria-labelledby="pi0-roofline-title">
          <header className="pi0-funnel-heading">
            <div><h3 id="pi0-roofline-title">{modelTheory ? "模型理论 · Roofline" : "理论 Roofline"}</h3><p>{modelTheory ? "DAG 的展开分析视图。选择阶段或算子查看理论上限，返回时保留当前场景。" : "先选分析层级，再看对应上限；理论、融合实现与实测 Kernel 不混算。"}</p></div>
          </header>
          <Pi0RooflineLevelNavigation route={route} navigate={navigate} />
          {route.rooflineLevel === "overview" ? (
            <Pi0RooflineOverview data={data} result={pi0Analytical!} navigate={navigate} modelTheory={modelTheory} />
          ) : (
            <div className="pi0-roofline-active-level">
              <RooflineView data={data} model={model} route={route} navigate={navigate} />
            </div>
          )}
        </section> : null}
        {!modelTheory && route.rooflineLevel !== "kernel" && (route.runtime || route.rooflineLevel !== "overview") ? (
          profilerSection
        ) : null}
      </div>
    );
}

const PI0_ROOFLINE_LEVELS: readonly {
  id: RouteState["rooflineLevel"];
  label: string;
}[] = [
  { id: "overview", label: "总览" },
  { id: "stage", label: "模型阶段" },
  { id: "atomic", label: "模型算子" },
  { id: "fused", label: "融合算子" },
  { id: "kernel", label: "实测 Kernel" },
];

function Pi0RooflineLevelNavigation({ route, navigate }: {
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}) {
  return (
    <nav className="pi0-roofline-levels" aria-label="Roofline 分析层级">
      {PI0_ROOFLINE_LEVELS.filter((level) => !isPi0ModelTheory(route) || ["overview", "stage", "atomic"].includes(level.id)).map((level) => (
        <button
          type="button"
          key={level.id}
          aria-current={route.rooflineLevel === level.id ? "page" : undefined}
          onClick={() => navigate({ rooflineLevel: level.id, basis: null, entity: isPi0ModelTheory(route) ? route.entity : null })}
        >{level.label}</button>
      ))}
    </nav>
  );
}
