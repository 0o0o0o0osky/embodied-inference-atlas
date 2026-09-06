import type { RooflineBasisRecord, RooflinePointRecord } from "../domain/types";

interface ComparisonInput {
  workFlop: number; trafficByte: number;
  computeSecond: number | null; memorySecond: number | null; roofSecond: number | null;
  observedSecond: number | null;
  timeBasis: RooflineBasisRecord["time_basis"];
  trafficKind: RooflinePointRecord["traffic"]["value_kind"];
  efficiency: number | null;
}

const positive = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0;

/** Both points deliberately use the SAME work and traffic accounting. */
export function compareRooflinePoint(input: ComparisonInput) {
  const { workFlop, trafficByte, computeSecond, memorySecond, roofSecond, observedSecond } = input;
  if (![workFlop, trafficByte, computeSecond, memorySecond, roofSecond].every(positive)) return null;
  // A dependency-constrained aggregate is not a two-resource kernel roof.
  if (Math.abs(roofSecond! - Math.max(computeSecond!, memorySecond!)) > roofSecond! * 1e-6) return null;
  const ordinaryTiming = input.timeBasis === "cuda_event" || input.timeBasis === "wall_clock" || input.timeBasis === "nsys_interval";
  const actual = ordinaryTiming && positive(observedSecond);
  return {
    intensity: workFlop / trafficByte,
    theoryRate: workFlop / roofSecond!,
    actualRate: actual ? workFlop / observedSecond : null,
    // A null canonical efficiency denotes an unresolved comparison prerequisite (e.g. clocks).
    efficiency: actual && input.efficiency !== null ? roofSecond! / observedSecond : null,
    computeRate: workFlop / computeSecond!,
    bandwidthRate: trafficByte / memorySecond!,
    limiter: computeSecond! > memorySecond! ? "compute" : computeSecond! < memorySecond! ? "memory" : "tie",
    trafficKind: input.trafficKind,
  };
}
