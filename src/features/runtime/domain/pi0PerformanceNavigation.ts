import type { RoutePatch } from "../../../app/routes";

interface EmbeddedTimelineSelection {
  runtime: string | null;
  runtimePrecision: string | null;
  runtimeFacet: string | null;
  hardware: string | null;
  workload: string;
  captureId: string;
  entity: string;
}

export function pi0PerformanceNavigationPatch(
  destination: "logical" | "comparison" | "stack",
): RoutePatch {
  return {
    tab: destination === "logical" ? "logical" : "runtime",
    entity: null,
    timelineCapture: null,
    basis: null,
    rooflineLevel: "overview",
    ...(destination === "stack" ? {} : { runtime: null, runtimePrecision: null, runtimeFacet: null }),
  };
}

export function pi0EmbeddedTimelineSelectionPatch(selection: EmbeddedTimelineSelection): RoutePatch {
  return {
    tab: "runtime",
    runtime: selection.runtime,
    runtimePrecision: selection.runtimePrecision,
    runtimeFacet: selection.runtimeFacet,
    hardware: selection.hardware,
    workload: selection.workload,
    timelineCapture: selection.captureId,
    entity: selection.entity,
  };
}
