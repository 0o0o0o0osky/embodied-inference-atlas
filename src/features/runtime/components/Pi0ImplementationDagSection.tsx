import { useMemo, useState, type ReactNode } from "react";
import type { RoutePatch, RouteState } from "../../../app/routes";
import type { CanonicalRecord } from "../../../types/atlas";
import { LogicalDagSvg } from "../../model-graph/components/LogicalDagSvg";
import { adaptLogicalDag, incidentNodeRefs } from "../../model-graph/domain/adaptLogicalDag";
import { adaptV1ModelGraph } from "../../model-graph/domain/adaptV1ModelGraph";
import type { LogicalRef } from "../../model-graph/domain/types";
import { resolveFocusViewport, type GraphViewport } from "../../model-graph/domain/focusViewport";
import { workloadOverrides } from "../../model-graph/domain/workload";
import { layoutLogicalDag } from "../../model-graph/layout/paperLayout";
import { resolveConnectorHints } from "../../model-graph/layout/routeConnectors";
import { resolvePresentationProfile } from "../../model-graph/presentation/registry";
import { logicalEntity, logicalRefFromEntity, parseEntityKey, runtimeGroupEntity } from "../../workbench/entityKeys";
import { Pi0ExecutionInspector } from "./Pi0ExecutionInspector";
import { Pi0RuntimeMappingDisclosure } from "./Pi0RuntimeMappingDisclosure";
import { RuntimeOverlay } from "./RuntimeOverlay";
import "./runtimeImplementation.css";
import { indexRuntimeRealization } from "../domain/indexRuntimeRealization";
import type { RuntimeRealizationRecord } from "../domain/types";
import { buildRuntimeOverlay } from "../overlay/buildRuntimeOverlay";
import type { RuntimeBounds } from "../domain/runtimeBounds";

interface Pi0ImplementationDagSectionProps {
  sources?: readonly CanonicalRecord[] | undefined;
  record: CanonicalRecord;
  route: RouteState;
  activeRealization: RuntimeRealizationRecord | null;
  selectedRuntimeName: string | null;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
  bounds?: RuntimeBounds;
  initialShowPrecision?: boolean;
  renderKernelDetails?: (groupIds: readonly string[]) => ReactNode;
}

function contains(viewport: GraphViewport, box: { x: number; y: number; width: number; height: number }) {
  return box.x >= viewport.x
    && box.y >= viewport.y
    && box.x + box.width <= viewport.x + viewport.width
    && box.y + box.height <= viewport.y + viewport.height;
}

export function Pi0ImplementationDagSection({ sources, record, route, activeRealization, selectedRuntimeName, navigate, bounds, initialShowPrecision = false, renderKernelDetails }: Pi0ImplementationDagSectionProps) {
  const [display, setDisplay] = useState<"theory" | "implementation">("implementation");
  const [showPrecision, setShowPrecision] = useState(initialShowPrecision);
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
  const selectGroup = (groupId: string) => {
    if (activeRealization) navigate({ entity: runtimeGroupEntity(activeRealization.realizationId, groupId) }, true);
  };

  return (
    <section aria-label="完整实现 DAG 与映射">
      <header className="runtime-implementation-header">
        <div><h4>{selectedRuntimeName} 的执行方式</h4><p>查看融合边界、计算路径与执行精度。</p></div>
        <div className="runtime-implementation-switch" aria-label="实现视图">
          {([["theory", "理论原图"], ["implementation", "实现叠加"]] as const).map(([id, label]) =>
            <button type="button" key={id} aria-pressed={display === id} onClick={() => setDisplay(id)}>{label}</button>)}
        </div>
      </header>
      <div className="runtime-implementation-legend" aria-hidden={display !== "implementation"} style={{ visibility: display === "implementation" ? "visible" : "hidden" }}>
        <span><i />融合计算</span><span><i className="is-precomputed" />预计算 / 共享数据切片 / 消除</span>
        <span>无标记：未标注实现差异</span>
        <label><input type="checkbox" checked={showPrecision} onChange={(event) => setShowPrecision(event.target.checked)} />显示精度</label>
      </div>
      {(layout.diagnostics.length || connectors.invalidHints.length || overlay?.diagnostics.length) ? (
        <div className="graph-diagnostics" role="status">
          {[...layout.diagnostics, ...connectors.invalidHints.map((hint) => `Invalid route hint: ${hint.id}`), ...(overlay?.diagnostics ?? [])].join(" ")}
        </div>
      ) : null}

      <div className={`runtime-implementation-canvas pi0-runtime-dag-grid${drawerOpen ? " is-focused" : ""}`}>
        <section className="logical-graph-panel" aria-label="推理栈实现图">
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
            ariaLabel="模型算子图及推理栈实现覆盖层"
            underlay={display === "implementation" && activeRealization && overlay ? <RuntimeOverlay
              layout={layout} realization={activeRealization} overlay={overlay} onSelectGroup={selectGroup}
              layer="background" showPrecision={showPrecision} /> : undefined}
            overlay={display === "implementation" && activeRealization && overlay ? (
              <RuntimeOverlay
                layout={layout}
                realization={activeRealization}
                overlay={overlay}
                onSelectGroup={selectGroup}
                layer="labels"
                showPrecision={showPrecision}
                avoidPaths={connectors.connectors.flatMap((connector) => connector.paths)}
              />
            ) : undefined}
            compactControls
            cameraResetKey={`${activeRealization?.modelId ?? route.model}-runtime|${route.runtime ?? "none"}|${route.hardware ?? "none"}|${route.runtimePrecision ?? "none"}|${route.workload ?? "defaults"}`}
          />
        </section>
        {drawerOpen && activeRealization && route.entity ? (
          <Pi0ExecutionInspector
            sources={sources}
            {...(bounds ? { groupBounds: bounds.groups } : {})}
            {...(renderKernelDetails ? { renderKernelDetails } : {})}
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
