import { useMemo } from "react";

import type { RoutePatch, RouteState } from "../../app/routes";
import type { AtlasData, ModelRecord } from "../../types/atlas";
import { adaptProfilerEvidence } from "../profiler/domain/adaptProfilerEvidence";
import { indexProfilerEvidence } from "../profiler/domain/indexProfilerEvidence";
import { RooflineView } from "../roofline/components/RooflineView";
import { runtimeProfilerSlice, scopeRuntimeProfiler } from "../runtime/domain/scopeRuntimeProfiler";
import { kernelEntity } from "../workbench/entityKeys";
import { KernelInspector } from "./components/KernelInspector";
import { KernelTable } from "./components/KernelTable";
import { buildKernelRows } from "./domain/buildKernelRows";

interface PerformanceViewProps {
  data: AtlasData;
  model: ModelRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

export function PerformanceView({ data, model, route, navigate }: PerformanceViewProps) {
  const evidence = useMemo(() => adaptProfilerEvidence(data), [data]);
  const slice = useMemo(() => runtimeProfilerSlice(data, route.workload), [data, route.workload]);
  const scope = useMemo(() => model.model_id === "pi0" ? scopeRuntimeProfiler(data, evidence, {
    modelId: model.model_id, runtimeId: route.runtime, hardwareId: route.hardware,
    precisionId: route.runtimePrecision, slice,
  }) : { data, evidence, actualPrecision: route.runtimePrecision },
  [data, evidence, model.model_id, route.runtime, route.hardware, route.runtimePrecision, slice]);
  const index = useMemo(() => indexProfilerEvidence(scope.evidence), [scope.evidence]);
  const view = useMemo(() => buildKernelRows(scope.data, scope.evidence, index, {
    modelId: model.model_id,
    runtimeId: route.runtime,
    hardwareId: route.hardware,
    entity: route.entity,
  }), [scope, index, model.model_id, route.entity, route.hardware, route.runtime]);
  const inventory = view.inventory;
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

function Inventory({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function formatMs(valueNs: number) {
  return `${(valueNs / 1e6).toFixed(6)} ms`;
}
