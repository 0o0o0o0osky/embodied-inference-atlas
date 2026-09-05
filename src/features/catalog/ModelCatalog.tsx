import { useMemo } from "react";

import { RouteLink } from "../../components/RouteLink";
import type { RoutePatch, RouteState } from "../../app/routes";
import type {
  AtlasData,
  EvidenceClass,
  EvidenceCounts,
  ModelRecord,
} from "../../types/atlas";
import { modelSwitchPatch } from "../model-graph/domain/modelSwitch";
import { isInferenceRuntimeForModel } from "../runtime/domain/runtimeCatalog";
import { createModelCapabilityRegistry, type ModelCapabilityRegistry } from "../workbench/modelCapabilities";

interface ModelCatalogProps {
  data: AtlasData;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
  missingModelId: string | null;
}

const EVIDENCE_LABELS: Array<[EvidenceClass, string]> = [
  ["measured_local", "Local"],
  ["analytical", "Analytical"],
  ["reported_external", "External"],
];

export function ModelCatalog({
  data,
  route,
  navigate,
  missingModelId,
}: ModelCatalogProps) {
  const capabilities = useMemo(() => createModelCapabilityRegistry(data), [data]);
  return (
    <main className="catalog-view">
      <section className="catalog-intro" aria-labelledby="catalog-title">
        <p className="section-coordinate">Model register / canonical snapshot</p>
        <h1 id="catalog-title">Choose the model before the metric.</h1>
        <p>
          Start from the inference contract, then move across runtime,
          end-to-end, timeline, and roofline evidence without changing the
          logical identity of the model.
        </p>
      </section>

      {missingModelId ? (
        <aside className="route-warning" role="status">
          <strong>Unknown model route</strong>
          <span>
            <code>{missingModelId}</code> is not present in this validated
            snapshot. Choose a canonical model below.
          </span>
        </aside>
      ) : null}

      <section className="model-register" aria-labelledby="register-title">
        <header className="register-heading">
          <h2 id="register-title">Canonical models</h2>
          <span>{data.datasets.models.length} entries</span>
        </header>
        <ol className="model-index">
          {data.datasets.models.map((model, index) => (
            <ModelRow
              key={model.model_id}
              data={data}
              index={index}
              model={model}
              route={route}
              navigate={navigate}
              capabilities={capabilities}
            />
          ))}
        </ol>
      </section>

      <footer className="catalog-footnote">
        <span>Missing measurements remain missing.</span>
        <span>Evidence classes are never collapsed.</span>
        <span>Comparisons retain one varying axis.</span>
      </footer>
    </main>
  );
}

interface ModelRowProps {
  data: AtlasData;
  index: number;
  model: ModelRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
  capabilities: ModelCapabilityRegistry;
}

function ModelRow({ data, index, model, route, navigate, capabilities }: ModelRowProps) {
  const evidence = evidenceCounts(data, model.model_id);
  const runtimeCount = data.datasets.runtimes.filter((runtime) =>
    isInferenceRuntimeForModel(runtime, model.model_id),
  ).length;
  const openPatch: RoutePatch = modelSwitchPatch(
    data,
    model.model_id,
    route,
    capabilities,
  );

  return (
    <li>
      <RouteLink
        className="model-row"
        route={route}
        patch={openPatch}
        navigate={navigate}
        aria-label={`Open ${model.display_name} workbench`}
      >
        <span className="register-number">{String(index + 1).padStart(2, "0")}</span>
        <span className="model-identity">
          <strong>{model.display_name}</strong>
          <code>{model.model_id}</code>
        </span>
        <span className="model-contract">
          <span>{model.model_type.replaceAll("_", " ")}</span>
          <small>
            {model.input_modalities.join(" + ")} to {model.output_modalities.join(" + ")}
          </small>
        </span>
        <span className="model-inventory">
          <span>{model.artifacts.length} artifacts</span>
          <small>{runtimeCount} runtime records</small>
        </span>
        <span className="evidence-register" aria-label="Evidence record counts">
          {EVIDENCE_LABELS.map(([kind, label]) => (
            <span key={kind}>
              <small>{label}</small>
              <strong>{evidence[kind]}</strong>
            </span>
          ))}
        </span>
        <span className="open-model">Open workbench</span>
      </RouteLink>
    </li>
  );
}

function evidenceCounts(data: AtlasData, modelId: string): EvidenceCounts {
  const counts: EvidenceCounts = {
    measured_local: 0,
    analytical: 0,
    reported_external: 0,
  };
  for (const run of data.datasets.runs) {
    if (run.model_id === modelId) {
      counts[run.evidence] += 1;
    }
  }
  return counts;
}
