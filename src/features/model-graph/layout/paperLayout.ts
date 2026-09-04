import type {
  BoundaryLaneSpec,
  GraphPresentation,
  LogicalDag,
  LogicalLayout,
  LogicalNode,
  LogicalRef,
  NodeBox,
  RowSpec,
  ScopeBox,
  StageBox,
} from "../domain/types";

export const PAPER_LAYOUT = Object.freeze({
  width: 1080,
  margin: 14,
  columnWidth: 340,
  columnGap: 16,
  stageTop: 10,
  contentInset: 24,
  rowStep: 48,
  moduleGap: 20,
  firstRow: 120,
  loopFirstRow: 214,
  inputRow: 76,
  loopInputRow: 116,
  loopRow: 166,
  outputGap: 76,
  stageBottomPadding: 48,
});

const COMPACT_DEFINITIONS = new Set([
  "concat",
  "euler-update",
  "gelu",
  "layer-norm",
  "reshape",
  "rms-norm",
  "rope",
  "silu",
  "slice",
]);

interface NodeSize {
  width: number;
  height: number;
  compact: boolean;
  inline: boolean;
}

function nodeAlias(node: LogicalNode, presentation: GraphPresentation): string {
  return (
    presentation.aliases[node.ref] ??
    node.operatorId?.split("-").slice(0, 2).join(" ") ??
    node.label
  );
}

function nodeVisual(node: LogicalNode, presentation: GraphPresentation) {
  return presentation.visualOverrides[node.ref] ?? node.visual;
}

function nodeSize(
  node: LogicalNode,
  presentation: GraphPresentation,
  availableWidth: number,
  solo: boolean,
): NodeSize {
  const visual = nodeVisual(node, presentation);
  if (visual === "inline") return { width: 20, height: 20, compact: true, inline: true };
  if (visual === "storage") {
    return { width: Math.min(64, availableWidth), height: 28, compact: true, inline: false };
  }
  if (visual === "read-port") {
    return { width: Math.min(30, availableWidth), height: 24, compact: true, inline: false };
  }
  if (visual === "logical-view") {
    return { width: Math.min(82, availableWidth), height: 26, compact: true, inline: false };
  }
  if (visual === "line-op") {
    return { width: Math.min(58, availableWidth), height: 20, compact: true, inline: false };
  }
  if (visual === "control") {
    return { width: Math.min(42, availableWidth), height: 22, compact: true, inline: false };
  }
  const compact = node.kind !== "operator" || COMPACT_DEFINITIONS.has(node.definitionId);
  const aliasWidth = Math.max(54, nodeAlias(node, presentation).length * 6.4 + 20);
  return {
    width: Math.min(availableWidth, solo ? Math.max(84, aliasWidth) : aliasWidth),
    height: compact ? 28 : 38,
    compact,
    inline: false,
  };
}

function slotRefs(slot: RowSpec["slots"][number]): readonly LogicalRef[] {
  if (slot === null) return [];
  return Array.isArray(slot) ? slot : [slot as LogicalRef];
}

function placeRow(
  boxes: Map<LogicalRef, NodeBox>,
  dag: LogicalDag,
  presentation: GraphPresentation,
  stage: Pick<StageBox, "contentX" | "contentWidth">,
  row: RowSpec,
  centerY: number,
  rowIndex: number | string,
) {
  const effectiveCenter = centerY + (row.offsetY ?? 0);
  const slotWidth = stage.contentWidth / row.slots.length;
  row.slots.forEach((slot, slotIndex) => {
    const refs = slotRefs(slot);
    if (!refs.length) return;
    const chainGap = 10;
    const available = (slotWidth - chainGap * (refs.length - 1)) / refs.length;
    const sizes = refs.map((ref) => {
      const node = dag.nodes.get(ref);
      return node ? nodeSize(node, presentation, available - 4, row.slots.length === 1 && refs.length === 1) : null;
    });
    const chainWidth = sizes.reduce(
      (total, size) => total + (size?.width ?? 0),
      chainGap * (refs.length - 1),
    );
    let x = stage.contentX + slotIndex * slotWidth + (slotWidth - chainWidth) / 2;
    if (row.centerBetween && row.slots.length === 1 && refs.length === 1) {
      const sourceBoxes = row.centerBetween.map((ref) => boxes.get(ref));
      if (sourceBoxes.every((box) => box !== undefined)) {
        const centers = sourceBoxes.map((box) => box!.x + box!.width / 2);
        x = centers.reduce((total, value) => total + value, 0) / centers.length - chainWidth / 2;
      }
    } else if (row.alignTo && row.slots.length === 1 && refs.length === 1) {
      const source = boxes.get(row.alignTo);
      if (source) x = source.x + source.width / 2 - chainWidth / 2;
    }
    refs.forEach((ref, chainIndex) => {
      const size = sizes[chainIndex];
      if (!size || !dag.nodes.has(ref)) return;
      boxes.set(ref, {
        x,
        y: effectiveCenter - size.height / 2,
        width: size.width,
        height: size.height,
        compact: size.compact,
        inline: size.inline,
        row: rowIndex,
        lane: slotIndex,
        chain: chainIndex,
      });
      x += size.width + chainGap;
    });
  });
}

function placeBoundary(
  boxes: Map<LogicalRef, NodeBox>,
  dag: LogicalDag,
  presentation: GraphPresentation,
  stage: Pick<StageBox, "contentX" | "contentWidth">,
  refs: readonly LogicalRef[],
  centerY: number,
  row: string,
  authored?: BoundaryLaneSpec,
) {
  if (!refs.length) return;
  const slotCount = authored?.slotCount ?? refs.length;
  const slotWidth = stage.contentWidth / slotCount;
  refs.forEach((ref, index) => {
    const node = dag.nodes.get(ref);
    if (!node) return;
    const lane = authored?.lanes[ref] ?? index;
    const size = nodeSize(node, presentation, slotWidth - 10, slotCount === 1);
    boxes.set(ref, {
      x: stage.contentX + lane * slotWidth + (slotWidth - size.width) / 2,
      y: centerY - size.height / 2,
      width: size.width,
      height: size.height,
      compact: true,
      inline: false,
      row,
      lane,
    });
  });
}

function scopeBounds(
  scopeId: string,
  refs: readonly LogicalRef[],
  boxes: ReadonlyMap<LogicalRef, NodeBox>,
  padding: number,
): ScopeBox | null {
  const values = refs.map((ref) => boxes.get(ref)).filter((box): box is NodeBox => box !== undefined);
  if (!values.length) return null;
  const headerHeight = 18;
  const headerGap = 12;
  const left = Math.min(...values.map((value) => value.x));
  const top = Math.min(...values.map((value) => value.y));
  const right = Math.max(...values.map((value) => value.x + value.width));
  const bottom = Math.max(...values.map((value) => value.y + value.height));
  const contentTop = top - padding;
  const headerBottom = contentTop - headerGap;
  return {
    scopeId,
    x: left - padding,
    y: headerBottom - headerHeight,
    width: right - left + padding * 2,
    height: bottom - headerBottom + padding + headerHeight,
    headerHeight,
    contentTop,
    headerBottom,
  };
}

export function layoutLogicalDag(
  dag: LogicalDag,
  presentation: GraphPresentation,
): LogicalLayout {
  const nodeBoxes = new Map<LogicalRef, NodeBox>();
  const stageBoxes: StageBox[] = [];
  const diagnostics: string[] = [];
  const configured = new Set(
    Object.values(presentation.rowsByStage).flatMap((rows) =>
      rows.flatMap((row) => row.slots.flatMap(slotRefs)),
    ),
  );

  dag.stageOrder.forEach((stageId, stageIndex) => {
    const stageRecord = dag.stages.find((stage) => stage.id === stageId);
    if (!stageRecord) {
      diagnostics.push(`Missing stage record: ${stageId}`);
      return;
    }
    const stageRefs = [...dag.nodes.values()]
      .filter((node) => node.stageId === stageId)
      .map((node) => node.ref);
    const x = PAPER_LAYOUT.margin + stageIndex * (PAPER_LAYOUT.columnWidth + PAPER_LAYOUT.columnGap);
    const stage: StageBox = {
      stageId,
      label: stageRecord.label,
      description: stageRecord.description,
      x,
      y: PAPER_LAYOUT.stageTop,
      width: PAPER_LAYOUT.columnWidth,
      height: 0,
      contentX: x + PAPER_LAYOUT.contentInset,
      contentWidth: PAPER_LAYOUT.columnWidth - PAPER_LAYOUT.contentInset * 2,
      effectiveRows: 0,
    };
    const inputs = stageRefs.filter((ref) => dag.nodes.get(ref)?.kind === "input");
    const controls = stageRefs.filter((ref) => dag.nodes.get(ref)?.kind === "control");
    const loops = stageRefs.filter((ref) => dag.nodes.get(ref)?.kind === "loop");
    const boundary = presentation.boundaryLanes[stageId];
    placeBoundary(
      nodeBoxes,
      dag,
      presentation,
      stage,
      [...inputs, ...controls],
      loops.length || controls.length ? PAPER_LAYOUT.loopInputRow : PAPER_LAYOUT.inputRow,
      "input",
      boundary?.input,
    );
    placeBoundary(
      nodeBoxes,
      dag,
      presentation,
      stage,
      loops,
      PAPER_LAYOUT.loopRow,
      "loop",
      boundary?.loop,
    );

    const rows = presentation.rowsByStage[stageId] ?? [];
    let rowY = loops.length || controls.length ? PAPER_LAYOUT.loopFirstRow : PAPER_LAYOUT.firstRow;
    let lastCenter = rowY;
    rows.forEach((row, rowIndex) => {
      if (rowIndex && row.gapBefore) rowY += PAPER_LAYOUT.moduleGap;
      placeRow(nodeBoxes, dag, presentation, stage, row, rowY, rowIndex);
      lastCenter = rowY;
      rowY += PAPER_LAYOUT.rowStep;
    });
    stage.effectiveRows = rows.length;

    const unplaced = stageRefs.filter(
      (ref) => dag.nodes.get(ref)?.kind === "operator" && !configured.has(ref),
    );
    if (unplaced.length) {
      diagnostics.push(`${stageId}: ${unplaced.length} unplaced operator(s): ${unplaced.join(", ")}`);
      let fallbackY = lastCenter + 106;
      unplaced.forEach((ref, index) => {
        placeRow(nodeBoxes, dag, presentation, stage, { slots: [ref] }, fallbackY, `fallback-${index}`);
        fallbackY += PAPER_LAYOUT.rowStep;
      });
      lastCenter = fallbackY - PAPER_LAYOUT.rowStep;
    }

    const outputs = stageRefs.filter((ref) => dag.nodes.get(ref)?.kind === "output");
    placeBoundary(
      nodeBoxes,
      dag,
      presentation,
      stage,
      outputs,
      lastCenter + PAPER_LAYOUT.outputGap,
      "output",
    );
    const stageNodeBoxes = stageRefs
      .map((ref) => nodeBoxes.get(ref))
      .filter((box): box is NodeBox => box !== undefined);
    const bottom = Math.max(160, ...stageNodeBoxes.map((box) => box.y + box.height));
    stage.height = bottom + PAPER_LAYOUT.stageBottomPadding;
    stageBoxes.push(stage);
  });

  const scopeBoxes = dag.scopes
    .filter((scope) => scope.kind !== "component" && scope.kind !== "module")
    .map((scope) => scopeBounds(scope.id, scope.nodeRefs, nodeBoxes, scope.kind === "denoise" ? 8 : 4))
    .filter((box): box is ScopeBox => box !== null);

  return {
    width: PAPER_LAYOUT.width,
    height: Math.max(170, ...stageBoxes.map((stage) => stage.height)) + 10,
    nodeBoxes,
    stageBoxes,
    scopeBoxes,
    diagnostics: [...dag.diagnostics, ...diagnostics],
  };
}
