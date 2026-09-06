import type { RoutePatch, RouteState } from "../../../app/routes";
import { logicalEntity, logicalRefFromEntity } from "../../workbench/entityKeys";

export function isPi0ModelTheory(route: RouteState): boolean {
  return route.model === "pi0" && (route.tab === "logical" || (
    route.tab === "roofline-kernels" && !route.runtime
    && ["overview", "stage", "atomic"].includes(route.rooflineLevel)
  ));
}

export function pi0TheoryNavigationPatch(route: RouteState, destination: "logical" | "expanded"): RoutePatch {
  const ref = logicalRefFromEntity(route.entity);
  return {
    tab: destination === "logical" ? "logical" : "roofline-kernels",
    runtime: null, runtimePrecision: null, runtimeFacet: null,
    timelineCapture: null, basis: null,
    entity: ref ? logicalEntity(ref) : null,
    rooflineLevel: destination === "logical" ? "overview" : ref ? "atomic" : "stage",
  };
}

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
