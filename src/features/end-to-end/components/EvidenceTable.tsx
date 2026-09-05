import type { EvidenceClass } from "../../../types/atlas";
import type { EvidenceRow } from "../domain/buildEvidenceRows";

const EVIDENCE_COPY: Record<EvidenceClass, { title: string; description: string }> = {
  measured_local: {
    title: "Measured local",
    description: "Observed benchmark records. Each row keeps its own workload, timing boundary, correctness, and operating point.",
  },
  analytical: {
    title: "Analytical",
    description: "Modeled VLA-Perf estimates. They remain separate from observed wall-clock values and do not validate a speedup.",
  },
  reported_external: {
    title: "Reported external",
    description: "Publicly reported numeric claims would appear here without being presented as local validation.",
  },
};

export function EvidenceTable({
  evidence,
  rows,
  selectedRunId,
  onSelect,
}: {
  evidence: EvidenceClass;
  rows: readonly EvidenceRow[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}) {
  const copy = EVIDENCE_COPY[evidence];
  return (
    <section className={`evidence-plane evidence-plane--${evidence}`} aria-labelledby={`evidence-${evidence}`}>
      <header>
        <div>
          <p>{evidence.replaceAll("_", " ")}</p>
          <h3 id={`evidence-${evidence}`}>{copy.title}</h3>
          <span>{copy.description}</span>
        </div>
        <strong>{rows.length} record{rows.length === 1 ? "" : "s"}</strong>
      </header>
      {rows.length ? (
        <>
          <p className="table-reachability">Full context continues horizontally on narrow screens.</p>
          <div className="evidence-table-scroll" tabIndex={0} aria-label={`${copy.title} evidence table; scroll horizontally for all fields`}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Run / runtime</th>
                  <th scope="col">Selected latency</th>
                  <th scope="col">Within-run timing</th>
                  <th scope="col">Workload</th>
                  <th scope="col">Actual precision</th>
                  <th scope="col">Method / boundary</th>
                  <th scope="col">Operating point</th>
                  <th scope="col">Correctness</th>
                  <th scope="col">Comparison status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.measurement.measurementId} aria-selected={row.run.run_id === selectedRunId}>
                    <th scope="row">
                      <button type="button" onClick={() => onSelect(row.run.run_id)}>
                        {row.runtimeLabel}
                        <small>{row.run.run_id}</small>
                      </button>
                    </th>
                    <td className="evidence-selected-value">
                      {row.selected?.value === null || !row.selected ? "Unavailable" : formatTiming(row.selected.value, row.selected.unit)}
                      <small>{row.selected?.statistic.replaceAll("_", " ") ?? row.measurement.missingReason?.replaceAll("_", " ") ?? "no eligible statistic"}</small>
                    </td>
                    <td><TimingTrace row={row} /></td>
                    <td>{row.workloadLabel}</td>
                    <td>
                      {row.run.precision.precision_id}
                      <small>{row.run.precision.execution_dtype}</small>
                    </td>
                    <td>
                      {row.measurement.measurementMethod.replaceAll("_", " ")}
                      <small>{row.measurement.timingBoundaryId.replaceAll("_", " ")} · {row.run.timing.state_reuse.replaceAll("_", " ")}</small>
                    </td>
                    <td>
                      {row.run.operating_point.operating_point_id.replaceAll("_", " ")}
                      <small>{row.run.operating_point.power_mode ?? "power mode not observed"}</small>
                    </td>
                    <td>
                      {row.run.correctness.status.replaceAll("_", " ")}
                      <small>{row.run.correctness.criterion.replaceAll("_", " ")}</small>
                    </td>
                    <td>{row.comparisonNote}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="evidence-empty">
          <strong>No numeric {copy.title.toLowerCase()} record in this active scope.</strong>
          <span>Unsupported or absent evidence stays visible as an empty plane; no proxy row is inserted.</span>
        </div>
      )}
    </section>
  );
}

function TimingTrace({ row }: { row: EvidenceRow }) {
  if (row.measurement.evidence === "analytical") {
    return <span className="timing-trace timing-trace--estimate"><i aria-hidden="true" /><small>single analytical estimate</small></span>;
  }
  const observed = row.measurement.statistics.filter(
    (item): item is typeof item & { value: number } => item.value !== null && item.unit === row.selected?.unit,
  );
  if (!observed.length || !row.selected || row.selected.value === null) return <span className="timing-trace-missing">No distribution</span>;
  const minimum = Math.min(...observed.map((item) => item.value));
  const maximum = Math.max(...observed.map((item) => item.value));
  const span = maximum - minimum;
  const position = span > 0 ? ((row.selected.value - minimum) / span) * 100 : 50;
  return (
    <span className="timing-trace" aria-label={`Within-run ${minimum} to ${maximum} ${row.selected.unit}; selected ${row.selected.statistic} ${row.selected.value} ${row.selected.unit}`}>
      <span className="timing-trace-line" aria-hidden="true"><i style={{ left: `${position}%` }} /></span>
      <small>{formatTiming(minimum, row.selected.unit)}–{formatTiming(maximum, row.selected.unit)} · local scale</small>
    </span>
  );
}

export function formatTiming(value: number, unit: string): string {
  if (unit === "ms") return `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })} ms`;
  if (unit === "s") return `${value.toLocaleString(undefined, { maximumFractionDigits: 4 })} s`;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${unit}`;
}
