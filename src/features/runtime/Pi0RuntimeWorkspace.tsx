import { useMemo } from "react";

import type { RoutePatch, RouteState } from "../../app/routes";
import { RouteLink } from "../../components/RouteLink";
import type { AtlasData, CanonicalRecord, ModelRecord } from "../../types/atlas";
import { LogicalDagSvg } from "../model-graph/components/LogicalDagSvg";
import { adaptLogicalDag, incidentNodeRefs } from "../model-graph/domain/adaptLogicalDag";
import { adaptV1ModelGraph } from "../model-graph/domain/adaptV1ModelGraph";
import type { LogicalRef } from "../model-graph/domain/types";
import { resolveFocusViewport, type GraphViewport } from "../model-graph/domain/focusViewport";
import { workloadOverrides } from "../model-graph/domain/workload";
import { layoutLogicalDag } from "../model-graph/layout/paperLayout";
import { resolveConnectorHints } from "../model-graph/layout/routeConnectors";
import { resolvePresentationProfile } from "../model-graph/presentation/registry";
import { logicalEntity, logicalRefFromEntity, parseEntityKey, runtimeGroupEntity } from "../workbench/entityKeys";
import { Pi0ExecutionInspector } from "./components/Pi0ExecutionInspector";
import { Pi0RuntimeMappingDisclosure } from "./components/Pi0RuntimeMappingDisclosure";
import { RuntimeOverlay } from "./components/RuntimeOverlay";
import {
  pi0MappingCoverageLabel,
  pi0MappingLevelLabel,
  pi0PrecisionLabel,
} from "./components/runtimePresentation";
import { adaptRuntimeRealization, isRuntimeRealizationRecord } from "./domain/adaptRuntimeRealization";
import { indexRuntimeRealization } from "./domain/indexRuntimeRealization";
import { isAnalyticalToolForModel } from "./domain/runtimeCatalog";
import {
  buildRuntimeStackSummaries,
  resolveRuntimeCandidates,
  type RuntimeCandidate,
  type RuntimeStackState,
  type RuntimeStackSummary,
} from "./domain/resolveRuntimeRealization";
import type { RuntimeRealizationRecord } from "./domain/types";
import { buildRuntimeOverlay } from "./overlay/buildRuntimeOverlay";

interface Pi0RuntimeWorkspaceProps {
  data: AtlasData;
  model: ModelRecord;
  record: CanonicalRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

function stateTone(state: RuntimeStackState) {
  if (state === "有实测配置") return "measured";
  if (state === "未实测·受阻") return "blocked";
  if (state === "不支持") return "unsupported";
  return "unmeasured";
}

function submissionLabel(realization: RuntimeRealizationRecord) {
  const submission = {
    eager_dispatch: "逐项提交",
    cuda_graph_replay: "CUDA Graph 回放",
    backend_graph_compute: "后端图执行",
    none: "无提交记录",
  }[realization.launch.submissionMode];
  const graphState = {
    present: "已记录 CUDA Graph",
    absent: "未使用 CUDA Graph",
    unknown: "CUDA Graph 状态未知",
    not_applicable: "CUDA Graph 不适用",
  }[realization.launch.cudaGraphState];
  return `${submission} · ${graphState}`;
}

function selectedMessage(
  summary: RuntimeStackSummary | null,
  selectedRuntimeName: string | null,
  selectedAnalysisToolName: string | null,
  candidates: readonly RuntimeCandidate[],
  activeCandidate: RuntimeCandidate | null,
  route: RouteState,
) {
  if (!route.runtime) return "选择一个推理栈后，实测配置会叠加到下方固定逻辑图。";
  if (selectedAnalysisToolName) return `${selectedAnalysisToolName} 是理论分析工具，请在“理论总览”中使用，不作为推理栈覆盖。`;
  if (!summary || !selectedRuntimeName) return "URL 中的推理栈不在当前 Pi0 快照内，因此不生成覆盖层。";
  if (summary.state === "未实测·受阻") return `${selectedRuntimeName} 的记录在推理开始前受阻，没有可用实测配置。`;
  if (summary.state === "不支持") return `Pi0 不支持 ${selectedRuntimeName}；不会合成实现覆盖层。`;
  if (summary.state === "尚未实测") return `当前硬件没有 ${selectedRuntimeName} 的硬件绑定实测实现记录。`;
  if (activeCandidate) return null;
  if (!route.runtimePrecision && candidates.length > 1) {
    return `${selectedRuntimeName} 有 ${candidates.length} 个实测配置，请在页首选择实际精度；选择前不显示实现覆盖层。`;
  }
  return route.workload
    ? "当前工作负载或实际精度没有精确匹配的实测配置，因此不显示实现覆盖层。"
    : "所选实际精度没有精确匹配的实测配置，因此不显示实现覆盖层。";
}

function contains(viewport: GraphViewport, box: { x: number; y: number; width: number; height: number }) {
  return box.x >= viewport.x
    && box.y >= viewport.y
    && box.x + box.width <= viewport.x + viewport.width
    && box.y + box.height <= viewport.y + viewport.height;
}

export function Pi0RuntimeWorkspace({
  data,
  model,
  record,
  route,
  navigate,
}: Pi0RuntimeWorkspaceProps) {
  const defaultGraph = useMemo(() => adaptV1ModelGraph(record), [record]);
  const overrides = useMemo(
    () => workloadOverrides(route.workload, defaultGraph.editableSymbols),
    [defaultGraph.editableSymbols, route.workload],
  );
  const graph = useMemo(() => adaptV1ModelGraph(record, overrides), [record, overrides]);
  const structuralDag = useMemo(() => adaptLogicalDag(defaultGraph), [defaultGraph]);
  const dag = useMemo(() => adaptLogicalDag(graph), [graph]);
  const profile = useMemo(
    () => resolvePresentationProfile(defaultGraph, structuralDag),
    [defaultGraph, structuralDag],
  );
  // Runtime, hardware, workload, precision, and entity never enter this memo.
  const layout = useMemo(
    () => layoutLogicalDag(structuralDag, profile.presentation),
    [profile.presentation, structuralDag],
  );
  const connectors = useMemo(
    () => resolveConnectorHints(structuralDag, profile.presentation, layout),
    [layout, profile.presentation, structuralDag],
  );
  const realizations = useMemo(
    () => data.datasets.runtime_realizations
      .filter((item) => isRuntimeRealizationRecord(item, model.model_id))
      .map(adaptRuntimeRealization),
    [data.datasets.runtime_realizations, model.model_id],
  );
  const canonicalConfigurationIds = useMemo(() => new Set([
    ...data.datasets.runs.map((run) => run.configuration_id),
    ...realizations.flatMap((realization) => realization.configurationIds),
  ]), [data.datasets.runs, realizations]);
  // The comparison rail is a hardware witness inventory, not a workload match report.
  const summaries = useMemo(() => buildRuntimeStackSummaries({
    modelId: model.model_id,
    modelGraphId: graph.graphId,
    hardwareId: route.hardware,
    workload: null,
    runtimes: data.datasets.runtimes,
    realizations,
    runs: data.datasets.runs,
    canonicalConfigurationIds,
  }), [canonicalConfigurationIds, data.datasets.runs, data.datasets.runtimes, graph.graphId, model.model_id, realizations, route.hardware]);
  const candidates = useMemo(() => route.runtime ? resolveRuntimeCandidates(
    realizations,
    data.datasets.runs,
    {
      modelId: model.model_id,
      modelGraphId: graph.graphId,
      runtimeId: route.runtime,
      hardwareId: route.hardware,
      workload: route.workload,
      precisionId: null,
      canonicalConfigurationIds,
    },
  ) : [], [canonicalConfigurationIds, data.datasets.runs, graph.graphId, model.model_id, realizations, route.hardware, route.runtime, route.workload]);
  const precisionMatches = route.runtimePrecision
    ? candidates.filter((candidate) => candidate.actualPrecisionId === route.runtimePrecision)
    : candidates;
  const activeCandidate = precisionMatches.length === 1
    && (route.runtimePrecision !== null || candidates.length === 1)
    ? precisionMatches[0]!
    : null;
  const activeRealization = activeCandidate?.realization ?? null;
  const selectedSummary = summaries.find((summary) => summary.runtimeId === route.runtime) ?? null;
  const selectedRuntimeName = selectedSummary?.displayName ?? null;
  const selectedCatalogRuntime = data.datasets.runtimes.find((runtime) => runtime.runtime_id === route.runtime) ?? null;
  const selectedAnalysisToolName = selectedCatalogRuntime
    && isAnalyticalToolForModel(selectedCatalogRuntime, model.model_id)
    ? selectedCatalogRuntime.display_name
    : null;
  const resolutionMessage = selectedMessage(
    selectedSummary,
    selectedRuntimeName,
    selectedAnalysisToolName,
    candidates,
    activeCandidate,
    route,
  );
  const overlay = useMemo(
    () => activeRealization ? buildRuntimeOverlay(dag, layout, activeRealization, route.entity) : null,
    [activeRealization, dag, layout, route.entity],
  );

  const parsedEntity = parseEntityKey(route.entity);
  const logicalRef = logicalRefFromEntity(route.entity);
  const selectedLogicalNode = activeRealization && logicalRef ? dag.nodes.get(logicalRef) : undefined;
  const validLogicalRef = selectedLogicalNode?.kind === "operator" ? logicalRef : null;
  const realizationIndex = useMemo(
    () => activeRealization ? indexRuntimeRealization(activeRealization) : null,
    [activeRealization],
  );
  const selectedGroup = activeRealization && realizationIndex
    && parsedEntity?.kind === "runtime-group"
    && parsedEntity.realizationId === activeRealization.realizationId
    ? realizationIndex.groupById.get(parsedEntity.executionGroupId)
    : undefined;
  const groupMappings = selectedGroup && realizationIndex
    ? realizationIndex.mappingsByGroupId.get(selectedGroup.executionGroupId) ?? []
    : [];
  const exactGroupRefs = selectedGroup && groupMappings.length
    && groupMappings.every((mapping) => mapping.path === "primary" && mapping.certainty === "exact")
    ? [...new Set(groupMappings.flatMap((mapping) => mapping.logicalTargets.map((target) => target.ref)))]
    : [];
  const groupStages = new Set(exactGroupRefs.map((ref) => dag.nodes.get(ref)?.stageId).filter(Boolean));
  const groupViewportCandidate = exactGroupRefs[0]
    ? resolveFocusViewport(dag, layout, exactGroupRefs[0], "stage")
    : null;
  const safeGroupFocus = groupViewportCandidate && groupStages.size === 1
    && exactGroupRefs.every((ref) => {
      const box = layout.nodeBoxes.get(ref);
      return box ? contains(groupViewportCandidate, box) : false;
    })
    ? groupViewportCandidate
    : null;
  const logicalViewport = validLogicalRef
    ? resolveFocusViewport(dag, layout, validLogicalRef, "stage")
    : null;
  const focusRefs = new Set<LogicalRef>(safeGroupFocus ? exactGroupRefs : []);
  const relatedRefs = validLogicalRef
    ? incidentNodeRefs(dag, validLogicalRef)
    : safeGroupFocus
      ? new Set(exactGroupRefs.flatMap((ref) => [...incidentNodeRefs(dag, ref), ref]))
      : new Set<LogicalRef>();
  const drawerOpen = Boolean(activeRealization && route.entity && (validLogicalRef || selectedGroup));
  const viewport = logicalViewport ?? safeGroupFocus ?? undefined;
  const focusMode = logicalViewport || safeGroupFocus ? "focus" as const : "overview" as const;
  const hardwareName = data.datasets.devices.find((device) => device.device_id === route.hardware)?.display_name
    ?? "未选择硬件";

  const selectRuntime = (summary: RuntimeStackSummary) => navigate({
    runtime: summary.runtimeId,
    runtimePrecision: summary.actualPrecisions.length === 1 ? summary.actualPrecisions[0]!.id : null,
    entity: null,
  });
  const selectGroup = (groupId: string) => {
    if (activeRealization) navigate({ entity: runtimeGroupEntity(activeRealization.realizationId, groupId) }, true);
  };

  return (
    <section className="model-graph-workspace pi0-workspace pi0-runtime-workspace" aria-labelledby="pi0-runtime-title">
      <nav className="pi0-runtime-toolbar" aria-label="Pi0 模型工作台视图">
        <h2 id="pi0-runtime-title">Pi0 <span>v{graph.version.split(".")[0]}</span></h2>
        <RouteLink route={route} navigate={navigate} patch={{ tab: "logical" }}>理论模型</RouteLink>
        <span className="graph-view-current" aria-current="page">推理栈实现</span>
        <RouteLink route={route} navigate={navigate} patch={{ tab: "roofline-kernels", rooflineLevel: "overview", entity: null }}>理论总览</RouteLink>
      </nav>

      <section className="pi0-runtime-comparison" aria-labelledby="pi0-runtime-comparison-title">
        <header>
          <h3 id="pi0-runtime-comparison-title">推理栈比较</h3>
          <span>{hardwareName} · 当前硬件见证</span>
        </header>
        <div className="pi0-runtime-comparison-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">推理栈</th>
                {summaries.map((summary) => (
                  <th key={summary.runtimeId} scope="col" className={route.runtime === summary.runtimeId ? "is-current" : undefined}>
                    <button type="button" aria-pressed={route.runtime === summary.runtimeId} onClick={() => selectRuntime(summary)}>
                      <strong>{summary.displayName}</strong><small>{summary.backend}</small>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">状态</th>
                {summaries.map((summary) => (
                  <td key={summary.runtimeId} className={route.runtime === summary.runtimeId ? "is-current" : undefined}>
                    <span className={`pi0-runtime-stack-state is-${stateTone(summary.state)}`}>{summary.state}</span>
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">实际配置精度</th>
                {summaries.map((summary) => (
                  <td key={summary.runtimeId} className={route.runtime === summary.runtimeId ? "is-current" : undefined}>
                    {summary.actualPrecisions.length
                      ? summary.actualPrecisions.map((precision) => (
                          <span key={precision.id}>{pi0PrecisionLabel(precision.id, precision.label)}</span>
                        ))
                      : <span>—</span>}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">映射 / 实现数</th>
                {summaries.map((summary) => (
                  <td key={summary.runtimeId} className={route.runtime === summary.runtimeId ? "is-current" : undefined}>
                    {summary.mappingLevels.length
                      ? <span>{summary.mappingLevels.map(pi0MappingLevelLabel).join(" / ")} · {summary.variantCount} 个实现</span>
                      : <span>—</span>}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {resolutionMessage ? (
        <p className={`pi0-runtime-resolution${selectedSummary ? ` is-${stateTone(selectedSummary.state)}` : ""}`} role="status">
          {resolutionMessage}
        </p>
      ) : null}

      {activeCandidate && activeRealization ? (
        <section className="pi0-runtime-summary" aria-label="所选实现摘要">
          <dl>
            <div><dt>实际配置精度</dt><dd>{pi0PrecisionLabel(activeCandidate.actualPrecisionId, activeCandidate.precisionLabel)}</dd></div>
            <div><dt>映射范围</dt><dd>{pi0MappingLevelLabel(activeRealization.mappingLevel)} · {pi0MappingCoverageLabel(activeRealization.mappingCoverage)}</dd></div>
            <div>
              <dt>提交 / CUDA Graph</dt>
              <dd>{submissionLabel(activeRealization)}<small>提交元数据不证明算子融合。</small></dd>
            </div>
            <div><dt>实现清单</dt><dd>{activeRealization.executionGroups.length} 个执行组 · {activeRealization.mappings.length} 项映射</dd></div>
          </dl>
          <p className="pi0-runtime-evidence-line">配置：有实测 / 映射：源码审计 / Kernel 关联：未建立</p>
          {route.workload
            ? <p className="pi0-runtime-workload-note">当前工作负载筛选已解析到该实测配置。</p>
            : <p className="pi0-runtime-workload-note">未指定工作负载筛选；不主张与理论默认场景一致。</p>}
        </section>
      ) : null}

      {(layout.diagnostics.length || connectors.invalidHints.length || overlay?.diagnostics.length) ? (
        <div className="graph-diagnostics" role="status">
          {[...layout.diagnostics, ...connectors.invalidHints.map((hint) => `Invalid route hint: ${hint.id}`), ...(overlay?.diagnostics ?? [])].join(" ")}
        </div>
      ) : null}

      <div className={`pi0-runtime-dag-grid${drawerOpen ? " is-focused" : ""}`}>
        <section className="logical-graph-panel" aria-label="Pi0 推理栈实现图">
          <LogicalDagSvg
            dag={dag}
            layout={layout}
            connectors={connectors}
            presentation={profile.presentation}
            selectedRef={validLogicalRef ?? ""}
            {...(safeGroupFocus ? { focusRefs } : {})}
            relatedRefs={relatedRefs}
            mode={focusMode}
            {...(viewport ? { viewport } : {})}
            onSelect={(ref) => {
              if (activeRealization) navigate({ entity: logicalEntity(ref) }, true);
            }}
            ariaLabel="Pi0 逻辑算子图及推理栈实现覆盖层"
            overlay={activeRealization && overlay ? (
              <RuntimeOverlay
                layout={layout}
                realization={activeRealization}
                overlay={overlay}
                onSelectGroup={selectGroup}
                pi0
                avoidPaths={connectors.connectors.flatMap((connector) => connector.paths)}
              />
            ) : undefined}
            compactControls
            cameraResetKey={`pi0-runtime|${route.runtime ?? "none"}|${route.hardware ?? "none"}|${route.runtimePrecision ?? "none"}|${route.workload ?? "defaults"}`}
            scenario={<p className="graph-scenario-summary">
              {activeRealization
                ? `覆盖层：${selectedRuntimeName} · 映射依据为源码审计，并非 profiler 关联。`
                : "未生成实现覆盖层；逻辑 DAG 的节点、连线与坐标保持不变。"}
            </p>}
          />
        </section>
        {drawerOpen && activeRealization && route.entity ? (
          <Pi0ExecutionInspector
            dag={dag}
            realization={activeRealization}
            selectedEntity={route.entity}
            onClose={() => navigate({ entity: null }, true)}
          />
        ) : null}
      </div>

      {activeRealization ? (
        <Pi0RuntimeMappingDisclosure
          dag={dag}
          realization={activeRealization}
          onSelectGroup={selectGroup}
        />
      ) : null}
    </section>
  );
}
