import type { AtlasData } from "../types/atlas";
import type { RoutePatch, RouteState } from "../app/routes";
import { RouteLink } from "./RouteLink";
import { ContextBar } from "../features/workbench/ContextBar";
import { pi0PerformanceNavigationPatch } from "../features/runtime/domain/pi0PerformanceNavigation";

interface AtlasHeaderProps {
  data: AtlasData;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

const HOME_ROUTE: RoutePatch = {
  model: "pi0",
  tab: "logical",
  runtime: null,
  hardware: "nvidia-jetson-agx-thor",
  workload: null,
  precision: "bf16_dense",
  runtimePrecision: null,
  runtimeFacet: null,
  entity: null,
  timelineCapture: null,
};

export function AtlasHeader({ data, route, navigate }: AtlasHeaderProps) {
  const { models } = data.datasets;
  const model = models.find((item) => item.model_id === route.model);
  const topEntries = route.model === "pi0" ? [
    { tab: "logical" as const, label: "理论 DAG", patch: pi0PerformanceNavigationPatch("logical") },
    { tab: "runtime" as const, label: "性能对比", patch: pi0PerformanceNavigationPatch("comparison") },
  ] : [
    { tab: "logical" as const, label: "模型结构", patch: { tab: "logical" as const } },
    { tab: "end-to-end" as const, label: "端到端", patch: { tab: "end-to-end" as const } },
    { tab: "timeline" as const, label: "Nsys", patch: { tab: "timeline" as const } },
  ];

  return (
    <header className="atlas-header">
      <RouteLink
        className="atlas-mark"
        route={route}
        patch={HOME_ROUTE}
        navigate={navigate}
        aria-label="打开 Pi0 模型结构"
      >
        <strong>Atlas</strong>
      </RouteLink>
      <label className="atlas-model-select">
        <span>模型</span>
        <select value={route.model ?? "pi0"} onChange={(event) => navigate({
          model: event.target.value, entity: null, runtime: null,
          runtimePrecision: null, runtimeFacet: null, timelineCapture: null, workload: null, basis: null,
        })}>
          {!model && route.model ? <option value={route.model}>{route.model}</option> : null}
          {models.map((item) => <option key={item.model_id} value={item.model_id}>{item.display_name}</option>)}
        </select>
      </label>
      {model && route.model === "pi0" && ["logical", "runtime", "timeline", "roofline-kernels"].includes(route.tab) ? (
        <ContextBar data={data} model={model} route={route} navigate={navigate} compact />
      ) : null}
      <nav className="atlas-navigation" aria-label="主要视图">
        {topEntries.map(({ tab, label, patch }) => (
          <RouteLink key={tab} route={route} patch={patch} navigate={navigate}
            aria-current={route.tab === tab || (route.model === "pi0" && tab === "runtime" && ["timeline", "roofline-kernels", "end-to-end"].includes(route.tab)) || (tab === "logical" && route.model !== "pi0" && (route.tab === "roofline-kernels" || route.tab === "runtime")) ? "page" : undefined}>
            {label}
          </RouteLink>
        ))}
      </nav>
    </header>
  );
}
