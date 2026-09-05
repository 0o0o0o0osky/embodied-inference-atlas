import type { RoutePatch, RouteState } from "../../../app/routes";
import { RouteLink } from "../../../components/RouteLink";
import type {
  KernelLaunch,
  NcuWarpTrigger,
  NcuWarpTriggerCriterion,
  ProfilerMetric,
  ProfilerMetricName,
  TelemetryRecord,
} from "../../profiler/domain/types";
import { kernelEntity } from "../../workbench/entityKeys";
import type { KernelRowsModel } from "../domain/buildKernelRows";
import {
  formatDuration,
  formatMetric,
  humanize,
  preferredProfilerMetric,
  TENSOR_ACTIVE_METRIC_NAMES,
} from "./KernelTable";

const DIAGNOSTIC_METRICS: readonly [string, readonly ProfilerMetricName[], string?][] = [
  ["SM throughput", ["sm_throughput_pct_of_peak_sustained_elapsed"]],
  ["Tensor active", TENSOR_ACTIVE_METRIC_NAMES, "Active-cycle counter preferred; legacy elapsed-cycle counter remains visible"],
  ["Tensor path", ["tensor_path_fp4_fp6_fp8_to_fp32_dense_pct_of_peak_elapsed"]],
  ["Memory SOL", ["memory_sol_pct_of_peak_sustained_elapsed"]],
  ["Memory access throughput", ["memory_access_throughput_pct_of_peak_sustained_elapsed"]],
  ["L1TEX sector hit rate", ["l1tex_sector_hit_rate_percent"]],
  ["Memory request throughput", ["memory_request_throughput_pct_of_peak_sustained_elapsed"]],
  ["L2 sector hit rate", ["l2_sector_hit_rate_percent"]],
  ["Memory pipe throughput", ["memory_pipes_throughput_pct_of_peak_sustained_elapsed"]],
  ["L1 throughput", ["l1_throughput_pct_of_peak_sustained_active"]],
  ["L2 / LTS throughput", ["l2_throughput_pct_of_peak_sustained_elapsed"]],
  ["L2 sysmem-fill", ["l2_sysmem_fill_pct_of_peak_sustained_elapsed"], "L2 fill source; not LPDDR utilization"],
  ["Occupancy achieved", ["achieved_occupancy_percent"]],
  ["Occupancy theoretical", ["theoretical_occupancy_percent"]],
  ["GPC cycle rate", ["gpc_cycle_rate_hz"]],
  ["SM cycle rate", ["sm_cycle_rate_hz"]],
  ["Issued warps / scheduler active cycle", ["scheduler_issue_active_per_active_cycle"]],
  ["One or more eligible", ["scheduler_issue_active_pct_of_peak_sustained_active"]],
  ["No eligible", ["scheduler_issue_inst0_percent"]],
  ["Active warps / active cycle", ["scheduler_active_warps_per_active_cycle"]],
  ["Eligible warps / active cycle", ["scheduler_eligible_warps_per_active_cycle"]],
  ["Maximum warps / active cycle", ["scheduler_maximum_warps_per_active_cycle"]],
  ["Active warps / peak sustained", ["scheduler_warps_active_peak_sustained"]],
  ["L2 sysmem fill sectors", ["l2_sysmem_fill_sectors"], "Do not add; not LPDDR traffic or utilization"],
  ["L2 sysmem write sectors", ["l2_sysmem_write_sectors"], "Do not add; not LPDDR traffic or utilization"],
  ["L2 sysmem lookup-miss sectors", ["l2_sysmem_lookup_miss_sectors"], "Do not add; not LPDDR traffic or utilization"],
  ["Average warp latency / issued instruction", ["average_warp_latency_cycles_per_issued_instruction"]],
  ["Long scoreboard cycles / issued instruction", ["long_scoreboard_cycles_per_issued_instruction"]],
  ["Short scoreboard cycles / issued instruction", ["short_scoreboard_cycles_per_issued_instruction"]],
];

const DIAGNOSIS_GAPS: readonly [string, readonly ProfilerMetricName[]][] = [
  ["DRAM / system-memory throughput", ["system_memory_throughput_pct_of_ceiling"]],
  ["DRAM / system-memory bytes", ["system_memory_bytes"]],
  ["SchedulerStats", ["scheduler_issue_active_per_active_cycle", "scheduler_issue_active_percent"]],
  ["Long scoreboard", ["long_scoreboard_cycles_per_issued_instruction", "warp_stall_long_scoreboard_percent"]],
  ["Short scoreboard", ["short_scoreboard_cycles_per_issued_instruction", "warp_stall_short_scoreboard_percent"]],
  ["SourceCounters attribution", ["source_counter_attribution"]],
];

export function KernelInspector({ model, route, navigate }: {
  model: KernelRowsModel;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}) {
  const row = model.selectedRow;
  if (!row) {
    return (
      <aside className="kernel-inspector kernel-inspector--empty">
        <header><p>Selected observation</p><h3>No capture-local row</h3></header>
        <p>The active filters emit no profiler observation. No counter values are imputed.</p>
      </aside>
    );
  }
  const isNcu = row.observation.observationKind === "ncu_replayed_launch";
  const counterpart = isNcu ? model.relatedNsys : model.relatedNcu;
  const exactLinks = row.links.filter((link) => link.status === "resolved");
  const precisionMissing = Object.entries(row.signature.precisionPath.missing);
  const signatureMissing = Object.entries(row.signature.missing);
  const precisionConflict = signatureMissing.some(([, reason]) => reason.includes("precision_conflict"));
  const precisionComplete = row.signature.precisionPath.inputDtypeClass !== null
    && row.signature.precisionPath.accumulatorDtypeClass !== null
    && row.signature.precisionPath.outputDtypeClass !== null;
  return (
    <aside className="kernel-inspector" aria-labelledby="kernel-inspector-title">
      <header>
        <p>{isNcu ? "NCU / one replayed launch" : "Nsys / one prediction window"}</p>
        <h3 id="kernel-inspector-title">{row.signature.labelSanitized}</h3>
        <code>{row.observation.observationId}</code>
      </header>

      <dl className="kernel-observation-ledger">
        <Ledger label="Capture" value={row.capture.captureId} />
        <Ledger label="Population" value={humanize(row.observation.population)} />
        <Ledger label="Calls" value={row.observation.calls.toLocaleString()} />
        <Ledger label="Duration" value={formatDuration(row.observation.duration.valueNs)} />
        <Ledger label="Share" value={row.observation.durationShare ? `${row.observation.durationShare.value.toFixed(2)}% of ${humanize(row.observation.durationShare.denominator)}` : "Not defined for replay"} />
        <Ledger label="Selection" value={humanize(row.capture.selectionPolicy)} />
        <Ledger label="Function family" value={humanize(row.signature.functionFamily)} />
        <Ledger label="Implementation family" value={humanize(row.signature.implementationFamily)} />
      </dl>

      <section className="kernel-inspector-section">
        <div className="kernel-section-heading"><p>Launch resources</p><h4>Capture-reported configuration</h4></div>
        <LaunchLedger launch={row.observation.launch} />
      </section>

      <section className="kernel-inspector-section">
        <div className="kernel-section-heading"><p>Named diagnostic metrics</p><h4>{isNcu ? "Replay counters" : "No replay counters on Nsys aggregate"}</h4></div>
        <dl className="kernel-diagnostic-grid">
          {DIAGNOSTIC_METRICS.map(([label, names, note]) => (
            <MetricLedger key={label} label={label} metric={preferredProfilerMetric(row.metrics, names)} note={note} />
          ))}
        </dl>
      </section>

      {row.capture.ncu ? (
        <section className="kernel-inspector-section">
          <div className="kernel-section-heading"><p>Capture contract</p><h4>Section and clock provenance</h4></div>
          <dl className="kernel-gap-ledger">
            <Ledger label="Section mode" value={humanize(row.capture.ncu.sectionMode ?? "unknown")} />
            <Ledger label="Sections" value={formatDeclaredList(row.capture.ncu.sections)} />
            <Ledger label="Explicit metrics" value={formatDeclaredList(row.capture.ncu.explicitMetrics)} />
            <Ledger label="NCU clock request" value={`${row.capture.ncu.clockControlRequest} · ${humanize(row.capture.ncu.origins.clockControlRequest ?? "unknown origin")}`} />
            <Ledger label="External clock control" value={row.capture.ncu.externalClockControl
              ? `${humanize(row.capture.ncu.externalClockControl.controller)} ${humanize(row.capture.ncu.externalClockControl.state)} · ${humanize(row.capture.ncu.origins.externalClockControl ?? "unknown origin")}`
              : "Unknown"} />
            {row.capture.ncu.warpTrigger ? <>
              <Ledger label="Collection sequence" value="SchedulerStats first → one WarpStateStats supplemental replay" />
              <Ledger label="Scheduler source" value={`${row.capture.ncu.warpTrigger.schedulerCaptureId} · ${row.capture.ncu.warpTrigger.schedulerObservationId} · ${humanize(row.capture.ncu.warpTrigger.origin)}`} />
              <Ledger label="Observed gate" value={formatWarpTriggerCriteria(row.capture.ncu.warpTrigger.criteria)} />
              <Ledger label="Launch / occupancy review" value={formatLaunchOccupancyReview(row.capture.ncu.warpTrigger.launchOccupancyReview)} />
            </> : null}
          </dl>
          {row.capture.ncu.warpTrigger ? <p>Stored collection gate only; no bottleneck conclusion is inferred.</p> : null}
        </section>
      ) : null}

      {row.telemetry.length ? <TelemetryLedger telemetry={row.telemetry} /> : null}

      <section className="kernel-inspector-section kernel-missing-section">
        <div className="kernel-section-heading"><p>Diagnosis boundary</p><h4>Required evidence and current availability</h4></div>
        <dl className="kernel-gap-ledger">
          {DIAGNOSIS_GAPS.map(([label, names]) => (
            <GapLedger key={label} label={label} metrics={names.map((name) => row.metrics.get(name) ?? null)} />
          ))}
        </dl>
        <p>Whole-system traffic remains unavailable, so no LPDDR-saturation conclusion is supported. Scheduler and scoreboard counters, when present above, are diagnostic evidence rather than a standalone bottleneck verdict.</p>
      </section>

      <section className="kernel-link-boundary">
        <strong>{exactLinks.length} exact operator link{exactLinks.length === 1 ? "" : "s"} · {precisionConflict ? "precision conflict recorded" : precisionComplete ? "no reviewed logical attribution" : "precision path incomplete"}</strong>
        <span>No logical operator, end-to-end share, or roofline point is attributed from this signature.</span>
        {precisionMissing.map(([field, reason]) => (
          <small key={`precision/${field}`}>precision path / {humanize(field)} · {humanize(reason)}</small>
        ))}
        {signatureMissing.map(([field, reason]) => (
          <small key={`signature/${field}`}>signature / {humanize(field)} · {humanize(reason)}</small>
        ))}
      </section>

      {counterpart ? (
        <section className="kernel-counterpart">
          <p>{isNcu ? "Related Nsys aggregate" : "Separate NCU replay"}</p>
          <strong>Matched signature, not matched sample</strong>
          <span>{counterpart.observation.calls.toLocaleString()} call{counterpart.observation.calls === 1 ? "" : "s"} · {formatDuration(counterpart.observation.duration.valueNs)} · no population transfer</span>
          <RouteLink route={route} patch={{ entity: kernelEntity(counterpart.capture.captureId, counterpart.observation.observationId) }} navigate={navigate}>Open separate observation</RouteLink>
        </section>
      ) : null}

      {!isNcu && row.capture.nsys ? (
        <RouteLink
          className="kernel-timeline-link"
          route={route}
          patch={{ tab: "timeline", timelineCapture: row.capture.captureId, entity: kernelEntity(row.capture.captureId, row.observation.observationId) }}
          navigate={navigate}
        >
          Inspect this aggregate on its Nsys timeline
        </RouteLink>
      ) : null}

      {row.capture.ncu ? (
        <details className="kernel-provenance">
          <summary>Counter identity, section, basis, confidence, and capture origins</summary>
          <dl>
            {Object.entries(row.capture.ncu.origins).map(([field, origin]) => (
              <div key={field}><dt>{humanize(field)}</dt><dd>{humanize(origin ?? "unknown")}</dd></div>
            ))}
          </dl>
          <ul>
            {[...row.metrics.values()].map((metric) => (
              <li key={metric.metricId}>
                <strong>{humanize(metric.metricName)}</strong>
                <code>{metric.rawCounterName ?? "no raw counter"}</code>
                <span>{humanize(metric.statistic)} · {metric.unit} · {metric.sectionName} · {metric.basis} · {metric.confidence} confidence · {metric.missingReason ?? "observed"}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </aside>
  );
}

function formatDeclaredList(values: readonly string[] | null) {
  if (values === null) return "Unknown";
  return values.length ? values.join(" · ") : "None declared";
}

function formatWarpTriggerCriteria(criteria: readonly NcuWarpTriggerCriterion[]) {
  return criteria.map((criterion) =>
    `${humanize(criterion.metricName)} ${criterion.observedValue.toLocaleString()} ${criterion.operator === "lt" ? "<" : "≥"} ${criterion.threshold.toLocaleString()}`,
  ).join(" · ");
}

function formatLaunchOccupancyReview(review: NcuWarpTrigger["launchOccupancyReview"]) {
  return `${humanize(review.conclusion)} · ${humanize(review.basis)} · ${review.evidenceFields.map(humanize).join(" · ")}`;
}

function TelemetryLedger({ telemetry }: { telemetry: readonly TelemetryRecord[] }) {
  return (
    <section className="kernel-inspector-section">
      <div className="kernel-section-heading"><p>Capture telemetry</p><h4>Measurement source retained</h4></div>
      <dl className="kernel-gap-ledger">
        {telemetry.map((item) => (
          <Ledger
            key={item.telemetryId}
            label={humanize(item.metricName)}
            value={`${item.summary ? `${item.summary.value.toLocaleString()} ${item.summary.unit}` : `Missing · ${humanize(item.missingReason ?? "unknown")}`} · ${humanize(item.measurementSource ?? "unknown source")}`}
          />
        ))}
      </dl>
    </section>
  );
}

function Ledger({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function MetricLedger({ label, metric, note }: { label: string; metric: ProfilerMetric | null; note: string | undefined }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{metric?.value === null || !metric ? `Missing · ${humanize(metric?.missingReason ?? "not collected")}` : formatMetric(metric)}</dd>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function GapLedger({ label, metrics }: { label: string; metrics: readonly (ProfilerMetric | null)[] }) {
  const present = metrics.find((metric): metric is ProfilerMetric => metric !== null && metric.value !== null);
  const reasons = [...new Set(metrics.flatMap((metric) => metric?.missingReason ? [humanize(metric.missingReason)] : []))];
  return <div><dt>{label}</dt><dd>{present ? formatMetric(present) : `Missing · ${reasons.join(" / ") || "not collected"}`}</dd></div>;
}

function LaunchLedger({ launch }: { launch: KernelLaunch }) {
  const shape = (value: readonly number[] | null) => value ? value.join(" × ") : "Missing";
  const bytes = (value: number | null) => value === null ? "Missing" : value >= 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${value} B`;
  return (
    <dl className="kernel-launch-grid">
      <Ledger label="Grid" value={shape(launch.grid)} />
      <Ledger label="Block" value={shape(launch.block)} />
      <Ledger label="Registers / thread" value={launch.registersPerThread?.toLocaleString() ?? "Missing"} />
      <Ledger label="Static shared" value={bytes(launch.staticSharedMemoryBytes)} />
      <Ledger label="Dynamic shared" value={bytes(launch.dynamicSharedMemoryBytes)} />
      <Ledger label="Waves / SM" value={launch.wavesPerSm?.toLocaleString(undefined, { maximumFractionDigits: 3 }) ?? "Missing"} />
    </dl>
  );
}
