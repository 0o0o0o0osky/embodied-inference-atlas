import { useMemo } from "react";

import type { RoutePatch, RouteState } from "../../app/routes";
import type { AtlasData, CanonicalRecord, ModelRecord } from "../../types/atlas";
import { DerivedSymbols } from "./components/DerivedSymbols";
import { GraphBreadcrumb } from "./components/GraphBreadcrumb";
import { LogicalDagSvg } from "./components/LogicalDagSvg";
import { OperatorInspector } from "./components/OperatorInspector";
import { WorkloadControls } from "./components/WorkloadControls";
import { adaptLogicalDag, incidentNodeRefs } from "./domain/adaptLogicalDag";
import { adaptV1ModelGraph, isV1ModelGraphRecord } from "./domain/adaptV1ModelGraph";
import { encodeWorkload, workloadOverrides } from "./domain/workload";
import { layoutLogicalDag } from "./layout/paperLayout";
import { resolveConnectorHints } from "./layout/routeConnectors";
import { resolvePresentationProfile } from "./presentation/registry";

interface ModelGraphWorkspaceProps {
  data: AtlasData;
  model: ModelRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

function findGraph(records: CanonicalRecord[], modelId: string) {
  return records.find((record) => isV1ModelGraphRecord(record, modelId)) ?? null;
}

export function ModelGraphWorkspace({
  data,
  model,
  route,
  navigate,
}: ModelGraphWorkspaceProps) {
  const record = findGraph(data.datasets.model_graphs, model.model_id);
  if (!record) {
    return (
      <section className="logical-unavailable">
        <p>Logical graph unavailable</p>
        <h2>{model.display_name} does not yet have a canonical model-graph record.</h2>
        <span>The workbench keeps the missing definition visible rather than borrowing Pi0 topology.</span>
      </section>
    );
  }

  return (
    <ResolvedModelGraph
      record={record}
      model={model}
      route={route}
      navigate={navigate}
    />
  );
}

function ResolvedModelGraph({
  record,
  model,
  route,
  navigate,
}: {
  record: CanonicalRecord;
  model: ModelRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}) {
  const defaultGraph = useMemo(() => adaptV1ModelGraph(record), [record]);
  const overrides = useMemo(
    () => workloadOverrides(route.workload, defaultGraph.editableSymbols),
    [defaultGraph.editableSymbols, route.workload],
  );
  const graph = useMemo(
    () => adaptV1ModelGraph(record, overrides),
    [record, overrides],
  );
  const structuralDag = useMemo(() => adaptLogicalDag(defaultGraph), [defaultGraph]);
  const dag = useMemo(() => adaptLogicalDag(graph), [graph]);
  const profile = useMemo(
    () => resolvePresentationProfile(defaultGraph, structuralDag),
    [defaultGraph, structuralDag],
  );
  const layout = useMemo(
    () => layoutLogicalDag(structuralDag, profile.presentation),
    [profile.presentation, structuralDag],
  );
  const connectors = useMemo(
    () => resolveConnectorHints(structuralDag, profile.presentation, layout),
    [layout, profile.presentation, structuralDag],
  );
  const firstOperator = [...dag.nodes.values()].find((node) => node.kind === "operator");
  const routedNode = route.entity ? dag.nodes.get(route.entity) : undefined;
  const selectedNode = routedNode?.detail ? routedNode : firstOperator;
  const operator = selectedNode?.detail ?? null;
  const resolvedRef = operator?.ref ?? "";
  const related = incidentNodeRefs(dag, resolvedRef);

  const updateWorkload = (next: Record<string, number>) => {
    navigate(
      { workload: encodeWorkload(next, defaultGraph.editableSymbols) },
      true,
    );
  };

  if (!operator) {
    return <section className="logical-unavailable"><h2>No atomic operator was materialized.</h2></section>;
  }

  return (
    <section className="model-graph-workspace" aria-labelledby="logical-graph-title">
      <header className="logical-intro">
        <div>
          <p>{graph.graphId} / v{graph.version}</p>
          <h2 id="logical-graph-title">{profile.title}</h2>
          <span>{profile.summary}</span>
        </div>
        <aside>
          <strong>{profile.callout.label}</strong>
          <span>{profile.callout.value}</span>
          <small>{profile.callout.note}</small>
        </aside>
      </header>

      <WorkloadControls
        symbols={graph.editableSymbols}
        values={overrides}
        onChange={(symbol, value) => updateWorkload({ ...overrides, [symbol]: value })}
        onReset={() => navigate({ workload: null }, true)}
      />
      <DerivedSymbols symbols={graph.derivedSymbols} />
      <p className="workload-annotation">
        {profile.workloadNote}
      </p>

      <GraphBreadcrumb modelLabel={model.display_name} graph={graph} operator={operator} />

      {layout.diagnostics.length || connectors.invalidHints.length || connectors.coverage.uncoveredEdgeIds.length ? (
        <div className="graph-diagnostics" role="status">
          {[
            ...layout.diagnostics,
            ...connectors.invalidHints.map((hint) => `Invalid route hint: ${hint.id}`),
            ...(connectors.coverage.uncoveredEdgeIds.length
              ? [`Uncovered truth edges: ${connectors.coverage.uncoveredEdgeIds.join(", ")}`]
              : []),
          ].join(" ")}
        </div>
      ) : null}

      <div className={[
        "logical-workspace-grid",
        layout.stageBoxes.length > 3 ? "logical-workspace-grid--wide" : "",
      ].filter(Boolean).join(" ")}>
        <section className="logical-graph-panel" aria-label={profile.panelLabel}>
          <LogicalDagSvg
            dag={dag}
            layout={layout}
            connectors={connectors}
            presentation={profile.presentation}
            selectedRef={resolvedRef}
            relatedRefs={related}
            onSelect={(ref) => navigate({ entity: ref }, true)}
            ariaLabel={profile.diagramLabel}
          />
        </section>
        <OperatorInspector
          operator={operator}
          resetKey={`${operator.ref}|${route.workload ?? "defaults"}`}
        />
      </div>
    </section>
  );
}
