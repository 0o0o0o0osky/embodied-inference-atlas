import type { RooflineCurveVM, RooflinePointVM } from "./viewModel";

export interface LogDomain { min: number; max: number }
export interface PlotBox { left: number; top: number; width: number; height: number }

export interface RooflineChartGeometry {
  x: LogDomain;
  y: LogDomain;
  xTicks: readonly number[];
  yTicks: readonly number[];
}

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
