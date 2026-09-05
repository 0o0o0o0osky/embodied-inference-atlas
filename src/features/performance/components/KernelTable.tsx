import type { ProfilerMetric, ProfilerMetricName } from "../../profiler/domain/types";
import type { KernelRow } from "../domain/buildKernelRows";

export function KernelTable({
  rows,
  selectedObservationId,
  onSelect,
}: {
  rows: readonly KernelRow[];
  selectedObservationId: string | null;
  onSelect: (row: KernelRow) => void;
}) {
  return (
    <section className="kernel-table-section" aria-labelledby="kernel-table-title">
      <header>
        <div>
          <p>Capture-local observation register</p>
          <h3 id="kernel-table-title">Kernel diagnostics</h3>
          <span>Nsys window aggregates and single-launch NCU replays occupy separate rows. Their durations and populations are never combined.</span>
        </div>
        <strong>{rows.length} visible row{rows.length === 1 ? "" : "s"}</strong>
      </header>
      {rows.length ? (
        <>
          <p className="table-reachability">Launch and counter columns continue horizontally. Scroll the table to reach them.</p>
          <div className="kernel-table-scroll" tabIndex={0} aria-label="Kernel observation table; scroll horizontally for all diagnostic metrics">
            <table>
              <thead>
                <tr>
                  <th scope="col">Signature / capture</th>
                  <th scope="col">Population</th>
                  <th scope="col">Calls</th>
                  <th scope="col">Duration / share</th>
                  <th scope="col">Launch</th>
                  <th scope="col">SM throughput</th>
                  <th scope="col">Tensor active</th>
                  <th scope="col">Memory SOL</th>
                  <th scope="col">L1 throughput</th>
                  <th scope="col">L2 throughput</th>
                  <th scope="col">L2 sysmem-fill</th>
                  <th scope="col">Occupancy achieved</th>
                  <th scope="col">Occupancy theoretical</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const nsys = row.observation.observationKind.startsWith("nsys_");
                  return (
                    <tr key={row.observation.observationId} aria-selected={row.observation.observationId === selectedObservationId}>
                      <th scope="row">
                        <button type="button" onClick={() => onSelect(row)}>
                          {row.signature.labelSanitized}
                          <small>{nsys ? "Nsys aggregate" : "NCU replay"} · {row.capture.captureId}</small>
                        </button>
                      </th>
                      <td>
                        {nsys ? "All matching launches" : "One profiled launch"}
                        <small>{humanize(row.observation.population)}</small>
                      </td>
                      <td className="kernel-mono">{row.observation.calls.toLocaleString()}</td>
                      <td className="kernel-primary-value">
                        {formatDuration(row.observation.duration.valueNs)}
                        <small>{row.observation.durationShare ? `${row.observation.durationShare.value.toFixed(2)}% of ${humanize(row.observation.durationShare.denominator)}` : "No Nsys share"}</small>
                      </td>
                      <td>
                        {shape(row.observation.launch.grid)} grid
                        <small>{shape(row.observation.launch.block)} block</small>
                      </td>
                      <MetricCell metrics={row.metrics} name="sm_throughput_pct_of_peak_sustained_elapsed" />
                      <MetricCell metrics={row.metrics} name="tensor_cycles_active_pct_of_peak_sustained_elapsed" />
                      <MetricCell metrics={row.metrics} name="memory_sol_pct_of_peak_sustained_elapsed" />
                      <MetricCell metrics={row.metrics} name="l1_throughput_pct_of_peak_sustained_active" />
                      <MetricCell metrics={row.metrics} name="l2_throughput_pct_of_peak_sustained_elapsed" />
                      <MetricCell metrics={row.metrics} name="l2_sysmem_fill_pct_of_peak_sustained_elapsed" note="not LPDDR" />
                      <MetricCell metrics={row.metrics} name="achieved_occupancy_percent" />
                      <MetricCell metrics={row.metrics} name="theoretical_occupancy_percent" />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="kernel-empty"><strong>No profiler observation matches this runtime/hardware scope.</strong> No observation is borrowed from another capture.</p>
      )}
    </section>
  );
}

function MetricCell({ metrics, name, note }: {
  metrics: ReadonlyMap<ProfilerMetricName, ProfilerMetric>;
  name: ProfilerMetricName;
  note?: string;
}) {
  const metric = metrics.get(name);
  return (
    <td className={metric?.value === null || !metric ? "kernel-missing-cell" : "kernel-mono"}>
      {metric?.value === null || !metric ? "Missing" : formatMetric(metric)}
      {note ? <small>{note}</small> : metric?.missingReason ? <small>{humanize(metric.missingReason)}</small> : null}
    </td>
  );
}

export function formatMetric(metric: ProfilerMetric): string {
  if (metric.value === null) return "Missing";
  if (metric.unit === "percent") return `${metric.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  if (metric.unit === "hz") return `${(metric.value / 1e9).toFixed(3)} GHz`;
  if (metric.unit === "byte") return formatBytes(metric.value);
  return `${metric.value.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${metric.unit}`;
}

export function formatDuration(valueNs: number): string {
  if (valueNs >= 1e6) return `${(valueNs / 1e6).toFixed(3)} ms`;
  if (valueNs >= 1e3) return `${(valueNs / 1e3).toFixed(3)} µs`;
  return `${valueNs.toFixed(0)} ns`;
}

export function humanize(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}

function shape(value: readonly number[] | null) {
  return value ? value.join("×") : "Missing";
}

function formatBytes(value: number) {
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(2)} MiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(2)} KiB`;
  return `${value.toFixed(0)} B`;
}
