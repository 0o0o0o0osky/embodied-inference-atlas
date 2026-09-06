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
import { OperatorRooflinePanel } from "./components/OperatorRooflinePanel";
import { ModelTheorySummary } from "./components/ModelTheorySummary";
import { WorkloadControls } from "./components/WorkloadControls";
import { adaptLogicalDag, incidentNodeRefs } from "./domain/adaptLogicalDag";
import { adaptV1ModelGraph, isV1ModelGraphRecord } from "./domain/adaptV1ModelGraph";
import { resolveFocusViewport } from "./domain/focusViewport";
import { encodeWorkload, workloadOverrides } from "./domain/workload";
import { layoutLogicalDag } from "./layout/paperLayout";
import { resolveConnectorHints } from "./layout/routeConnectors";
import { resolvePresentationProfile } from "./presentation/registry";
import { ModelDisplayProvider, useModelText } from "./presentation/ModelDisplay";
import { pi0PerformanceNavigationPatch, pi0TheoryNavigationPatch } from "../runtime/domain/pi0PerformanceNavigation";
import { serializeInteractiveWorkload } from "../roofline/data/materialize";
import { materializeCurrentPi0Roofline } from "../roofline/presentation/buildOperatorRooflineSummary";

interface ModelGraphWorkspaceProps {
  data: AtlasData;
  model: ModelRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

function findGraph(records: CanonicalRecord[], modelId: string) {
  return records.find((record) => isV1ModelGraphRecord(record, modelId)) ?? null;
}

function resolveWorkloadBinding(data: AtlasData, route: RouteState) {
  const run = data.datasets.runs.find((candidate) => candidate.configuration_id === route.workload
    && candidate.model_id === route.model
    && (!route.hardware || candidate.device_id === route.hardware));
  const vla = run?.workload.vla;
  if (!vla) {
    const aliases: Record<string, string> = { v: "V", p: "L_PROMPT", a: "T_ACTION", n: "N_DENOISE" };
    return route.workload?.split(",").map((part) => {
      const [key, value] = part.split("=");
      return `${aliases[key?.trim() ?? ""] ?? key}=${value}`;
    }).join(",") ?? null;
  }
  return [
    ["V", vla.camera_views],
    ["L_PROMPT", vla.executed_prompt_tokens],
    ["T_ACTION", vla.action_chunk],
    ["N_DENOISE", vla.denoise_steps],
  ].filter(([, value]) => value !== null).map(([name, value]) => `${name}=${value}`).join(",");
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
    <ModelDisplayProvider modelId={model.model_id}>
    <ResolvedModelGraph
      data={data}
      record={record}
      model={model}
      route={route}
      navigate={navigate}
    />
    </ModelDisplayProvider>
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
  const t = useModelText();
  const isPi0 = model.model_id === "pi0";
  const defaultGraph = useMemo(() => adaptV1ModelGraph(record), [record]);
  const workloadBinding = useMemo(
    () => model.model_id === "pi0" ? resolveWorkloadBinding(data, route) : route.workload,
    [data, model.model_id, route],
  );
  const overrides = useMemo(
    () => workloadOverrides(workloadBinding, defaultGraph.editableSymbols),
    [defaultGraph.editableSymbols, workloadBinding],
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
    () => resolveFocusViewport(dag, layout, operator?.ref ?? null, model.model_id === "pi0" ? "stage" : "canvas"),
    [dag, layout, model.model_id, operator?.ref],
  );
  const pi0Roofline = useMemo(() => isPi0 ? materializeCurrentPi0Roofline({
    data,
    workloadBinding: route.workload,
    precisionPathId: route.precision,
    hardwareId: route.hardware,
  }) : null, [data, isPi0, route.hardware, route.precision, route.workload]);

  const updateWorkload = (next: Record<string, number>) => {
    navigate(
      { workload: encodeWorkload(next, defaultGraph.editableSymbols) },
      true,
    );
  };
  const workloadControls = (
    <WorkloadControls
      symbols={graph.editableSymbols}
      values={overrides}
      onChange={(symbol, value) => updateWorkload({ ...overrides, [symbol]: value })}
      onReset={() => navigate({ workload: null }, true)}
      compact={isPi0}
    >
      {isPi0 ? <details className="scenario-derived"><summary>派生形状</summary><DerivedSymbols symbols={graph.derivedSymbols} compact /></details> : null}
    </WorkloadControls>
  );

  return (
    <section className={`model-graph-workspace${isPi0 ? " pi0-workspace" : ""}`} aria-labelledby="logical-graph-title">
      {!isPi0 ? <>
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

      {workloadControls}
      <DerivedSymbols symbols={graph.derivedSymbols} />
      <p className="workload-annotation">
        {profile.workloadNote}
      </p>

      {operator ? <GraphBreadcrumb modelLabel={model.display_name} graph={graph} operator={operator} /> : null}
      </> : null}

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
        <section className="logical-graph-panel" aria-label={t(profile.panelLabel)}>
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
            ariaLabel={t(profile.diagramLabel)}
            compactControls={isPi0}
            cameraResetKey={`${model.model_id}|${route.workload ?? "defaults"}`}
            toolbar={isPi0 ? <>
              <h2 id="logical-graph-title">Pi0 <span>v{graph.version}</span></h2>
              <span className="graph-view-current">理论 DAG</span>
              <RouteLink route={route} navigate={navigate} patch={pi0PerformanceNavigationPatch("comparison")}>性能对比</RouteLink>
              {workloadControls}
            </> : undefined}
            scenario={isPi0 ? <>
              {!operator && pi0Roofline ? <ModelTheorySummary result={pi0Roofline} route={route} navigate={navigate} /> : null}
              <p className="graph-scenario-summary">
              当前场景：{overrides.V} 个视角，{overrides.L_PROMPT} 个提示词位置，{overrides.T_ACTION} 个动作词元，{overrides.N_DENOISE} 步去噪。
            </p></> : undefined}
          />
        </section>
        {operator ? (
          <OperatorInspector
            operator={operator}
            resetKey={`${operator.ref}|${route.workload ?? "defaults"}`}
            onClose={() => navigate({ entity: null }, true)}
            rooflinePanel={pi0Roofline ? <OperatorRooflinePanel
              result={pi0Roofline}
              logicalRef={operator.ref}
              fullAnalysisLink={<RouteLink route={route} navigate={navigate} patch={{
                ...pi0TheoryNavigationPatch(route, "expanded"),
                workload: pi0Roofline.status === "available" ? serializeInteractiveWorkload({
                  executedCameraViews: pi0Roofline.value.scenario.workload.executed_camera_views,
                  executedPromptTokens: pi0Roofline.value.scenario.workload.executed_prompt_tokens,
                  actionHorizon: pi0Roofline.value.scenario.workload.action_horizon,
                  denoiseSteps: pi0Roofline.value.scenario.workload.denoise_steps,
                }) : route.workload,
                precision: pi0Roofline.status === "available"
                  ? pi0Roofline.value.scenario.precision_path.precision_path_id
                  : route.precision,
                hardware: pi0Roofline.status === "available"
                  ? pi0Roofline.value.atomicBasis.device_id
                  : route.hardware,
              }}>展开此算子的 Roofline</RouteLink>}
            /> : undefined}
            evidenceLinks={{
              roofline: <RouteLink route={route} navigate={navigate} patch={{
                ...pi0TheoryNavigationPatch(route, "expanded"),
              }}>展开此算子的 Roofline</RouteLink>,
              kernel: <RouteLink route={route} navigate={navigate} patch={isPi0 ? pi0PerformanceNavigationPatch("comparison") : {
                tab: "roofline-kernels", rooflineLevel: "kernel", basis: null, entity: logicalEntity(operator.ref),
              }}>{isPi0 ? "选择推理栈查看 Kernel" : "查看实测 Kernel 证据"}</RouteLink>,
            }}
          />
        ) : null}
      </div>
    </section>
  );
}
