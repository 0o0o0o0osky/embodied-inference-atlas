import type { WorkbenchTab } from "../../app/routes";
import type { AtlasData, ModelRecord } from "../../types/atlas";

interface WorkbenchSurfaceProps {
  data: AtlasData;
  model: ModelRecord;
  tab: WorkbenchTab;
}

const VIEW_COPY: Record<
  WorkbenchTab,
  { title: string; scope: string; empty: string }
> = {
  logical: {
    title: "Logical model",
    scope: "Architecture and tensor flow, independent of runtime and hardware.",
    empty: "The shell exposes the canonical model contract without inventing a graph projection.",
  },
  runtime: {
    title: "Runtime realization",
    scope: "Execution mappings overlay one stable logical model.",
    empty: "No fused groups or kernel mappings are synthesized by this shell.",
  },
  "end-to-end": {
    title: "End-to-end evidence",
    scope: "Timing records retain workload, method, boundary, and evidence class.",
    empty: "Comparison-safe performance views are staged separately from navigation.",
  },
  timeline: {
    title: "Timeline evidence",
    scope: "CPU and GPU events require a sanitized profiler capture.",
    empty: "No timeline is drawn when the canonical snapshot has no timeline dataset.",
  },
  "roofline-kernels": {
    title: "Roofline and kernels",
    scope: "Analytical ceilings and measured kernels remain different evidence planes.",
    empty: "No roofline curve or kernel diagnosis is fabricated at the shell stage.",
  },
};

export function WorkbenchSurface({ data, model, tab }: WorkbenchSurfaceProps) {
  const copy = VIEW_COPY[tab];
  const modelRuns = data.datasets.runs.filter(
    (run) => run.model_id === model.model_id,
  );
  const graphRecords = data.datasets.model_graphs.filter(
    (record) => record.model_id === model.model_id,
  );

  return (
    <section className="workbench-surface" aria-labelledby="surface-title">
      <header>
        <div>
          <p className="surface-coordinate">{model.architecture_id} / {tab}</p>
          <h2 id="surface-title">{copy.title}</h2>
        </div>
        <span className="surface-state">Canonical data only</span>
      </header>

      <div className="surface-body">
        <div className="surface-message">
          <p className="surface-scope">{copy.scope}</p>
          <p>{copy.empty}</p>
        </div>

        <dl className="model-ledger">
          <div>
            <dt>Model type</dt>
            <dd>{model.model_type.replaceAll("_", " ")}</dd>
          </div>
          <div>
            <dt>Inputs</dt>
            <dd>{model.input_modalities.join(", ")}</dd>
          </div>
          <div>
            <dt>Outputs</dt>
            <dd>{model.output_modalities.join(", ")}</dd>
          </div>
          <div>
            <dt>Execution</dt>
            <dd>{model.execution_modes.map(humanize).join(", ")}</dd>
          </div>
          <div>
            <dt>Canonical runs</dt>
            <dd>{modelRuns.length}</dd>
          </div>
          <div>
            <dt>Graph records</dt>
            <dd>{graphRecords.length}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}
