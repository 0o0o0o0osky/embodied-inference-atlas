import { useMemo } from "react";
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
import { indexRuntimeRealization } from "../domain/indexRuntimeRealization";
import type { RuntimeRealizationRecord } from "../domain/types";
import { buildRuntimeOverlay } from "../overlay/buildRuntimeOverlay";

interface Pi0ImplementationDagSectionProps {
  record: CanonicalRecord;
  route: RouteState;
  activeRealization: RuntimeRealizationRecord | null;
  selectedRuntimeName: string | null;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

function contains(viewport: GraphViewport, box: { x: number; y: number; width: number; height: number }) {
  return box.x >= viewport.x
    && box.y >= viewport.y
    && box.x + box.width <= viewport.x + viewport.width
    && box.y + box.height <= viewport.y + viewport.height;
}

export function Pi0ImplementationDagSection({ record, route, activeRealization, selectedRuntimeName, navigate }: Pi0ImplementationDagSectionProps) {
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
