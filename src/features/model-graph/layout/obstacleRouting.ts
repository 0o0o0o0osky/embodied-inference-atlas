import type { LogicalLayout, NodeBox } from "../domain/types";

type Point = readonly [number, number];

function crosses(a: Point, b: Point, box: NodeBox): boolean {
  const epsilon = 0.1;
  const left = box.x + epsilon, right = box.x + box.width - epsilon;
  const top = box.y + epsilon, bottom = box.y + box.height - epsilon;
  return a[0] === b[0]
    ? a[0] > left && a[0] < right && Math.max(a[1], b[1]) > top && Math.min(a[1], b[1]) < bottom
    : a[1] === b[1] && a[1] > top && a[1] < bottom && Math.max(a[0], b[0]) > left && Math.min(a[0], b[0]) < right;
}

/** Authored orthogonal paths use only absolute M/H/V segments. */
export function pathCrossesNodes(path: string, boxes: readonly NodeBox[]): boolean {
  let previous: Point = [0, 0];
  for (const part of path.match(/[MHV][^MHV]*/g) ?? []) {
    const values = part.slice(1).trim().split(/\s+/).map(Number);
    const next: Point = part[0] === "H" ? [values[0]!, previous[1]]
      : part[0] === "V" ? [previous[0], values[0]!] : [values[0]!, values[1]!];
    if (part[0] !== "M" && boxes.some(box => crosses(previous, next, box))) return true;
    previous = next;
  }
  return false;
}

function anchors(box: NodeBox, source: boolean): readonly Point[] {
  const midX = box.x + box.width / 2, midY = box.y + box.height / 2;
  return source
    ? [[midX, box.y + box.height], [box.x + box.width, midY], [box.x, midY], [midX, box.y]]
    : [[midX, box.y], [box.x, midY], [box.x + box.width, midY], [midX, box.y + box.height]];
}

/** Shortest clear one-/two-bend route on node-margin channels; no graph edges are inferred. */
export function routeAroundNodes(source: NodeBox, target: NodeBox, layout: LogicalLayout): string | null {
  const boxes = [...layout.nodeBoxes.values()];
  const xs = [...new Set(boxes.flatMap(box => [box.x - 8, box.x + box.width + 8]))];
  const ys = [...new Set(boxes.flatMap(box => [box.y - 8, box.y + box.height + 8]))];
  const candidates: { points: readonly Point[]; cost: number }[] = [];
  const add = (rawPoints: readonly Point[], sourceSide: number, targetSide: number) => {
    const points = rawPoints.filter((point, index) => index === 0
      || point[0] !== rawPoints[index - 1]![0] || point[1] !== rawPoints[index - 1]![1]);
    if (points.length < 2) return;
    const first = points[0]!, next = points[1]!, last = points[points.length - 1]!, previous = points[points.length - 2]!;
    const direction = (a: Point, b: Point, side: number) => side === 0
      ? a[0] === b[0] && b[1] > a[1]
      : side === 1 ? a[1] === b[1] && b[0] > a[0]
      : side === 2 ? a[1] === b[1] && b[0] < a[0]
      : a[0] === b[0] && b[1] < a[1];
    // Enter perpendicular to the selected node edge: a horizontal arrival at
    // its top midpoint would display a sideways arrow, despite clearing boxes.
    if (!direction(first, next, sourceSide) || !direction(previous, last, targetSide)) return;
    const preference = (sourceSide + targetSide) * 8;
    const length = points.slice(1).reduce((sum, point, i) => sum + Math.abs(point[0] - points[i]![0]) + Math.abs(point[1] - points[i]![1]), 0);
    candidates.push({ points, cost: length + preference });
  };
  anchors(source, true).forEach((a, sourceSide) => anchors(target, false).forEach((b, targetSide) => {
    add([a, [a[0], b[1]], b], sourceSide, targetSide);
    add([a, [b[0], a[1]], b], sourceSide, targetSide);
    xs.forEach(x => add([a, [x, a[1]], [x, b[1]], b], sourceSide, targetSide));
    ys.forEach(y => add([a, [a[0], y], [b[0], y], b], sourceSide, targetSide));
  }));
  candidates.sort((a, b) => a.cost - b.cost);
  const clear = candidates.find(({ points }) => points.slice(1).every((b, index) =>
    !boxes.some(box => crosses(points[index]!, b, box))));
  if (!clear) return null;
  return clear.points.map((point, index) => index === 0 ? `M ${point[0]} ${point[1]}`
    : point[0] === clear.points[index - 1]![0] ? `V ${point[1]}` : `H ${point[0]}`).join(" ");
}
