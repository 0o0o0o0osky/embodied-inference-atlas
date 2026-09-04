import { WORKBENCH_TABS, type RoutePatch, type RouteState } from "../../app/routes";
import { RouteLink } from "../../components/RouteLink";
import type { AtlasData, ModelRecord } from "../../types/atlas";
import { ContextBar } from "./ContextBar";
import { WorkbenchSurface } from "./WorkbenchSurface";

interface WorkbenchProps {
  data: AtlasData;
  model: ModelRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

const TAB_LABELS = {
  logical: "Logical",
  runtime: "Runtime",
  "end-to-end": "End-to-end",
  timeline: "Timeline",
  "roofline-kernels": "Roofline & Kernels",
} as const;

export function Workbench({ data, model, route, navigate }: WorkbenchProps) {
  return (
    <main className="workbench-view">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <RouteLink
          route={route}
          patch={{ model: null, entity: null }}
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

      <nav className="workbench-tabs" aria-label="Workbench views">
        {WORKBENCH_TABS.map((tab) => (
          <RouteLink
            key={tab}
            route={route}
            patch={{ tab }}
            navigate={navigate}
            aria-current={route.tab === tab ? "page" : undefined}
          >
            {TAB_LABELS[tab]}
          </RouteLink>
        ))}
      </nav>

      <div className="workbench-grid">
        <WorkbenchSurface data={data} model={model} tab={route.tab} />
        <RouteLedger route={route} />
      </div>
    </main>
  );
}

function RouteLedger({ route }: { route: RouteState }) {
  const rows: Array<[string, string | null]> = [
    ["Model", route.model],
    ["View", route.tab],
    ["Runtime", route.runtime],
    ["Hardware", route.hardware],
    ["Workload", route.workload],
    ["Precision", route.precision],
    ["Selected entity", route.entity],
  ];

  return (
    <aside className="route-ledger" aria-labelledby="route-ledger-title">
      <header>
        <h2 id="route-ledger-title">Route ledger</h2>
        <span>Deep-link state</span>
      </header>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value ? <code>{value}</code> : <span>Not selected</span>}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
