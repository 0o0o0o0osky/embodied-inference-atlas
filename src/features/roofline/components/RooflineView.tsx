import { useMemo } from "react";

import type { RoutePatch, RouteState } from "../../../app/routes";
import type { AtlasData, ModelRecord } from "../../../types/atlas";
import { parseEntityKey, type CrossViewEntityKey } from "../../workbench/entityKeys";
import { createRooflineIndex, indexRoofline } from "../data/indexRoofline";
import {
  materializeInteractiveRoofline,
  parseInteractiveWorkload,
  serializeInteractiveWorkload,
} from "../data/materialize";
import { buildRooflineView } from "../presentation/viewModel";
import { RooflineAnalysis } from "./RooflineAnalysis";
import { RooflineBasisBar } from "./RooflineBasisBar";
import { RooflineModeTabs } from "./RooflineModeTabs";
import { RooflineOverview } from "./RooflineOverview";

interface RooflineViewProps {
  data: AtlasData;
  model: ModelRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

const CORE_MODELS = new Set(["pi0", "pi05", "smolvla"]);

export function RooflineView({ data, model, route, navigate }: RooflineViewProps) {
  const canonical = useMemo(() => indexRoofline(data), [data]);
  if (!CORE_MODELS.has(model.model_id)) {
    return <section className="roofline-empty"><p>Roofline unavailable</p><h2>No canonical model materializer</h2><span>{model.model_id} is outside the three core Task 5 models.</span></section>;
  }
  const modelId = model.model_id as "pi0" | "pi05" | "smolvla";
  const requestedBasis = route.basis ? canonical.basisById.get(route.basis) : null;
  const requestedScenario = requestedBasis ? canonical.scenarioById.get(requestedBasis.scenario_id) : null;
  const precisionPath = route.precision ?? requestedScenario?.precision_path.precision_path_id ?? "bf16_dense";
  const sourceScenario = canonical.scenarios.find((scenario) => scenario.model_id === modelId
    && scenario.origin === "default_precomputed"
    && scenario.precision_path.precision_path_id === precisionPath)
    ?? canonical.scenarios.find((scenario) => scenario.model_id === modelId
      && scenario.origin === "default_precomputed"
      && scenario.precision_path.precision_path_id === "bf16_dense")!;
  const workload = parseInteractiveWorkload(route.workload, sourceScenario.workload);
  const interactive = useMemo(() => {
    if (!route.workload?.startsWith("v=")) return null;
    const graphRecord = data.datasets.model_graphs.find((record) => record.model_graph_id === sourceScenario.model_graph_id);
    const ceiling = canonical.ceilingById.get("thor-t5000-120w-1386mhz");
    const realizationId = sourceScenario.precision_path.realization_ids[0];
    const realizationRecord = realizationId
      ? data.datasets.runtime_realizations.find((record) => record.realization_id === realizationId) ?? null
      : null;
    if (!graphRecord || !ceiling) return null;
    try {
      return materializeInteractiveRoofline(graphRecord, sourceScenario, ceiling, workload, realizationRecord);
    } catch {
      return null;
    }
  }, [canonical.ceilingById, data.datasets.model_graphs, data.datasets.runtime_realizations, route.workload, sourceScenario, workload]);
  const index = useMemo(() => interactive
    ? createRooflineIndex(
      canonical.ceilings,
      [...canonical.scenarios, interactive.scenario],
      [...canonical.bases, ...interactive.bases],
      [...canonical.points, ...interactive.points],
    )
    : canonical, [canonical, interactive]);
  const interactiveBasis = interactive && route.rooflineLevel !== "overview" && route.rooflineLevel !== "fused" && route.rooflineLevel !== "kernel"
    ? interactive.bases.find((basis) => basis.level === route.rooflineLevel)?.basis_id ?? null
    : null;
  const selectedKey = parseEntityKey(route.entity) ? route.entity as CrossViewEntityKey : null;
  const view = buildRooflineView({
    modelId,
    mode: route.rooflineLevel,
    basisId: interactiveBasis ?? route.basis,
    precisionPathId: sourceScenario.precision_path.precision_path_id,
    runtimeId: route.runtime,
    selectedEntityId: selectedKey,
  }, index);
  const overview = buildRooflineView({ modelId, mode: "overview", basisId: null, precisionPathId: sourceScenario.precision_path.precision_path_id, runtimeId: route.runtime, selectedEntityId: null }, index).overview!;
  return (
    <section className="roofline-workspace" aria-labelledby="roofline-title">
      <header className="roofline-intro">
        <div><p>Basis-safe analytical workbench</p><h2 id="roofline-title">Roofline &amp; kernels</h2></div>
        <p>Every chart and table resolves exactly one level, workload, precision, time, traffic, work, device, operating point, runtime, and coverage basis.</p>
      </header>
      <RooflineModeTabs route={route} overview={overview} navigate={navigate} />
      {route.rooflineLevel === "overview" ? (
        <RooflineOverview items={overview} navigate={navigate} />
      ) : (
        <>
          <RooflineBasisBar
            route={route}
            model={view}
            workload={workload}
            navigate={navigate}
            onWorkload={(next) => navigate({ workload: serializeInteractiveWorkload(next), basis: null, entity: null }, true)}
          />
          {view.warnings.length ? <div className="roofline-warnings" role="status">{view.warnings.map((warning) => <p key={warning.id}><strong>{warning.id.replaceAll("-", " ")}.</strong> {warning.message}</p>)}</div> : null}
          <RooflineAnalysis model={view} selectedEntityKey={selectedKey} onSelect={(entity) => navigate({ entity }, true)} />
        </>
      )}
    </section>
  );
}
