import { expect, it } from "vitest";
import { readRoute, routeHref, type RouteState } from "../../../app/routes";
import { pi0EmbeddedTimelineSelectionPatch, pi0PerformanceNavigationPatch } from "./pi0PerformanceNavigation";

it("leaves detail routes without leaking detail state or losing the requested comparison scope", () => {
  const detail: RouteState = {
    model: "pi0", tab: "roofline-kernels", runtime: "flashrt",
    runtimePrecision: "mixed-fp8-e4m3-fp16", hardware: "nvidia-jetson-agx-thor",
    runtimeFacet: "facet-selected",
    workload: "v=2,p=22", precision: "bf16_dense", entity: "kernel:selected",
    timelineCapture: "capture-selected", basis: "basis-selected", rooflineLevel: "kernel",
  };
  const preservedScope = {
    model: "pi0", hardware: "nvidia-jetson-agx-thor", workload: "v=2,p=22",
    precision: "bf16_dense", runtimeFacet: null, entity: null, timelineCapture: null, basis: null,
    rooflineLevel: "overview",
  };
  const cases = [
    { destination: "logical", expected: { tab: "logical", runtime: null, runtimePrecision: null } },
    { destination: "comparison", expected: { tab: "runtime", runtime: null, runtimePrecision: null } },
    { destination: "stack", expected: { tab: "runtime", runtime: "flashrt", runtimePrecision: "mixed-fp8-e4m3-fp16", runtimeFacet: "facet-selected" } },
  ] as const;
  for (const { destination, expected } of cases) {
    const href = routeHref(detail, pi0PerformanceNavigationPatch(destination));
    expect(readRoute(href), destination).toEqual({ ...preservedScope, ...expected });
  }
});

it("keeps embedded Nsys interval selection inside the performance overview", () => {
  expect(pi0EmbeddedTimelineSelectionPatch({
    runtime: "flashrt",
    runtimePrecision: "mixed-fp8-e4m3-fp16",
    runtimeFacet: "facet-selected",
    hardware: "nvidia-jetson-agx-thor",
    workload: "v=2,p=48,a=20,n=10",
    captureId: "capture-graph",
    entity: "timeline:graph/event:42",
  })).toEqual({
    tab: "runtime",
    runtime: "flashrt",
    runtimePrecision: "mixed-fp8-e4m3-fp16",
    runtimeFacet: "facet-selected",
    hardware: "nvidia-jetson-agx-thor",
    workload: "v=2,p=48,a=20,n=10",
    timelineCapture: "capture-graph",
    entity: "timeline:graph/event:42",
  });
});
