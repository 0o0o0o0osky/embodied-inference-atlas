import { describe, expect, it } from "vitest";

import { attentionMetrics } from "./attention";
import { stageLowerBound } from "./criticalPath";
import { linearBoundaryTraffic } from "./fusedTraffic";
import { linearAtomicPoint, mixedComputeSecond } from "./formulas";
import { nvfp4Bytes, q8_0Bytes, w4Group32Bytes } from "./storage";

describe("roofline analytical contracts", () => {
  it("preserves packed tails, resource-aware bounds, and literal model anchors", () => {
    expect(q8_0Bytes(33)).toBe(68);
    expect(nvfp4Bytes(17)).toBe(22);
    expect(w4Group32Bytes(33)).toBe(36);

    expect(mixedComputeSecond([
      { flop: 2e9, ceilingFlopPerSecond: 227.48e12 },
      { flop: 4e9, ceilingFlopPerSecond: 454.96e12 },
    ])).toBeCloseTo(17.583963425356075e-6, 16);

    const first = linearAtomicPoint({ m: 2, k: 3, n: 4, calls: 1 }, 2, 227.48e12, 273e9);
    const second = linearAtomicPoint({ m: 2, k: 4, n: 5, calls: 1 }, 2, 227.48e12, 273e9);
    expect(first.totalFlop + second.totalFlop).toBe(128);
    expect(first.totalByte + second.totalByte).toBe(128);
    expect(linearBoundaryTraffic([
      { tensorRef: "A", byte: 12, role: "input" },
      { tensorRef: "W1", byte: 24, role: "weight" },
      { tensorRef: "X", byte: 16, role: "internal-write" },
      { tensorRef: "X", byte: 16, role: "internal-read" },
      { tensorRef: "W2", byte: 40, role: "weight" },
      { tensorRef: "Y", byte: 20, role: "output" },
    ], [{ tensorRef: "X", evidenceRef: "source-code:fused-linear-pair" }])).toMatchObject({
      totalByte: 96,
      excludedByte: 32,
    });

    expect(stageLowerBound([
      { id: "branch-a", roofSecond: 0.002, computeSecond: 0.001, memorySecond: 0.002 },
      { id: "branch-b", roofSecond: 0.003, computeSecond: 0.002, memorySecond: 0.001 },
      { id: "join", roofSecond: 0.005, computeSecond: 0.003, memorySecond: 0.001 },
    ], [
      { source: "branch-a", target: "join" },
      { source: "branch-b", target: "join" },
    ])).toEqual({
      dependencySecond: 0.008,
      resourceComputeSecond: 0.006,
      resourceMemorySecond: 0.004,
      roofSecond: 0.008,
      limiter: "dependency",
      criticalPath: ["branch-b", "join"],
    });

    const bf16Anchors = [
      { shape: { m: 768, k: 1152, n: 2048, calls: 1 }, flop: 3_623_878_656, byte: 9_633_792, ai: 376.16326530612247, computeUs: 15.930537436258133, roofUs: 35.28861538461538 },
      { shape: { m: 15, k: 32, n: 1024, calls: 10 }, flop: 9_830_400, byte: 972_160, ai: 10.11191573403555, computeUs: 0.04321434851415509, roofUs: 3.561025641025641 },
      { shape: { m: 192, k: 12288, n: 960, calls: 1 }, flop: 4_529_848_320, byte: 28_680_192, ai: 157.94344473007712, computeUs: 19.913171795322665, roofUs: 105.05564835164834 },
    ];
    for (const anchor of bf16Anchors) {
      const point = linearAtomicPoint(anchor.shape, 2, 227.48e12, 273e9);
      expect(point.totalFlop).toBe(anchor.flop);
      expect(point.totalByte).toBe(anchor.byte);
      expect(point.arithmeticIntensity).toBeCloseTo(anchor.ai, 12);
      expect(point.computeSecond * 1e6).toBeCloseTo(anchor.computeUs, 12);
      expect(point.roofSecond * 1e6).toBeCloseTo(anchor.roofUs, 12);
      expect(point.limiter).toBe("memory");
    }

    const attentionAnchors = [
      { input: { batch: 1, queryHeads: 8, kvHeads: 1, queryLength: 816, keyLength: 816, headWidth: 256 }, tensorFlop: 5_454_692_352, softmaxFlop: 15_974_016, scaleFlop: 5_326_848, transcendentalOps: 5_333_376, atomicByte: 50_135_040, fusedByte: 7_520_256 },
      { input: { batch: 1, queryHeads: 8, kvHeads: 1, queryLength: 968, keyLength: 968, headWidth: 256 }, tensorFlop: 7_676_100_608, softmaxFlop: 22_480_832, scaleFlop: 7_496_192, transcendentalOps: 7_503_936, atomicByte: 68_890_624, fusedByte: 8_921_088 },
      { input: { batch: 1, queryHeads: 15, kvHeads: 5, queryLength: 241, keyLength: 241, headWidth: 64 }, tensorFlop: 223_031_040, softmaxFlop: 2_610_030, scaleFlop: 871_215, transcendentalOps: 874_830, atomicByte: 8_203_640, fusedByte: 1_233_920 },
    ];
    for (const anchor of attentionAnchors) {
      const metrics = attentionMetrics(anchor.input, 2);
      expect(metrics.scoreFlop + metrics.valueFlop).toBe(anchor.tensorFlop);
      expect(metrics.softmaxScalarFlop).toBe(anchor.softmaxFlop);
      expect(metrics.scaleScalarFlop).toBe(anchor.scaleFlop);
      expect(metrics.transcendentalOps).toBe(anchor.transcendentalOps);
      expect(metrics.atomicByte).toBe(anchor.atomicByte);
      expect(metrics.fusedBoundaryByte).toBe(anchor.fusedByte);
    }
  });
});
