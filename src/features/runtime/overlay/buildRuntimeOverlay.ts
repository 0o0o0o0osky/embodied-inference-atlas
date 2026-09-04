import type { LogicalDag, LogicalLayout, LogicalRef, NodeBox } from "../../model-graph/domain/types";
import { indexRuntimeRealization } from "../domain/indexRuntimeRealization";
import type {
  RuntimeBadge,
  RuntimeBoundary,
  RuntimeMapping,
  RuntimeOverlayModel,
  RuntimeRealizationRecord,
} from "../domain/types";

const BOUNDARY_SIDE_PADDING = 8;

function boundaryBox(boxes: readonly NodeBox[]): NodeBox {
  const left = Math.min(...boxes.map((box) => box.x)) - BOUNDARY_SIDE_PADDING;
  const top = Math.min(...boxes.map((box) => box.y)) - BOUNDARY_SIDE_PADDING;
  const right = Math.max(...boxes.map((box) => box.x + box.width)) + BOUNDARY_SIDE_PADDING;
  const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + BOUNDARY_SIDE_PADDING;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    compact: false,
    inline: false,
    row: "runtime-boundary",
    lane: 0,
  };
}

function visualClusters(refs: readonly LogicalRef[], layout: LogicalLayout): LogicalRef[][] {
  const clusters: LogicalRef[][] = [];
  const visualRows: LogicalRef[][] = [];
  [...refs]
    .filter((ref) => layout.nodeBoxes.has(ref))
    .sort((first, second) => layout.nodeBoxes.get(first)!.y - layout.nodeBoxes.get(second)!.y)
    .forEach((ref) => {
      const box = layout.nodeBoxes.get(ref)!;
      const row = visualRows.at(-1);
      const rowBox = row?.length ? layout.nodeBoxes.get(row[0]!) : undefined;
      if (row && rowBox && Math.abs(box.y - rowBox.y) <= 12) row.push(ref);
      else visualRows.push([ref]);
    });
  visualRows.forEach((rowRefs) => {
    const ordered = [...rowRefs].sort((first, second) =>
      layout.nodeBoxes.get(first)!.x - layout.nodeBoxes.get(second)!.x,
    );
    ordered.forEach((ref) => {
      const current = clusters.at(-1);
      const previous = current?.at(-1);
      if (!current || !previous) {
        clusters.push([ref]);
        return;
      }
      const previousBox = layout.nodeBoxes.get(previous)!;
      const box = layout.nodeBoxes.get(ref)!;
      if (box.x - previousBox.x - previousBox.width <= 72) current.push(ref);
      else clusters.push([ref]);
    });
  });
  return clusters;
}

function addBadge(
  badges: Map<LogicalRef, RuntimeBadge[]>,
  ref: LogicalRef,
  badge: RuntimeBadge,
) {
  const values = badges.get(ref) ?? [];
  values.push(badge);
  badges.set(ref, values);
}

function mappingBadges(mapping: RuntimeMapping): RuntimeBadge[] {
  const groupId = mapping.executionGroupIds[0] ?? null;
  const badges: RuntimeBadge[] = [];
  if (mapping.relation === "preserved") {
    badges.push({ kind: "preserved", label: "preserved", mappingId: mapping.mappingId, groupId });
  }
  if (mapping.relation === "split") {
    badges.push({ kind: "split", label: `split ×${mapping.executionGroupIds.length}`, mappingId: mapping.mappingId, groupId });
  }
  if (mapping.relation === "eliminated") {
    badges.push({ kind: "eliminated", label: "eliminated", mappingId: mapping.mappingId, groupId: null });
  }
  if (mapping.relation === "opaque") {
    badges.push({ kind: "opaque", label: "opaque", mappingId: mapping.mappingId, groupId });
  }
  if (mapping.certainty === "ambiguous") {
    badges.push({ kind: "ambiguous", label: "ambiguous", mappingId: mapping.mappingId, groupId });
  }
  if (mapping.path === "fallback") {
    badges.push({ kind: "fallback", label: "fallback", mappingId: mapping.mappingId, groupId });
  }
  return badges;
}

function selectedParts(realizationId: string, selectedEntity: string | null) {
  if (!selectedEntity) return { logicalRef: null, groupId: null };
  if (selectedEntity.startsWith("logical:")) {
    try {
      return { logicalRef: decodeURIComponent(selectedEntity.slice("logical:".length)), groupId: null };
    } catch {
      return { logicalRef: null, groupId: null };
    }
  }
  const prefix = `runtime-group:${realizationId}/`;
  return selectedEntity.startsWith(prefix)
    ? { logicalRef: null, groupId: selectedEntity.slice(prefix.length) }
    : { logicalRef: null, groupId: null };
}

export function buildRuntimeOverlay(
  dag: LogicalDag,
  layout: LogicalLayout,
  realization: RuntimeRealizationRecord,
  selectedEntity: string | null,
): RuntimeOverlayModel {
  const index = indexRuntimeRealization(realization);
  const diagnostics: string[] = [];
  const boundaries: RuntimeBoundary[] = [];
  const badgesByNode = new Map<LogicalRef, RuntimeBadge[]>();
  const precisionBadgedGroups = new Set<string>();

  realization.mappings.forEach((mapping) => {
    const visibleTargets = mapping.logicalTargets.filter((target) => {
      const visible = dag.nodes.has(target.ref) && layout.nodeBoxes.has(target.ref);
      if (!visible) diagnostics.push(`${mapping.mappingId}: logical target is not visible: ${target.ref}`);
      return visible;
    });
    visibleTargets.forEach((target) => {
      mappingBadges(mapping).forEach((badge) => addBadge(badgesByNode, target.ref, badge));
    });

    if (mapping.relation === "fused") {
      mapping.executionGroupIds.forEach((groupId) => {
        const group = index.groupById.get(groupId);
        if (!group) return;
        const byStage = new Map<string, LogicalRef[]>();
        visibleTargets.forEach((target) => {
          const stageId = dag.nodes.get(target.ref)?.stageId ?? "unknown";
          const values = byStage.get(stageId) ?? [];
          values.push(target.ref);
          byStage.set(stageId, values);
        });
        [...byStage].forEach(([stageId, nodeRefs]) => {
          visualClusters(nodeRefs, layout).forEach((cluster, fragmentIndex) => {
            const boxes = cluster
              .map((ref) => layout.nodeBoxes.get(ref))
              .filter((box): box is NodeBox => box !== undefined);
            if (!boxes.length) return;
            boundaries.push({
              fragmentId: `${mapping.mappingId}/${groupId}/${stageId}/${fragmentIndex}`,
              groupId,
              nodeRefs: cluster,
              box: boundaryBox(boxes),
              relation: mapping.relation,
              certainty: mapping.certainty,
              precisionPathId: group.precisionPathId,
            });
            precisionBadgedGroups.add(groupId);
          });
        });
      });
    }

    mapping.executionGroupIds.forEach((groupId) => {
      if (precisionBadgedGroups.has(groupId)) return;
      const group = index.groupById.get(groupId);
      const target = visibleTargets[0];
      const precision = group ? index.precisionById.get(group.precisionPathId) : undefined;
      if (!group || !target || !precision) return;
      addBadge(badgesByNode, target.ref, {
        kind: "precision",
        label: precision.label,
        mappingId: mapping.mappingId,
        groupId,
      });
      precisionBadgedGroups.add(groupId);
    });
  });

  const selection = selectedParts(realization.realizationId, selectedEntity);
  const highlightedLogicalRefs = new Set<LogicalRef>();
  const highlightedGroupIds = new Set<string>();
  if (selection.logicalRef) {
    index.mappingsByLogicalRef.get(selection.logicalRef)?.forEach((mapping) => {
      mapping.executionGroupIds.forEach((groupId) => highlightedGroupIds.add(groupId));
    });
  }
  if (selection.groupId) {
    highlightedGroupIds.add(selection.groupId);
    index.mappingsByGroupId.get(selection.groupId)?.forEach((mapping) => {
      mapping.logicalTargets.forEach((target) => highlightedLogicalRefs.add(target.ref));
    });
  }

  return {
    boundaries,
    badgesByNode,
    highlightedLogicalRefs,
    highlightedGroupIds,
    diagnostics: [...new Set(diagnostics)],
  };
}
