import { expect, it } from "vitest";
import { compareRooflinePoint } from "./rooflineComparison";

const input = {
  workFlop: 2000, trafficByte: 100, computeSecond: 2, memorySecond: 1, roofSecond: 2,
  observedSecond: 8, timeBasis: "cuda_event" as const, trafficKind: "modeled" as const,
  efficiency: 0.25,
};

it("pairs the same arithmetic intensity and derives throughput from the matching timing", () => {
  expect(compareRooflinePoint(input)).toMatchObject({
    intensity: 20, theoryRate: 1000, actualRate: 250, efficiency: 0.25,
    computeRate: 1000, bandwidthRate: 100, limiter: "compute",
  });
});

it("keeps theory without inventing missing timing or treating NCU replay as ordinary execution", () => {
  expect(compareRooflinePoint({ ...input, observedSecond: null })).toMatchObject({ theoryRate: 1000, actualRate: null, efficiency: null });
  expect(compareRooflinePoint({ ...input, timeBasis: "ncu_kernel" })).toMatchObject({ theoryRate: 1000, actualRate: null, efficiency: null });
  expect(compareRooflinePoint({ ...input, efficiency: null })).toMatchObject({ actualRate: 250, efficiency: null });
});
