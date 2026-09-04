import type { KeyboardEvent } from "react";

import type { LogicalLayout, NodeBox } from "../../model-graph/domain/types";
import { indexRuntimeRealization } from "../domain/indexRuntimeRealization";
import type { PrecisionPath, RuntimeOverlayModel, RuntimeRealizationRecord } from "../domain/types";

interface RuntimeOverlayProps {
  layout: LogicalLayout;
  realization: RuntimeRealizationRecord;
  overlay: RuntimeOverlayModel;
  onSelectGroup: (groupId: string) => void;
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

export function RuntimeOverlay({ layout, realization, overlay, onSelectGroup }: RuntimeOverlayProps) {
  const index = indexRuntimeRealization(realization);
  const occupied: LabelBox[] = [
    ...[...layout.nodeBoxes.values()].map((box) => ({
      x: box.x - NODE_CLEARANCE,
      y: box.y - NODE_CLEARANCE,
      width: box.width + NODE_CLEARANCE * 2,
      height: box.height + NODE_CLEARANCE * 2,
    })),
    ...layout.scopeBoxes.map((box) => ({ x: box.x, y: box.y, width: box.width, height: box.headerHeight + 3 })),
  ];
  const labelledGroups = new Set<string>();
  const boundaryLabels = overlay.boundaries.flatMap((boundary) => {
    if (labelledGroups.has(boundary.groupId)) return [];
    labelledGroups.add(boundary.groupId);
    const group = index.groupById.get(boundary.groupId);
    const precision = index.precisionById.get(boundary.precisionPathId);
    const labels = [...new Set([
      `Fused · ${precisionMark(precision)}`,
      `Fused · ${shortPrecisionMark(precision)}`,
    ])];
    for (const label of labels) {
      const width = Math.max(106, label.length * 8.1 + 18);
      const box = placeRuntimeLabel(boundary.box, width, layout, occupied, true);
      if (box) return [{ boundary, group, label, box }];
    }
    return [];
  });
  const positionedBadges = [...overlay.badgesByNode].flatMap(([ref, badges]) => {
    const anchor = layout.nodeBoxes.get(ref);
    if (!anchor) return [];
    return badges.flatMap((badge) => {
      const group = badge.groupId ? index.groupById.get(badge.groupId) : undefined;
      const label = badge.kind === "precision" && group
        ? precisionMark(index.precisionById.get(group.precisionPathId))
        : badge.label;
      const precision = group ? index.precisionById.get(group.precisionPathId) : undefined;
      const labels = badge.kind === "precision" ? [...new Set([label, shortPrecisionMark(precision)])] : [label];
      for (const candidateLabel of labels) {
        const width = Math.max(48, candidateLabel.length * 8.2 + 16);
        const box = placeRuntimeLabel(anchor, width, layout, occupied);
        if (box) return [{ ref, badge, group, label: candidateLabel, box }];
      }
      return [];
    });
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
          aria-label={`Inspect fused execution group ${group?.label ?? boundary.groupId}`}
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
              aria-label={action ? `Inspect ${group?.label ?? badge.groupId}` : label}
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
