import { useMemo } from "react";

import type { RoutePatch, RouteState } from "../../app/routes";
import type { AtlasData, ModelRecord } from "../../types/atlas";
import { adaptProfilerEvidence } from "../profiler/domain/adaptProfilerEvidence";
import { indexProfilerEvidence } from "../profiler/domain/indexProfilerEvidence";
import { RooflineView } from "../roofline/components/RooflineView";
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
  const index = useMemo(() => indexProfilerEvidence(evidence), [evidence]);
  const view = useMemo(() => buildKernelRows(data, evidence, index, {
    modelId: model.model_id,
    runtimeId: route.runtime,
    hardwareId: route.hardware,
    entity: route.entity,
  }), [data, evidence, index, model.model_id, route.entity, route.hardware, route.runtime]);
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
            <small>Active scope: {view.activeFilter}</small>
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
          <strong>Diagnostic evidence exists even though the kernel roofline is empty.</strong>
          <span>Whole-system traffic is absent, frequency is not fixed, and exact operator links are blocked by precision conflict. The 0-point roofline is not an absent-profiler state.</span>
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
