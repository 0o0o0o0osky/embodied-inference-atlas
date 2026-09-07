import { runtimeEvidenceSelectionPatch } from './analysisNavigation';
import { expect, it } from "vitest";
import { readRoute, routeHref, type RouteState } from "../../../app/routes";
import { isModelTheory, embeddedTimelineSelectionPatch, performanceNavigationPatch, theoryNavigationPatch } from "./analysisNavigation";

it("retains selected execution context on comparison return and clears it only for model theory", () => {
  const detail: RouteState = {
    model: "pi0", tab: "runtime", runtime: "flashrt",
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
    const href = routeHref(detail, performanceNavigationPatch(destination));
    expect(readRoute(href), destination).toEqual({ ...preservedScope, ...expected, ...(destination === "logical" ? {} : {entity:"kernel:selected",timelineCapture:"capture-selected"}) });
  }
});

it("returns from expanded theory to the same DAG operator and analytical scenario", () => {
  const graph = readRoute("?model=pi0&tab=logical&hardware=nvidia-jetson-agx-thor&precision=fp16_dense&workload=v=2,p=32,a=20,n=12&entity=logical:prefix-encoder%252Fq-proj");
  const expanded = readRoute(routeHref(graph, theoryNavigationPatch(graph, "expanded")));
  expect(expanded.tab).toBe("logical");
  expect(expanded.theoryView).toBe("roofline");
  expect(expanded.rooflineLevel).toBe("atomic");
  expect(isModelTheory(expanded)).toBe(true);
  expect(readRoute(routeHref(expanded, theoryNavigationPatch(expanded, "logical")))).toEqual(graph);
  expect(isModelTheory({ ...expanded, tab: "runtime", runtime: "flashrt", rooflineLevel: "fused" })).toBe(false);
});

it("keeps embedded Nsys interval selection inside the performance overview", () => {
  expect(embeddedTimelineSelectionPatch({
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
    const expanded = readRoute(routeHref(graph, theoryNavigationPatch(graph, "expanded")));
    expect(isModelTheory(expanded)).toBe(true);
    expect(expanded.model).toBe(model);
    expect(expanded.workload).toBe(graph.workload);
    expect(readRoute(routeHref(expanded, theoryNavigationPatch(expanded, "logical")))).toEqual(graph);
  }
});

it('keeps the current analysis for the same inference and resets it for another run',()=>{
 const route=readRoute('?model=smolvla&tab=runtime&selectedRun=run-a&analysisView=hotspots&entity=logical:stage/op&timelineCapture=trace-a');
 expect(runtimeEvidenceSelectionPatch(route,'run-a')).toEqual({analysisView:'hotspots',entity:route.entity,timelineCapture:'trace-a'});
 expect(runtimeEvidenceSelectionPatch(route,'run-b')).toEqual({analysisView:'system',entity:null,timelineCapture:null});
});


it("normalizes removed entry URLs to the shared model/runtime workspace for every model", () => {
  for (const model of ['pi0','pi05','smolvla']) {
    const suffix = `&model=${model}&workload=case-a&entity=logical:stage/op&timelineCapture=capture-a`;
    const timeline=readRoute('?tab=timeline&runtime=stack-a'+suffix);
    expect(timeline).toMatchObject({tab:'runtime',analysisView:'system',model,workload:'case-a',entity:'logical:stage/op',timelineCapture:'capture-a'});
    expect(readRoute('?tab=end-to-end'+suffix).tab).toBe('runtime');
    expect(readRoute('?tab=roofline-kernels&runtime=stack-a'+suffix)).toMatchObject({tab:'runtime',analysisView:'hotspots'});
    expect(readRoute('?tab=roofline-kernels'+suffix)).toMatchObject({tab:'logical',theoryView:'roofline'});
    expect(readRoute('?tab=roofline-kernels&roofline-level=kernel'+suffix)).toMatchObject({tab:'logical',theoryView:'roofline',rooflineLevel:'overview'});
    expect(routeHref(timeline)).not.toContain('tab=timeline');
  }
});
