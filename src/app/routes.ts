import { useCallback, useEffect, useRef, useState } from "react";

export const WORKBENCH_TABS = [
  "logical",
  "runtime",
  "end-to-end",
  "timeline",
  "roofline-kernels",
] as const;

export type WorkbenchTab = (typeof WORKBENCH_TABS)[number];

export interface RouteState {
  inputShape?: string | null;
  analysisView?: "system" | "hotspots" | "reuse" | "perfetto";
  selectedRun?: string | null;
  model: string | null;
  tab: WorkbenchTab;
  runtime: string | null;
  hardware: string | null;
  workload: string | null;
  precision: string | null;
  runtimePrecision: string | null;
  runtimeFacet: string | null;
  entity: string | null;
  timelineCapture: string | null;
  rooflineLevel: "overview" | "stage" | "atomic" | "fused" | "kernel";
  basis: string | null;
}

export type RoutePatch = Partial<RouteState>;

const ROUTE_FIELDS = [
  "model",
  "inputShape",
  "analysisView",
  "selectedRun",
  "runtime",
  "hardware",
  "workload",
  "precision",
  "runtimePrecision",
  "runtimeFacet",
  "entity",
  "timelineCapture",
  "basis",
] as const;

export function readRoute(search = window.location.search): RouteState {
  const params = new URLSearchParams(search);
  const requestedTab = params.get("tab");
  const isPi0 = (readValue(params, "model") ?? "pi0") === "pi0";
  const runtime = readValue(params, "runtime");
  const legacyView = !isPi0 ? null : requestedTab === "timeline" ? "system" : requestedTab === "roofline-kernels" && runtime ? "hotspots" : null;
  const requestedView = params.get("analysisView");
  const analysisView = ["system", "hotspots", "reuse", "perfetto"].includes(requestedView ?? "")
    ? requestedView as RouteState["analysisView"] : legacyView;
  const legacyRuntime = legacyView !== null || isPi0 && requestedTab === "end-to-end";
  return {
    ...(params.has("inputShape") ? { inputShape: readValue(params, "inputShape") } : {}),
    ...(params.has("selectedRun") ? { selectedRun: readValue(params, "selectedRun") } : {}),
    ...(analysisView ? { analysisView } : {}),
    model: readValue(params, "model") ?? "pi0",
    tab: legacyRuntime ? "runtime" : isWorkbenchTab(requestedTab) ? requestedTab : "logical",
    runtime: readValue(params, "runtime"),
    hardware: readValue(params, "hardware") ?? "nvidia-jetson-agx-thor",
    workload: readValue(params, "workload"),
    precision: readValue(params, "precision") ?? "bf16_dense",
    runtimePrecision: readValue(params, "runtimePrecision"),
    runtimeFacet: readValue(params, "runtimeFacet"),
    entity: readValue(params, "entity"),
    timelineCapture: readValue(params, "timelineCapture"),
    rooflineLevel: readRooflineLevel(params.get("roofline-level")),
    basis: readValue(params, "basis"),
  };
}

export function routeHref(route: RouteState, patch: RoutePatch = {}): string {
  const next = { ...route, ...patch };
  const params = new URLSearchParams();
  if (next.model) {
    params.set("model", next.model);
  }
  if (next.model || next.tab !== "logical") {
    params.set("tab", next.tab);
  }
  for (const field of ROUTE_FIELDS) {
    if (field === "model") {
      continue;
    }
    const value = next[field];
    if (value) {
      params.set(field, value);
    }
  }
  if (next.rooflineLevel !== "overview") {
    params.set("roofline-level", next.rooflineLevel);
  }
  const search = params.toString();
  return search ? `?${search}` : "./";
}

function readRooflineLevel(value: string | null): RouteState["rooflineLevel"] {
  return value === "stage" || value === "atomic" || value === "fused" || value === "kernel"
    ? value
    : "overview";
}

export function useRouteState(): [
  RouteState,
  (patch: RoutePatch, replace?: boolean) => void,
] {
  const [route, setRoute] = useState<RouteState>(() => readRoute());
  const theoryViews = useRef(new Map<string, RoutePatch>());

  useEffect(() => {
    const handlePopState = () => setRoute(readRoute());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = useCallback(
    (patch: RoutePatch, replace = false) => {
      const sameModel = !patch.model || patch.model === route.model;
      if (route.tab === "logical" && patch.tab && patch.tab !== "logical" && route.model) {
        theoryViews.current.set(route.model, {entity:route.entity,workload:route.workload,precision:route.precision});
      }
      const restored = sameModel && patch.tab === "logical" && route.tab !== "logical" && route.model
        ? theoryViews.current.get(route.model) ?? {} : {};
      const next = { ...route, ...patch, ...restored };
      const href = routeHref(next);
      window.history[replace ? "replaceState" : "pushState"]({}, "", href);
      setRoute(readRoute());
    },
    [route],
  );

  return [route, navigate];
}

export function isPlainNavigation(event: React.MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}

function readValue(params: URLSearchParams, field: string): string | null {
  const value = params.get(field)?.trim();
  return value ? value : null;
}

function isWorkbenchTab(value: string | null): value is WorkbenchTab {
  return WORKBENCH_TABS.some((tab) => tab === value);
}
