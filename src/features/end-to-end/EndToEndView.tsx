import { useMemo } from "react";

import type { RoutePatch, RouteState } from "../../app/routes";
import type { AtlasData, EvidenceClass, ModelRecord } from "../../types/atlas";
import { runEntity } from "../workbench/entityKeys";
import { EvidenceTable } from "./components/EvidenceTable";
import { StageLedger } from "./components/StageLedger";
import { buildEvidenceRows } from "./domain/buildEvidenceRows";

interface EndToEndViewProps {
  data: AtlasData;
  model: ModelRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

const COUNT_LABELS: Readonly<Record<EvidenceClass, string>> = {
  measured_local: "Measured",
  analytical: "Analytical",
  reported_external: "External",
};

export function EndToEndView({ data, model, route, navigate }: EndToEndViewProps) {
  const view = useMemo(() => buildEvidenceRows(data, model.model_id, {
    runtimeId: route.runtime,
    hardwareId: route.hardware,
    entity: route.entity,
  }), [data, model.model_id, route.entity, route.hardware, route.runtime]);

  return (
    <section className="e2e-workspace" aria-labelledby="e2e-title">
      <header className="e2e-intro">
        <div>
          <p>Evidence boundary / one canonical run per row</p>
          <h2 id="e2e-title">End-to-end timing register</h2>
          <span>Measured, analytical, and externally reported values retain their own basis. Measured summaries use the within-batch median (p50); analytical records use their estimate.</span>
        </div>
        <dl aria-label={`End-to-end records for ${view.activeFilter}`}>
          {Object.entries(COUNT_LABELS).map(([evidence, label]) => (
            <div key={evidence}>
              <dt>{label}</dt>
              <dd>{view.visibleCounts[evidence as EvidenceClass]}<small> / {view.modelCounts[evidence as EvidenceClass]}</small></dd>
            </div>
          ))}
          <div><dt>Scope</dt><dd className="e2e-scope-count">{view.activeFilter}</dd></div>
        </dl>
      </header>

      <p className="e2e-boundary-note">
        Bar traces compare statistics only within one run and reset their scale on every row. No current measured record is comparison-safe with an analytical artifact; no gap or speedup ratio is emitted.
      </p>

      <div className="evidence-planes">
        {view.planes.map((plane) => (
          <EvidenceTable
            key={plane.evidence}
            evidence={plane.evidence}
            rows={plane.rows}
            selectedRunId={view.selectedRow?.run.run_id ?? null}
            onSelect={(runId) => navigate({ entity: runEntity(runId) }, true)}
          />
        ))}
      </div>

      <StageLedger row={view.selectedRow} />
    </section>
  );
}
