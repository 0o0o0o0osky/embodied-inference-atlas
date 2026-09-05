import type { EvidenceRow } from "../domain/buildEvidenceRows";
import { selectedTiming, stagePartitionStatus } from "../domain/buildEvidenceRows";
import { formatTiming } from "./EvidenceTable";

export function StageLedger({ row }: { row: EvidenceRow | null }) {
  if (!row) {
    return (
      <section className="stage-ledger" id="stage-ledger" aria-labelledby="stage-ledger-title">
        <header><div><p>Selected run</p><h3 id="stage-ledger-title">Stage ledger unavailable</h3></div></header>
        <p className="stage-ledger-empty">Select a canonical end-to-end record to inspect its same-run stage evidence.</p>
      </section>
    );
  }
  const status = stagePartitionStatus(row);
  const selectedStages = row.stages.map((stage) => ({ stage, timing: selectedTiming(stage.evidence, stage.statistics) }));
  const selectedValue = row.selected?.value ?? null;
  return (
    <section className="stage-ledger" id="stage-ledger" aria-labelledby="stage-ledger-title">
      <header>
        <div>
          <p>Selected run / same-run evidence only</p>
          <h3 id="stage-ledger-title">Stage ledger</h3>
          <code>{row.run.run_id}</code>
        </div>
        <span>{statusLabel(status)}</span>
      </header>
      <div className="stage-ledger-context">
        <strong>{row.runtimeLabel} · {row.selected?.value === null || !row.selected ? "latency unavailable" : formatTiming(row.selected.value, row.selected.unit)}</strong>
        <span>{row.workloadLabel}</span>
        <small>{row.measurement.timingBoundaryId.replaceAll("_", " ")} · {row.measurement.sampleCount} samples · source {row.measurement.sourceId}</small>
      </div>
      {status === "not_collected" ? (
        <p className="stage-ledger-empty"><strong>Stage timing not collected.</strong> The end-to-end value is not allocated across inferred stages.</p>
      ) : (
        <>
          {status === "additive_reconciled" && selectedValue !== null ? (
            <div className="stage-composition" aria-label="Reconciled analytical stage composition">
              {selectedStages.map(({ stage, timing }) => timing?.value === null || !timing ? null : (
                <span
                  key={stage.measurementId}
                  style={{ width: `${Math.max(0, (timing.value / selectedValue) * 100)}%` }}
                  title={`${stage.stageId}: ${formatTiming(timing.value, timing.unit)}`}
                />
              ))}
            </div>
          ) : null}
          <div className="stage-ledger-rows">
            {selectedStages.map(({ stage, timing }, index) => (
              <div key={stage.measurementId}>
                <span className="stage-index">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{stage.stageId.replaceAll("-", " ")}</strong>
                  <small>{stage.aggregation} · ×{stage.executionCount} · {stage.additive ? "declared additive" : "independent summary"}</small>
                </div>
                <span>{timing?.value === null || !timing ? "Unavailable" : formatTiming(timing.value, timing.unit)}</span>
              </div>
            ))}
          </div>
          <p className={`stage-ledger-note stage-ledger-note--${status}`}>
            {status === "additive_reconciled"
              ? "These analytical stages share the end-to-end boundary, are declared additive, and reconcile to the selected estimate. The composition bar is valid only for this run."
              : status === "non_additive_summaries"
                ? "These are independently summarized stages. They are not summed, stacked, or treated as a partition of the end-to-end window."
                : "The available stages do not prove a complete additive partition, so no stacked composition or stage total is shown."}
          </p>
        </>
      )}
    </section>
  );
}

function statusLabel(status: ReturnType<typeof stagePartitionStatus>) {
  if (status === "additive_reconciled") return "Analytical partition reconciled";
  if (status === "non_additive_summaries") return "Non-additive summaries";
  if (status === "not_collected") return "Not collected";
  return "Incomplete partition";
}
