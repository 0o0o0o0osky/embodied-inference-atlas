import { type RoutePatch, type RouteState } from "../../app/routes";
import { EndToEndView } from "../end-to-end/EndToEndView";
import { ModelGraphWorkspace } from "../model-graph/ModelGraphWorkspace";
import { PerformanceView } from "../performance/PerformanceView";
import { RuntimeView } from "../runtime/RuntimeView";
import { TimelineView } from "../timeline/TimelineView";
import type { AtlasData, ModelRecord } from "../../types/atlas";

interface WorkbenchProps {
  data: AtlasData;
  model: ModelRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

export function Workbench({ data, model, route, navigate }: WorkbenchProps) {
  return (
    <main className="workbench-view model-workbench">
      {route.tab === "logical" ? (
        <ModelGraphWorkspace
          data={data}
          model={model}
          route={route}
          navigate={navigate}
        />
      ) : route.tab === "runtime" ? (
        <RuntimeView data={data} model={model} route={route} navigate={navigate} />
      ) : route.tab === "end-to-end" ? (
        <EndToEndView data={data} model={model} route={route} navigate={navigate} />
      ) : route.tab === "timeline" ? (
        <TimelineView data={data} model={model} route={route} navigate={navigate} />
      ) : route.tab === "roofline-kernels" ? (
        <PerformanceView data={data} model={model} route={route} navigate={navigate} />
      ) : null}
    </main>
  );
}
