import type { AtlasData } from "../types/atlas";
import type { RoutePatch, RouteState } from "../app/routes";
import { RouteLink } from "./RouteLink";
import { ContextBar } from "../features/workbench/ContextBar";

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
  entity: null,
  timelineCapture: null,
};

export function AtlasHeader({ data, route, navigate }: AtlasHeaderProps) {
  const { models } = data.datasets;
  const model = models.find((item) => item.model_id === route.model);
  const topEntries = [
    { tab: "logical", label: "模型结构" },
    ...(route.model === "pi0" ? [{ tab: "runtime" as const, label: "推理性能" }] : []),
    { tab: "end-to-end", label: "端到端" },
    { tab: "timeline", label: "Nsys" },
  ] as const;

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
          runtimePrecision: null, timelineCapture: null, workload: null, basis: null,
        })}>
          {!model && route.model ? <option value={route.model}>{route.model}</option> : null}
          {models.map((item) => <option key={item.model_id} value={item.model_id}>{item.display_name}</option>)}
        </select>
      </label>
      {model && route.model === "pi0" && (route.tab === "logical" || route.tab === "runtime") ? (
        <ContextBar data={data} model={model} route={route} navigate={navigate} compact />
      ) : null}
      <nav className="atlas-navigation" aria-label="主要视图">
        {topEntries.map(({ tab, label }) => (
          <RouteLink key={tab} route={route} patch={{ tab }} navigate={navigate}
            aria-current={route.tab === tab || (tab === "logical" && route.tab === "roofline-kernels") ? "page" : undefined}>
            {label}
          </RouteLink>
        ))}
      </nav>
    </header>
  );
}
