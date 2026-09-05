import { type RoutePatch, type RouteState } from "../../app/routes";
import { RouteLink } from "../../components/RouteLink";
import { EndToEndView } from "../end-to-end/EndToEndView";
import { ModelGraphWorkspace } from "../model-graph/ModelGraphWorkspace";
import { PerformanceView } from "../performance/PerformanceView";
import { RuntimeView } from "../runtime/RuntimeView";
import { TimelineView } from "../timeline/TimelineView";
import type { AtlasData, ModelRecord } from "../../types/atlas";
import { ContextBar } from "./ContextBar";

interface WorkbenchProps {
  data: AtlasData;
  model: ModelRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

export function Workbench({ data, model, route, navigate }: WorkbenchProps) {
  const isPi0Workspace = model.model_id === "pi0" && (route.tab === "logical" || route.tab === "runtime");
  return (
    <main className={`workbench-view${isPi0Workspace ? " workbench-view--pi0" : ""}`}>
      {!isPi0Workspace ? <>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <RouteLink
          route={route}
          patch={{ model: null }}
          navigate={navigate}
        >
          Model register
        </RouteLink>
        <span aria-hidden="true">/</span>
        <strong>{model.display_name}</strong>
        <code>{model.model_id}</code>
      </nav>

      <section className="workbench-heading">
        <div>
          <p className="section-coordinate">Model workbench / stable route</p>
          <h1>{model.display_name}</h1>
        </div>
        <p>
          The logical model remains the anchor. Runtime, hardware, workload,
          precision, and entity selections stay recoverable in this URL.
        </p>
      </section>

      <ContextBar data={data} model={model} route={route} navigate={navigate} />
      </> : null}

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
