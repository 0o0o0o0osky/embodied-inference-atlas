export interface ComputeAllocation {
  flop: number;
  ceilingFlopPerSecond: number;
}

export interface LinearShape {
  m: number;
  k: number;
  n: number;
  calls: number;
}

export interface DerivedRoofline {
  totalFlop: number;
  totalByte: number;
  arithmeticIntensity: number;
  computeSecond: number;
  memorySecond: number;
  roofSecond: number;
  roofFlopPerSecond: number;
  limiter: "compute" | "memory" | "tie";
}

const TIE_EPSILON = 1e-9;

function finiteNonnegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and nonnegative`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be finite and positive`);
  return value;
}

export function mixedComputeSecond(allocations: readonly ComputeAllocation[]): number {
  return allocations.reduce(
    (total, allocation) => total
      + finiteNonnegative(allocation.flop, "flop") / positive(allocation.ceilingFlopPerSecond, "compute ceiling"),
    0,
  );
}

export function deriveRoofline(
  allocations: readonly ComputeAllocation[],
  totalByte: number,
  bandwidthBytePerSecond: number,
): DerivedRoofline {
  const totalFlop = allocations.reduce((sum, item) => sum + finiteNonnegative(item.flop, "flop"), 0);
  const traffic = positive(totalByte, "traffic");
  const computeSecond = mixedComputeSecond(allocations);
  const memorySecond = traffic / positive(bandwidthBytePerSecond, "bandwidth ceiling");
  const roofSecond = Math.max(computeSecond, memorySecond);
  const scale = Math.max(computeSecond, memorySecond, Number.MIN_VALUE);
  const limiter = Math.abs(computeSecond - memorySecond) <= TIE_EPSILON * scale
    ? "tie"
    : computeSecond > memorySecond ? "compute" : "memory";
  return {
    totalFlop,
    totalByte: traffic,
    arithmeticIntensity: totalFlop / traffic,
    computeSecond,
    memorySecond,
    roofSecond,
    roofFlopPerSecond: totalFlop / roofSecond,
    limiter,
  };
}

export function linearAtomicPoint(
  shape: LinearShape,
  bytesPerValue: number,
  computeCeilingFlopPerSecond: number,
  bandwidthBytePerSecond: number,
): DerivedRoofline {
  const values = [shape.m, shape.k, shape.n, shape.calls];
  if (values.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error("linear dimensions and calls must be positive safe integers");
  }
  positive(bytesPerValue, "bytes per value");
  const totalFlop = 2 * shape.m * shape.k * shape.n * shape.calls;
  const totalByte = (shape.m * shape.k + shape.k * shape.n + shape.m * shape.n)
    * bytesPerValue * shape.calls;
  return deriveRoofline(
    [{ flop: totalFlop, ceilingFlopPerSecond: computeCeilingFlopPerSecond }],
    totalByte,
    bandwidthBytePerSecond,
  );
}
