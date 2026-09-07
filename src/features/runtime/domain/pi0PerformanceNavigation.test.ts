import { runtimeEvidenceSelectionPatch } from './pi0PerformanceNavigation';
import { expect, it } from "vitest";
import { readRoute, routeHref, type RouteState } from "../../../app/routes";
import { isPi0ModelTheory, pi0EmbeddedTimelineSelectionPatch, pi0PerformanceNavigationPatch, pi0TheoryNavigationPatch } from "./pi0PerformanceNavigation";

it("retains selected execution context on comparison return and clears it only for model theory", () => {
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
    expect(readRoute(href), destination).toEqual({ ...preservedScope, ...expected, ...(destination === "logical" ? {} : {entity:"kernel:selected",timelineCapture:"capture-selected"}) });
  }
});

it("returns from expanded theory to the same DAG operator and analytical scenario", () => {
  const graph = readRoute("?model=pi0&tab=logical&hardware=nvidia-jetson-agx-thor&precision=fp16_dense&workload=v=2,p=32,a=20,n=12&entity=logical:prefix-encoder%252Fq-proj");
  const expanded = readRoute(routeHref(graph, pi0TheoryNavigationPatch(graph, "expanded")));
  expect(expanded.tab).toBe("roofline-kernels");
  expect(expanded.rooflineLevel).toBe("atomic");
  expect(isPi0ModelTheory(expanded)).toBe(true);
  expect(readRoute(routeHref(expanded, pi0TheoryNavigationPatch(expanded, "logical")))).toEqual(graph);
  expect(isPi0ModelTheory({ ...expanded, runtime: "flashrt", rooflineLevel: "fused" })).toBe(false);
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

it("preserves each model's operator and workload through theory expansion and return", () => {
  for (const model of ["pi05", "smolvla"]) {
    const graph = readRoute(`?model=${model}&tab=logical&hardware=nvidia-jetson-agx-thor&precision=bf16_dense&workload=v=1,p=24,a=15,n=10&entity=logical:prefix-encoder%252Fq-proj`);
    const expanded = readRoute(routeHref(graph, pi0TheoryNavigationPatch(graph, "expanded")));
    expect(isPi0ModelTheory(expanded)).toBe(true);
    expect(expanded.model).toBe(model);
    expect(expanded.workload).toBe(graph.workload);
    expect(readRoute(routeHref(expanded, pi0TheoryNavigationPatch(expanded, "logical")))).toEqual(graph);
  }
});

it('keeps the current analysis for the same inference and resets it for another run',()=>{
 const route=readRoute('?model=smolvla&tab=runtime&selectedRun=run-a&analysisView=hotspots&entity=logical:stage/op&timelineCapture=trace-a');
 expect(runtimeEvidenceSelectionPatch(route,'run-a')).toEqual({analysisView:'hotspots',entity:route.entity,timelineCapture:'trace-a'});
 expect(runtimeEvidenceSelectionPatch(route,'run-b')).toEqual({analysisView:'system',entity:null,timelineCapture:null});
});
