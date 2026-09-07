import { useMemo } from "react";

import { type RoutePatch, type RouteState } from "../../app/routes";
import { RouteLink } from "../../components/RouteLink";
import { AnalysisPlaceholder } from "../../components/AnalysisPlaceholder";
import { adaptRuntimeRealization, isRuntimeRealizationRecord } from "../runtime/domain/adaptRuntimeRealization";
import { indexRuntimeRealization } from "../runtime/domain/indexRuntimeRealization";
import { logicalEntity, logicalRefFromEntity, parseEntityKey } from "../workbench/entityKeys";
import type { AtlasData, CanonicalRecord, ModelRecord } from "../../types/atlas";
import { DerivedSymbols } from "./components/DerivedSymbols";
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
import { theoryNavigationPatch } from "../runtime/domain/analysisNavigation";
import { serializeInteractiveWorkload } from "../roofline/data/materialize";
import { materializeCurrentModelRoofline } from "../roofline/presentation/buildOperatorRooflineSummary";
import { ModelRooflineAnalysis } from "./components/ModelRooflineAnalysis";

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
    return <section className="model-graph-workspace model-workspace" aria-label={`${model.display_name} 模型理论`}>
      <AnalysisPlaceholder title={`${model.display_name} 模型结构尚未填写`} state="not_recorded"
        detail="补充模型结构与默认输入后，可在这里查看 DAG 和算子分析。已有测量可从运行表现查看。" />
    </section>;
  }

  return (
    <ModelDisplayProvider modelId={model.model_id}>
    {route.theoryView === "roofline" ? <ModelRooflineAnalysis data={data} model={model} route={route} navigate={navigate} /> : <ResolvedModelGraph
      data={data}
      record={record}
      model={model}
      route={route}
      navigate={navigate}
    />}
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
  const defaultGraph = useMemo(() => adaptV1ModelGraph(record), [record]);
  const workloadBinding = useMemo(
    () => resolveWorkloadBinding(data, route),
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
    () => resolveFocusViewport(dag, layout, operator?.ref ?? null, "stage"),
    [dag, layout, model.model_id, operator?.ref],
  );
  const modelRoofline = useMemo(() => materializeCurrentModelRoofline({
    modelId: model.model_id,
    data,
    workloadBinding: route.workload,
    precisionPathId: route.precision,
    hardwareId: route.hardware,
  }), [data, model.model_id, route.hardware, route.precision, route.workload]);

  const shapeKey = encodeWorkload(overrides, defaultGraph.editableSymbols);
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
    >
      <details className="scenario-derived"><summary>派生形状</summary><DerivedSymbols symbols={graph.derivedSymbols} compact /></details>
    </WorkloadControls>
  );

  return (
    <section className="model-graph-workspace model-workspace" aria-labelledby="logical-graph-title">

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
            compactControls
            cameraResetKey={`${model.model_id}|${shapeKey}`}
            toolbar={<>
              <h2 id="logical-graph-title">{model.display_name} <span>v{graph.version}</span></h2>
              {workloadControls}
            </>}
            scenario={<>
              {!operator && modelRoofline ? <ModelTheorySummary result={modelRoofline} route={route} navigate={navigate} /> : null}
              <p className="graph-scenario-summary">
              当前场景：{overrides.V} 个视角，{overrides.L_PROMPT} 个 prompt token，{overrides.T_ACTION} 个动作 token，{overrides.N_DENOISE} 步去噪。
            </p></>}
          />
        </section>
        {operator ? (
          <OperatorInspector
            operator={operator}
            resetKey={`${operator.ref}|${shapeKey}`}
            onClose={() => navigate({ entity: null }, true)}
            rooflinePanel={modelRoofline ? <OperatorRooflinePanel
              result={modelRoofline}
              detail={operator}
              logicalRef={operator.ref}
              fullAnalysisLink={<RouteLink route={route} navigate={navigate} patch={{
                ...theoryNavigationPatch(route, "expanded"),
                workload: modelRoofline.status === "available" ? serializeInteractiveWorkload({
                  executedCameraViews: modelRoofline.value.scenario.workload.executed_camera_views,
                  executedPromptTokens: modelRoofline.value.scenario.workload.executed_prompt_tokens,
                  actionHorizon: modelRoofline.value.scenario.workload.action_horizon,
                  denoiseSteps: modelRoofline.value.scenario.workload.denoise_steps,
                }) : route.workload,
                precision: modelRoofline.status === "available"
                  ? modelRoofline.value.scenario.precision_path.precision_path_id
                  : route.precision,
                hardware: modelRoofline.status === "available"
                  ? modelRoofline.value.atomicBasis.device_id
                  : route.hardware,
              }}>展开此算子的 Roofline</RouteLink>}
            /> : undefined}
            rooflineLink={<RouteLink route={route} navigate={navigate} patch={{
              ...theoryNavigationPatch(route, "expanded"),
            }}>展开此算子的 Roofline</RouteLink>}
          />
        ) : null}
      </div>
    </section>
  );
}
