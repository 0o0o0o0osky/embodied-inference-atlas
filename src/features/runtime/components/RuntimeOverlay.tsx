import type { KeyboardEvent } from "react";

import type { LogicalLayout, NodeBox, RoutedPath } from "../../model-graph/domain/types";
import { indexRuntimeRealization } from "../domain/indexRuntimeRealization";
import type { PrecisionPath, RuntimeBadge, RuntimeOverlayModel, RuntimeRealizationRecord } from "../domain/types";
import { pi0GroupLabel, pi0RelationLabel, pi0ShortPrecisionLabel } from "./runtimePresentation";

interface RuntimeOverlayProps {
  layout: LogicalLayout;
  realization: RuntimeRealizationRecord;
  overlay: RuntimeOverlayModel;
  onSelectGroup: (groupId: string) => void;
  pi0?: boolean;
  avoidPaths?: readonly Pick<RoutedPath, "path" | "arrow">[];
}

function precisionMark(precision: PrecisionPath | undefined) {
  if (!precision) return "precision unknown";
  const values = [precision.weightDtype, precision.activationDtype, precision.accumulationDtype]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replaceAll("_", " ").toUpperCase());
  return [...new Set(values)].join("/") || precision.label;
}

function activate(event: KeyboardEvent<SVGGElement>, action: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}

export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const LABEL_GAP = 10;
const NODE_CLEARANCE = 8;

const SHORT_PRECISION_LABELS: Readonly<Record<string, string>> = {
  "mixed-bf16-fp32": "BF16/FP32",
  "mixed-fp8-e4m3-fp16": "FP8/FP16",
  "q8_0-weight-only": "Q8_0 wt/FP16",
  "uniform-fp16": "FP16",
  "flashrt-fp16-control": "FP16 ctrl",
  "flashrt-pi05-fp16-control": "FP16 ctrl",
  "lerobot-fp32-attention-control": "FP32 ctrl",
};

function shortPrecisionMark(precision: PrecisionPath | undefined) {
  if (!precision) return "precision";
  return SHORT_PRECISION_LABELS[precision.precisionPathId] ?? precision.label;
}

function intersects(first: LabelBox, second: LabelBox) {
  return !(
    first.x + first.width <= second.x || second.x + second.width <= first.x ||
    first.y + first.height <= second.y || second.y + second.height <= first.y
  );
}

function pi0LabelWidth(label: string, minimum: number) {
  const textWidth = [...label].reduce((width, character) => (
    width + (character.codePointAt(0)! > 0xff ? 12 : 6.5)
  ), 0);
  return Math.max(minimum, textWidth + 16);
}

function pathClearanceBoxes(paths: readonly Pick<RoutedPath, "path" | "arrow">[]): LabelBox[] {
  return paths.flatMap(({ path, arrow }) => {
    const tokens = path.match(/[MHV]|-?\d+(?:\.\d+)?/g) ?? [];
    const boxes: LabelBox[] = [];
    let x = 0;
    let y = 0;
    let index = 0;
    while (index < tokens.length) {
      const command = tokens[index++];
      if (command === "M") {
        x = Number(tokens[index++]);
        y = Number(tokens[index++]);
      } else if (command === "H") {
        const nextX = Number(tokens[index++]);
        boxes.push({ x: Math.min(x, nextX) - 3, y: y - 3, width: Math.abs(nextX - x) + 6, height: 6 });
        x = nextX;
      } else if (command === "V") {
        const nextY = Number(tokens[index++]);
        boxes.push({ x: x - 3, y: Math.min(y, nextY) - 3, width: 6, height: Math.abs(nextY - y) + 6 });
        y = nextY;
      }
    }
    if (arrow) boxes.push({ x: x - 10, y: y - 10, width: 20, height: 20 });
    return boxes;
  });
}

export function placeRuntimeLabel(
  anchor: Pick<NodeBox, "x" | "y" | "width" | "height">,
  width: number,
  layout: LogicalLayout,
  occupied: LabelBox[],
  preferLeft = false,
) {
  const height = 20;
  const clamp = (candidate: LabelBox): LabelBox => ({
    ...candidate,
    x: Math.min(Math.max(4, candidate.x), Math.max(4, layout.width - width - 4)),
    y: Math.min(Math.max(2, candidate.y), Math.max(2, layout.height - height - 2)),
  });
  const right = { x: anchor.x + anchor.width + LABEL_GAP, y: anchor.y + (anchor.height - height) / 2, width, height };
  const left = { x: anchor.x - width - LABEL_GAP, y: anchor.y + (anchor.height - height) / 2, width, height };
  const above = { x: anchor.x + (anchor.width - width) / 2, y: anchor.y - height - LABEL_GAP, width, height };
  const below = { x: anchor.x + (anchor.width - width) / 2, y: anchor.y + anchor.height + LABEL_GAP, width, height };
  const rightAbove = { x: right.x, y: above.y, width, height };
  const leftAbove = { x: left.x, y: above.y, width, height };
  const rightBelow = { x: right.x, y: below.y, width, height };
  const leftBelow = { x: left.x, y: below.y, width, height };
  const rowStep = height + LABEL_GAP;
  const candidates = (preferLeft
    ? [
        left, leftAbove, leftBelow,
        { ...leftAbove, y: leftAbove.y - rowStep },
        { ...leftBelow, y: leftBelow.y + rowStep },
      ]
    : [
        right, left, above, below, rightAbove, leftAbove, rightBelow, leftBelow,
        { ...rightAbove, y: rightAbove.y - rowStep },
        { ...leftAbove, y: leftAbove.y - rowStep },
        { ...rightBelow, y: rightBelow.y + rowStep },
        { ...leftBelow, y: leftBelow.y + rowStep },
      ]).map(clamp);
  const placed = candidates.find((candidate) => occupied.every((box) => !intersects(candidate, box))) ?? null;
  if (placed) occupied.push(placed);
  return placed;
}

function placePi0BoundaryLabel(
  anchor: Pick<NodeBox, "x" | "y" | "width" | "height">,
  width: number,
  layout: LogicalLayout,
  occupied: LabelBox[],
) {
  const stage = layout.stageBoxes.find((box) => {
    const center = anchor.x + anchor.width / 2;
    return center >= box.x && center <= box.x + box.width;
  });
  if (!stage) return placeRuntimeLabel(anchor, width, layout, occupied);
  const height = 20;
  const left = stage.x + 12;
  const right = stage.x + stage.width - width - 12;
  const center = Math.min(right, Math.max(left, anchor.x + (anchor.width - width) / 2));
  const middleY = anchor.y + (anchor.height - height) / 2;
  const above = anchor.y - height - LABEL_GAP;
  const below = anchor.y + anchor.height + LABEL_GAP;
  const candidates: LabelBox[] = [
    { x: left, y: middleY, width, height },
    { x: right, y: middleY, width, height },
    { x: left, y: above, width, height },
    { x: right, y: above, width, height },
    { x: left, y: below, width, height },
    { x: right, y: below, width, height },
    ...[0, 1, 2].flatMap((step) => [
      { x: center, y: above - step * (height + LABEL_GAP), width, height },
      { x: center, y: below + step * (height + LABEL_GAP), width, height },
    ]),
  ].map((candidate) => ({
    ...candidate,
    x: Math.min(right, Math.max(left, candidate.x)),
    y: Math.min(stage.y + stage.height - height - 4, Math.max(stage.y + 4, candidate.y)),
  }));
  const placed = candidates.find((candidate) => occupied.every((box) => !intersects(candidate, box))) ?? null;
  if (placed) occupied.push(placed);
  return placed;
}

function placePi0BadgeLabel(
  anchor: Pick<NodeBox, "x" | "y" | "width" | "height">,
  width: number,
  layout: LogicalLayout,
  occupied: LabelBox[],
) {
  const height = 20;
  const clamp = (candidate: LabelBox): LabelBox => ({
    ...candidate,
    x: Math.min(Math.max(4, candidate.x), Math.max(4, layout.width - width - 4)),
    y: Math.min(Math.max(2, candidate.y), Math.max(2, layout.height - height - 2)),
  });
  const right = anchor.x + anchor.width + LABEL_GAP;
  const left = anchor.x - width - LABEL_GAP;
  const middleY = anchor.y + (anchor.height - height) / 2;
  const above = anchor.y - height - LABEL_GAP;
  const below = anchor.y + anchor.height + LABEL_GAP;
  const candidates = [
    { x: right, y: middleY, width, height },
    { x: left, y: middleY, width, height },
    { x: right, y: above, width, height },
    { x: left, y: above, width, height },
    { x: right, y: below, width, height },
    { x: left, y: below, width, height },
    { x: anchor.x + (anchor.width - width) / 2, y: above, width, height },
    { x: anchor.x + (anchor.width - width) / 2, y: below, width, height },
  ].map(clamp);
  const placed = candidates.find((candidate) => occupied.every((box) => !intersects(candidate, box))) ?? null;
  if (placed) occupied.push(placed);
  return placed;
}

export function RuntimeOverlay({
  layout,
  realization,
  overlay,
  onSelectGroup,
  pi0 = false,
  avoidPaths = [],
}: RuntimeOverlayProps) {
  const index = indexRuntimeRealization(realization);
  const occupied: LabelBox[] = [
    ...[...layout.nodeBoxes.values()].map((box) => ({
      x: box.x - NODE_CLEARANCE,
      y: box.y - NODE_CLEARANCE,
      width: box.width + NODE_CLEARANCE * 2,
      height: box.height + NODE_CLEARANCE * 2,
    })),
    ...layout.scopeBoxes.map((box) => ({ x: box.x, y: box.y, width: box.width, height: box.headerHeight + 3 })),
    ...(pi0 ? layout.stageBoxes.flatMap((box) => [
      { x: box.x - 4, y: box.y, width: 8, height: box.height },
      { x: box.x + box.width - 4, y: box.y, width: 8, height: box.height },
    ]) : []),
    ...(pi0 ? pathClearanceBoxes(avoidPaths) : []),
  ];
  const labelledGroups = new Set<string>();
  const boundaryLabels = overlay.boundaries.flatMap((boundary) => {
    if (labelledGroups.has(boundary.groupId)) return [];
    if (!pi0) labelledGroups.add(boundary.groupId);
    const group = index.groupById.get(boundary.groupId);
    const precision = index.precisionById.get(boundary.precisionPathId);
    const labels = pi0
      ? [`${pi0RelationLabel(boundary.relation)} · ${pi0ShortPrecisionLabel(precision?.precisionPathId ?? "", precision?.label ?? "精度未建立")}`]
      : [...new Set([
          `Fused · ${precisionMark(precision)}`,
          `Fused · ${shortPrecisionMark(precision)}`,
    ])];
    for (const label of labels) {
      const width = pi0
        ? pi0LabelWidth(label, 92)
        : Math.max(106, label.length * 8.1 + 18);
      const box = pi0
        ? placePi0BoundaryLabel(boundary.box, width, layout, occupied)
        : placeRuntimeLabel(boundary.box, width, layout, occupied, true);
      if (box) {
        labelledGroups.add(boundary.groupId);
        return [{ boundary, group, label, box }];
      }
    }
    return [];
  });
  const compactBadgeEntries: Array<{ ref: string; badge: RuntimeBadge }> = [];
  if (pi0) {
    const compactGroups = new Set(labelledGroups);
    const eliminatedMappings = new Set<string>();
    [...overlay.badgesByNode].forEach(([ref, badges]) => {
      badges.filter((badge) => badge.kind === "eliminated").forEach((badge) => {
        const key = badge.mappingId ?? `${ref}/eliminated`;
        if (eliminatedMappings.has(key)) return;
        eliminatedMappings.add(key);
        compactBadgeEntries.push({ ref, badge: { ...badge, label: "已消除" } });
      });
      const byGroup = new Map<string, RuntimeBadge[]>();
      badges.filter((badge) => badge.groupId).forEach((badge) => {
        const values = byGroup.get(badge.groupId!) ?? [];
        values.push(badge);
        byGroup.set(badge.groupId!, values);
      });
      byGroup.forEach((groupBadges, groupId) => {
        if (compactGroups.has(groupId)) return;
        const chosen = groupBadges.find((badge) => badge.kind === "preserved")
          ?? groupBadges.find((badge) => badge.kind === "split")
          ?? groupBadges.find((badge) => badge.kind === "opaque")
          ?? groupBadges.find((badge) => badge.kind === "fallback")
          ?? groupBadges.find((badge) => badge.kind === "ambiguous")
          ?? groupBadges[0];
        if (!chosen) return;
        const label = chosen.kind === "preserved" ? "保留"
          : chosen.kind === "split" ? "拆分"
          : chosen.kind === "opaque" ? "不透明"
          : chosen.kind === "fallback" ? "备用路径"
          : chosen.kind === "ambiguous" ? "映射有歧义"
          : "保留";
        compactGroups.add(groupId);
        compactBadgeEntries.push({ ref, badge: { ...chosen, label } });
      });
    });
  }
  const badgeEntries = pi0
    ? compactBadgeEntries
    : [...overlay.badgesByNode].flatMap(([ref, badges]) => badges.map((badge) => ({ ref, badge })));
  const positionedBadges = badgeEntries.flatMap(({ ref, badge }) => {
    const anchor = layout.nodeBoxes.get(ref);
    if (!anchor) return [];
    const group = badge.groupId ? index.groupById.get(badge.groupId) : undefined;
    const label = !pi0 && badge.kind === "precision" && group
        ? precisionMark(index.precisionById.get(group.precisionPathId))
        : badge.label;
    const precision = group ? index.precisionById.get(group.precisionPathId) : undefined;
    const labels = !pi0 && badge.kind === "precision" ? [...new Set([label, shortPrecisionMark(precision)])] : [label];
    for (const candidateLabel of labels) {
      const width = pi0
        ? pi0LabelWidth(candidateLabel, 42)
        : Math.max(48, candidateLabel.length * 8.2 + 16);
      const box = pi0
        ? placePi0BadgeLabel(anchor, width, layout, occupied)
        : placeRuntimeLabel(anchor, width, layout, occupied);
      if (box) return [{ ref, badge, group, label: candidateLabel, box }];
    }
    return [];
  });
  return (
    <g className="runtime-overlay" data-runtime-realization={realization.realizationId}>
      {overlay.boundaries.map((boundary) => {
        const selected = overlay.highlightedGroupIds.has(boundary.groupId);
        return (
          <g
            key={boundary.fragmentId}
            className={["runtime-boundary", selected ? "is-selected" : ""].filter(Boolean).join(" ")}
          >
            <rect
              className="runtime-boundary-frame"
              x={boundary.box.x}
              y={boundary.box.y}
              width={boundary.box.width}
              height={boundary.box.height}
              rx={10}
            />
          </g>
        );
      })}

      {boundaryLabels.map(({ boundary, group, label, box }) => (
        <g
          key={`${boundary.groupId}/label`}
          className="runtime-boundary-label"
          role="button"
          tabIndex={0}
          aria-label={pi0
            ? `查看融合执行组：${group ? pi0GroupLabel(group.label) : boundary.groupId}`
            : `Inspect fused execution group ${group?.label ?? boundary.groupId}`}
          onClick={() => onSelectGroup(boundary.groupId)}
          onKeyDown={(event) => activate(event, () => onSelectGroup(boundary.groupId))}
        >
          <rect x={box.x} y={box.y} width={box.width} height={box.height} rx={2} />
          <text x={box.x + 8} y={box.y + 16}>{label}</text>
        </g>
      ))}

      {positionedBadges.map(({ ref, badge, group, label, box }, badgeIndex) => {
          const selected = badge.groupId ? overlay.highlightedGroupIds.has(badge.groupId) : false;
          const action = badge.groupId ? () => onSelectGroup(badge.groupId!) : null;
          return (
            <g
              key={`${ref}/${badge.kind}/${badge.mappingId ?? badgeIndex}/${badge.groupId ?? "none"}`}
              className={[
                "runtime-badge",
                `runtime-badge--${badge.kind}`,
                selected ? "is-selected" : "",
              ].filter(Boolean).join(" ")}
              role={action ? "button" : undefined}
              tabIndex={action ? 0 : undefined}
              aria-label={action
                ? pi0 ? `查看执行组：${group ? pi0GroupLabel(group.label) : badge.groupId}` : `Inspect ${group?.label ?? badge.groupId}`
                : label}
              onClick={action ?? undefined}
              onKeyDown={action ? (event) => activate(event, action) : undefined}
            >
              <rect x={box.x} y={box.y} width={box.width} height={box.height} rx={2} />
              <text x={box.x + 8} y={box.y + 16}>{label}</text>
            </g>
          );
      })}

      {[...overlay.badgesByNode].flatMap(([ref, badges]) => {
        if (!badges.some((badge) => badge.kind === "eliminated")) return [];
        const box = layout.nodeBoxes.get(ref);
        return box ? [(
          <g className="runtime-eliminated-mark" key={`${ref}/eliminated`} aria-hidden="true">
            <rect x={box.x - 3} y={box.y - 3} width={box.width + 6} height={box.height + 6} rx={8} />
            <path d={`M ${box.x - 2} ${box.y + box.height + 2} L ${box.x + box.width + 2} ${box.y - 2}`} />
          </g>
        )] : [];
      })}
    </g>
  );
}
