import type { RoutePatch, RouteState } from "../../../app/routes";
import { logicalEntity, logicalRefFromEntity } from "../../workbench/entityKeys";

export function isModelTheory(route: RouteState): boolean {
  return route.tab === "logical";
}

export function theoryNavigationPatch(route: RouteState, destination: "logical" | "expanded"): RoutePatch {
  const ref = logicalRefFromEntity(route.entity);
  return {
    tab: "logical",
    theoryView: destination === "logical" ? null : "roofline",
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

export function performanceNavigationPatch(
  destination: "logical" | "comparison" | "stack",
): RoutePatch {
  return {
    tab: destination === "logical" ? "logical" : "runtime",
    ...(destination === "logical" ? {entity:null,timelineCapture:null,theoryView:null} : {}),
    basis: null,
    rooflineLevel: "overview",
    ...(destination === "stack" ? {} : { runtime: null, runtimePrecision: null, runtimeFacet: null }),
  };
}

export function embeddedTimelineSelectionPatch(selection: EmbeddedTimelineSelection): RoutePatch {
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

/** Returning to the same measured inference keeps its selected analysis object. */
export function runtimeEvidenceSelectionPatch(route: RouteState, runId: string): Pick<RoutePatch, 'analysisView' | 'entity' | 'timelineCapture'> {
  const same = route.selectedRun === runId;
  return { analysisView: same ? route.analysisView ?? 'system' : 'system',
    entity: same ? route.entity : null, timelineCapture: same ? route.timelineCapture : null };
}
