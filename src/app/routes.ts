import { useCallback, useEffect, useState } from "react";

export const WORKBENCH_TABS = [
  "logical",
  "runtime",
  "end-to-end",
  "timeline",
  "roofline-kernels",
] as const;

export type WorkbenchTab = (typeof WORKBENCH_TABS)[number];

export interface RouteState {
  model: string | null;
  tab: WorkbenchTab;
  runtime: string | null;
  hardware: string | null;
  workload: string | null;
  precision: string | null;
  runtimePrecision: string | null;
  entity: string | null;
  timelineCapture: string | null;
  rooflineLevel: "overview" | "stage" | "atomic" | "fused" | "kernel";
  basis: string | null;
}

export type RoutePatch = Partial<RouteState>;

const ROUTE_FIELDS = [
  "model",
  "runtime",
  "hardware",
  "workload",
  "precision",
  "runtimePrecision",
  "entity",
  "timelineCapture",
  "basis",
] as const;

export function readRoute(search = window.location.search): RouteState {
  const params = new URLSearchParams(search);
  const requestedTab = params.get("tab");
  return {
    model: readValue(params, "model"),
    tab: isWorkbenchTab(requestedTab) ? requestedTab : "logical",
    runtime: readValue(params, "runtime"),
    hardware: readValue(params, "hardware"),
    workload: readValue(params, "workload"),
    precision: readValue(params, "precision"),
    runtimePrecision: readValue(params, "runtimePrecision"),
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

  useEffect(() => {
    const handlePopState = () => setRoute(readRoute());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = useCallback(
    (patch: RoutePatch, replace = false) => {
      const next = { ...route, ...patch };
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
