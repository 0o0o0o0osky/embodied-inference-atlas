import { useMemo } from "react";

import { type RoutePatch, type RouteState } from "../../app/routes";
import { RouteLink } from "../../components/RouteLink";
import { adaptRuntimeRealization, isRuntimeRealizationRecord } from "../runtime/domain/adaptRuntimeRealization";
import { indexRuntimeRealization } from "../runtime/domain/indexRuntimeRealization";
import { logicalEntity, logicalRefFromEntity, parseEntityKey } from "../workbench/entityKeys";
import type { AtlasData, CanonicalRecord, ModelRecord } from "../../types/atlas";
import { DerivedSymbols } from "./components/DerivedSymbols";
import { GraphBreadcrumb } from "./components/GraphBreadcrumb";
import { LogicalDagSvg } from "./components/LogicalDagSvg";
import { OperatorInspector } from "./components/OperatorInspector";
import { WorkloadControls } from "./components/WorkloadControls";
import { adaptLogicalDag, incidentNodeRefs } from "./domain/adaptLogicalDag";
import { adaptV1ModelGraph, isV1ModelGraphRecord } from "./domain/adaptV1ModelGraph";
import { resolveFocusViewport } from "./domain/focusViewport";
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
      data={data}
      record={record}
      model={model}
      route={route}
      navigate={navigate}
    />
  );
}

function ResolvedModelGraph({
  data,
  record,
  model,
  route,
  navigate,
}: {
  data: AtlasData;
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
  const parsedEntity = parseEntityKey(route.entity);
  const routedRef = logicalRefFromEntity(route.entity) ?? (parsedEntity?.kind === "runtime-group"
    ? (() => {
        const raw = data.datasets.runtime_realizations.find((item) => item.realization_id === parsedEntity.realizationId);
        if (!raw || !isRuntimeRealizationRecord(raw, model.model_id)) return null;
        const mappings = indexRuntimeRealization(adaptRuntimeRealization(raw)).mappingsByGroupId.get(parsedEntity.executionGroupId) ?? [];
        return mappings
          .filter((mapping) => mapping.path === "primary" && mapping.certainty === "exact")
          .flatMap((mapping) => mapping.logicalTargets.map((target) => target.ref))
          .find((ref) => dag.nodes.has(ref)) ?? null;
      })()
    : null);
  const routedNode = routedRef ? dag.nodes.get(routedRef) : undefined;
  const selectedNode = routedNode?.kind === "operator" && routedNode.detail ? routedNode : null;
  const operator = selectedNode?.detail ?? null;
  const resolvedRef = operator?.ref ?? "";
  const related = incidentNodeRefs(dag, resolvedRef);
  const viewport = useMemo(
    () => resolveFocusViewport(dag, layout, operator?.ref ?? null),
    [dag, layout, operator?.ref],
  );

  const updateWorkload = (next: Record<string, number>) => {
    navigate(
      { workload: encodeWorkload(next, defaultGraph.editableSymbols) },
      true,
    );
  };

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

      {operator ? <GraphBreadcrumb modelLabel={model.display_name} graph={graph} operator={operator} /> : null}

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
        operator ? "is-focused" : "",
      ].filter(Boolean).join(" ")}>
        <section className="logical-graph-panel" aria-label={profile.panelLabel}>
          <LogicalDagSvg
            dag={dag}
            layout={layout}
            connectors={connectors}
            presentation={profile.presentation}
            selectedRef={resolvedRef}
            relatedRefs={related}
            mode={operator ? "focus" : "overview"}
            viewport={viewport}
            onSelect={(ref) => navigate({ entity: logicalEntity(ref) }, true)}
            ariaLabel={profile.diagramLabel}
          />
        </section>
        {operator ? (
          <OperatorInspector
            operator={operator}
            resetKey={`${operator.ref}|${route.workload ?? "defaults"}`}
            onClose={() => navigate({ entity: null }, true)}
            evidenceLinks={{
              roofline: <RouteLink route={route} navigate={navigate} patch={{
                tab: "roofline-kernels", rooflineLevel: "atomic", basis: null, entity: logicalEntity(operator.ref),
              }}>查看分析 Roofline</RouteLink>,
              kernel: <RouteLink route={route} navigate={navigate} patch={{
                tab: "roofline-kernels", rooflineLevel: "kernel", basis: null, entity: logicalEntity(operator.ref),
              }}>查看实测 Kernel 证据</RouteLink>,
            }}
          />
        ) : null}
      </div>
    </section>
  );
}
