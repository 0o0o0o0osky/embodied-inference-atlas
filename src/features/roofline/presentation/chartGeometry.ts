import type { RooflineCurveVM, RooflinePointVM } from "./viewModel";

export interface LogDomain { min: number; max: number }
export interface PlotBox { left: number; top: number; width: number; height: number }
export interface ScreenPoint { x: number; y: number }
interface ScreenBox extends ScreenPoint { width: number; height: number }
export interface ClusterScreenAnchor extends ScreenPoint {
  key: string;
  count: number;
  coreRadius?: number;
  cellPolygon?: readonly ScreenPoint[];
}
export interface ClusterCountPlacement extends ScreenBox {
  key: string;
  label: string;
  leaderStartX: number;
  leaderStartY: number;
  leaderEndX: number;
  leaderEndY: number;
}

export interface RooflineChartGeometry {
  x: LogDomain;
  y: LogDomain;
  xTicks: readonly number[];
  yTicks: readonly number[];
}

const COUNT_LABEL_OFFSETS = [
  [0, -30], [30, 0], [0, 30], [-30, 0],
  [24, -24], [24, 24], [-24, 24], [-24, -24],
  [0, -48], [48, 0], [0, 48], [-48, 0],
  [36, -48], [48, -36], [48, 36], [36, 48],
  [-36, 48], [-48, 36], [-48, -36], [-36, -48],
  [0, -72], [72, 0], [0, 72], [-72, 0],
  [24, 72], [-24, -72],
] as const;
const MIN_LOCAL_CONTROL_DIAMETER = 10;

function positive(values: readonly number[]) {
  return values.filter((value) => Number.isFinite(value) && value > 0);
}

export function decadeDomain(values: readonly number[], fallback: LogDomain): LogDomain {
  const clean = positive(values);
  if (!clean.length) return fallback;
  let low = Math.floor(Math.log10(Math.min(...clean)));
  let high = Math.ceil(Math.log10(Math.max(...clean)));
  if (low === high) high += 1;
  return { min: 10 ** low, max: 10 ** high };
}

export function decadeTicks(domain: LogDomain): number[] {
  const low = Math.round(Math.log10(domain.min));
  const high = Math.round(Math.log10(domain.max));
  return Array.from({ length: high - low + 1 }, (_, index) => 10 ** (low + index));
}

export function chartGeometry(
  points: readonly RooflinePointVM[],
  curves: readonly RooflineCurveVM[],
): RooflineChartGeometry {
  const x = decadeDomain(
    [...points.map((point) => point.xFlopPerByte), ...curves.map((curve) => curve.ridgeFlopPerByte)],
    { min: 1, max: 1e4 },
  );
  const y = decadeDomain([
    ...points.map((point) => point.yFlopPerSecond),
    ...curves.flatMap((curve) => [curve.computeFlopPerSecond, curve.bandwidthBytePerSecond * x.min]),
  ], { min: 1e9, max: 1e15 });
  return { x, y, xTicks: decadeTicks(x), yTicks: decadeTicks(y) };
}

export function logX(value: number, domain: LogDomain, box: PlotBox) {
  if (!Number.isFinite(value) || value <= 0) throw new Error("log X requires a finite positive value");
  return box.left + Math.log10(value / domain.min) / Math.log10(domain.max / domain.min) * box.width;
}

export function logY(value: number, domain: LogDomain, box: PlotBox) {
  if (!Number.isFinite(value) || value <= 0) throw new Error("log Y requires a finite positive value");
  return box.top + Math.log10(domain.max / value) / Math.log10(domain.max / domain.min) * box.height;
}

export function roofPath(curve: RooflineCurveVM, x: LogDomain, y: LogDomain, box: PlotBox) {
  const ridge = Math.min(x.max, Math.max(x.min, curve.ridgeFlopPerByte));
  const atLow = Math.min(curve.computeFlopPerSecond, curve.bandwidthBytePerSecond * x.min);
  return `M ${logX(x.min, x, box)} ${logY(atLow, y, box)} L ${logX(ridge, x, box)} ${logY(Math.min(curve.computeFlopPerSecond, curve.bandwidthBytePerSecond * ridge), y, box)} L ${logX(x.max, x, box)} ${logY(curve.computeFlopPerSecond, y, box)}`;
}

export function markerRadius(areaPx2: number) {
  if (!Number.isFinite(areaPx2) || areaPx2 <= 0) throw new Error("marker area must be positive");
  return Math.sqrt(areaPx2 / Math.PI);
}

function clipHalfPlane(polygon: readonly ScreenPoint[], unitX: number, unitY: number, limit: number) {
  if (!polygon.length) return [];
  const result: ScreenPoint[] = [];
  polygon.forEach((current, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length]!;
    const currentDistance = current.x * unitX + current.y * unitY - limit;
    const previousDistance = previous.x * unitX + previous.y * unitY - limit;
    const currentInside = currentDistance <= 1e-7;
    const previousInside = previousDistance <= 1e-7;
    if (currentInside !== previousInside) {
      const ratio = previousDistance / (previousDistance - currentDistance);
      result.push({
        x: previous.x + (current.x - previous.x) * ratio,
        y: previous.y + (current.y - previous.y) * ratio,
      });
    }
    if (currentInside) result.push(current);
  });
  return result;
}

export function localVoronoiCell(
  centers: readonly ScreenPoint[],
  index: number,
  box: PlotBox,
  proximity = 18,
) {
  const current = centers[index]!;
  let polygon: ScreenPoint[] = [
    { x: Math.max(box.left, current.x - proximity), y: Math.max(box.top, current.y - proximity) },
    { x: Math.min(box.left + box.width, current.x + proximity), y: Math.max(box.top, current.y - proximity) },
    { x: Math.min(box.left + box.width, current.x + proximity), y: Math.min(box.top + box.height, current.y + proximity) },
    { x: Math.max(box.left, current.x - proximity), y: Math.min(box.top + box.height, current.y + proximity) },
  ];
  centers.forEach((neighbor, neighborIndex) => {
    if (neighborIndex === index || !polygon.length) return;
    const deltaX = neighbor.x - current.x;
    const deltaY = neighbor.y - current.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= Number.EPSILON) return;
    const unitX = deltaX / distance;
    const unitY = deltaY / distance;
    const gutter = Math.min(0.5, distance / 4);
    const middleX = (current.x + neighbor.x) / 2;
    const middleY = (current.y + neighbor.y) / 2;
    polygon = clipHalfPlane(
      polygon,
      unitX,
      unitY,
      middleX * unitX + middleY * unitY - gutter / 2,
    );
  });
  return polygon;
}

export function svgPolygonPath(polygon: readonly ScreenPoint[], origin: ScreenPoint) {
  return polygon.map((point, index) => `${index ? "L" : "M"}${(point.x - origin.x).toFixed(3)} ${(point.y - origin.y).toFixed(3)}`).join(" ") + " Z";
}

function pointToSegmentDistance(point: ScreenPoint, start: ScreenPoint, end: ScreenPoint) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX ** 2 + deltaY ** 2;
  if (lengthSquared <= Number.EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(0, Math.min(1,
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared,
  ));
  return Math.hypot(point.x - (start.x + ratio * deltaX), point.y - (start.y + ratio * deltaY));
}

export function polygonCenterClearance(polygon: readonly ScreenPoint[], center: ScreenPoint) {
  if (polygon.length < 3) return 0;
  return polygon.reduce((clearance, start, index) => Math.min(
    clearance,
    pointToSegmentDistance(center, start, polygon[(index + 1) % polygon.length]!),
  ), Number.POSITIVE_INFINITY);
}

function boxesIntersect(left: ScreenBox, right: ScreenBox) {
  return Math.abs(left.x - right.x) < (left.width + right.width) / 2 + 2
    && Math.abs(left.y - right.y) < (left.height + right.height) / 2 + 2;
}

function boxIntersectsCore(candidate: ScreenBox, core: ClusterScreenAnchor) {
  const radius = core.coreRadius ?? 0;
  const deltaX = Math.max(0, Math.abs(core.x - candidate.x) - candidate.width / 2);
  const deltaY = Math.max(0, Math.abs(core.y - candidate.y) - candidate.height / 2);
  return Math.hypot(deltaX, deltaY) <= radius;
}

function visibleLeader(anchor: ClusterScreenAnchor, candidate: ScreenBox) {
  const deltaX = candidate.x - anchor.x;
  const deltaY = candidate.y - anchor.y;
  const distance = Math.hypot(deltaX, deltaY);
  const unitX = deltaX / distance;
  const unitY = deltaY / distance;
  const badgeHalfWidth = (candidate.width - 4) / 2;
  const badgeHalfHeight = (candidate.height - 6) / 2;
  const badgeInset = Math.min(
    Math.abs(unitX) > Number.EPSILON ? badgeHalfWidth / Math.abs(unitX) : Number.POSITIVE_INFINITY,
    Math.abs(unitY) > Number.EPSILON ? badgeHalfHeight / Math.abs(unitY) : Number.POSITIVE_INFINITY,
  );
  return {
    leaderStartX: anchor.x + unitX * (anchor.coreRadius ?? 0),
    leaderStartY: anchor.y + unitY * (anchor.coreRadius ?? 0),
    leaderEndX: candidate.x - unitX * badgeInset,
    leaderEndY: candidate.y - unitY * badgeInset,
  };
}

function leaderIntersectsCore(
  leader: ReturnType<typeof visibleLeader>,
  core: ClusterScreenAnchor,
) {
  return pointToSegmentDistance(
    core,
    { x: leader.leaderStartX, y: leader.leaderStartY },
    { x: leader.leaderEndX, y: leader.leaderEndY },
  ) <= (core.coreRadius ?? 0);
}

export function placeClusterCounts(
  anchors: readonly ClusterScreenAnchor[],
  box: PlotBox,
) {
  const placed: ClusterCountPlacement[] = [];
  [...anchors]
    .filter((anchor) => anchor.count > 1 || (
      anchor.cellPolygon
      && polygonCenterClearance(anchor.cellPolygon, anchor) * 2 < MIN_LOCAL_CONTROL_DIAMETER
    ))
    .sort((left, right) => right.count - left.count
      || left.y - right.y
      || left.x - right.x
      || left.key.localeCompare(right.key))
    .forEach((anchor) => {
      const label = anchor.count > 1 ? `×${anchor.count}` : "1 pt";
      const width = Math.max(28, 16 + label.length * 7);
      const height = 26;
      const placement = COUNT_LABEL_OFFSETS.map(([offsetX, offsetY]) => {
        const candidate = {
          key: anchor.key,
          label,
          x: anchor.x + offsetX,
          y: anchor.y + offsetY,
          width,
          height,
        };
        return { ...candidate, ...visibleLeader(anchor, candidate) };
      }).find((candidate) => (
        candidate.x - width / 2 >= box.left + 1
        && candidate.x + width / 2 <= box.left + box.width - 1
        && candidate.y - height / 2 >= box.top + 1
        && candidate.y + height / 2 <= box.top + box.height - 1
        && !placed.some((existing) => boxesIntersect(candidate, existing))
        && !anchors.some((other) => other.key !== anchor.key && (
          boxIntersectsCore(candidate, other)
          || leaderIntersectsCore(candidate, other)
        ))
      ));
      if (placement) placed.push(placement);
    });
  return placed;
}
