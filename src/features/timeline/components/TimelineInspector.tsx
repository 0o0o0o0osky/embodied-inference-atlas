import type { RoutePatch, RouteState } from "../../../app/routes";
import { RouteLink } from "../../../components/RouteLink";
import type { KernelLaunch, ProfilerMetric } from "../../profiler/domain/types";
import { kernelEntity } from "../../workbench/entityKeys";
import type { TimelineViewModel } from "../domain/buildTimelineView";

export function TimelineInspector({
  view,
  route,
  navigate,
}: {
  view: TimelineViewModel;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}) {
  const active = view.active;
  if (!active) return null;
  const event = view.selectedEvent;
  const observation = view.selectedObservation;
  const replay = view.separateReplay;
  const metrics = view.replayMetrics;
  return (
    <aside className="timeline-inspector" aria-labelledby="timeline-inspector-title">
      <header>
        <p>Selected interval / capture-local</p>
        <h3 id="timeline-inspector-title">{view.selectedSignature?.labelSanitized ?? event?.label.replaceAll("-", " ") ?? "No interval selected"}</h3>
        <code>{active.capture.captureId}</code>
      </header>

      {event ? (
        <dl className="timeline-event-ledger">
          <div><dt>Lane</dt><dd>{event.laneId}</dd></div>
          <div><dt>Semantics</dt><dd>{humanize(event.evidenceSemantics)}</dd></div>
          <div><dt>Start / end</dt><dd>{formatMs(event.startNs)} / {formatMs(event.startNs + event.durationNs)}</dd></div>
          <div><dt>Interval duration</dt><dd>{formatDuration(event.durationNs)}</dd></div>
        </dl>
      ) : <p className="timeline-inspector-empty">This capture has no selectable interval.</p>}

      {observation ? (
        <section className="timeline-aggregate">
          <div className="timeline-inspector-section-heading">
            <div><p>Nsys aggregate / this capture</p><h4>{observation.calls.toLocaleString()} matching calls</h4></div>
            <strong>{formatDuration(observation.duration.valueNs)}</strong>
          </div>
          <p>
            {observation.durationShare
              ? `${observation.durationShare.value.toFixed(2)}% of this capture's ${humanize(observation.durationShare.denominator)}.`
              : "No duration share is defined on this observation."}
          </p>
          <RouteLink
            route={route}
            patch={{ tab: "roofline-kernels", rooflineLevel: "overview", entity: kernelEntity(observation.captureId, observation.observationId) }}
            navigate={navigate}
          >
            Open this capture-local row in kernel diagnostics
          </RouteLink>
        </section>
      ) : null}

      {replay && view.separateReplayCapture && view.separateReplayRun ? (
        <section className="timeline-replay">
          <div className="timeline-replay-divider">
            <p>Separate NCU replay · one profiled launch</p>
            <h4>{view.selectedSignature?.labelSanitized}</h4>
            <strong>matched signature, not matched sample</strong>
          </div>
          <p className="timeline-replay-basis">
            {formatDuration(replay.duration.valueNs)} single replay · no Nsys share or end-to-end meaning · {humanize(view.separateReplayCapture.selectionPolicy)}
          </p>
          <dl className="timeline-replay-context">
            <div><dt>Independent run</dt><dd><code>{view.separateReplayRun.run_id}</code></dd></div>
            <div><dt>Device basis</dt><dd>{view.separateReplayDeviceLabel}<small>{view.separateReplayRun.device_id}</small></dd></div>
            <div><dt>Operating point</dt><dd>{humanize(view.separateReplayRun.operating_point.operating_point_id)}</dd></div>
          </dl>
          <p className="timeline-replay-independence">Same model/runtime/device only. Independent run and operating point; matched signature, not sample.</p>
          <dl className="timeline-metric-grid">
            <MetricValue label="SM throughput" metric={metric(metrics, "sm_throughput_pct_of_peak_sustained_elapsed")} />
            <MetricValue label="Tensor active" metric={metric(metrics, "tensor_cycles_active_pct_of_peak_sustained_elapsed")} />
            <MetricValue label="Memory SOL" metric={metric(metrics, "memory_sol_pct_of_peak_sustained_elapsed")} />
            <MetricValue label="L1 throughput" metric={metric(metrics, "l1_throughput_pct_of_peak_sustained_active")} />
            <MetricValue label="L2 / LTS throughput" metric={metric(metrics, "l2_throughput_pct_of_peak_sustained_elapsed")} />
            <MetricValue label="L2 sysmem fill" metric={metric(metrics, "l2_sysmem_fill_pct_of_peak_sustained_elapsed")} note="Not LPDDR utilization" />
            <MetricValue label="Occupancy achieved" metric={metric(metrics, "achieved_occupancy_percent")} />
            <MetricValue label="Occupancy theoretical" metric={metric(metrics, "theoretical_occupancy_percent")} />
          </dl>
          <LaunchLedger launch={replay.launch} />
          <dl className="timeline-missing-evidence">
            <MissingMetric label="DRAM / system-memory throughput" metrics={[metric(metrics, "system_memory_throughput_pct_of_ceiling")]} />
            <MissingMetric label="DRAM / system-memory bytes" metrics={[metric(metrics, "system_memory_bytes")]} />
            <MissingMetric label="SchedulerStats" metrics={[metric(metrics, "scheduler_issue_active_percent")]} />
            <MissingMetric label="Long scoreboard" metrics={[metric(metrics, "warp_stall_long_scoreboard_percent")]} />
            <MissingMetric label="Short scoreboard" metrics={[metric(metrics, "warp_stall_short_scoreboard_percent")]} />
            <MissingMetric label="SourceCounters attribution" metrics={[metric(metrics, "source_counter_attribution")]} />
          </dl>
          <p className="timeline-diagnosis-boundary">
            Missing whole-system traffic and scheduler/stall evidence prevents a compute-bound, memory-bound, LPDDR-saturation, or stall-cause diagnosis.
          </p>
          <details>
            <summary>Metric identity and provenance</summary>
            <ul>
              {metrics.map((item) => (
                <li key={item.metricId}>
                  <strong>{humanize(item.metricName)}</strong>
                  <code>{item.rawCounterName ?? "no raw counter"}</code>
                  <span>{humanize(item.statistic)} · {item.unit} · {item.sectionName} · {item.basis} · {item.confidence} confidence · {item.missingReason ?? "observed"}</span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : event?.eventKind === "kernel" ? (
        <p className="timeline-inspector-empty"><strong>No reviewed signature match.</strong> The interval remains unclassified and no NCU diagnostic replay is attached.</p>
      ) : null}
    </aside>
  );
}

function metric(metrics: readonly ProfilerMetric[], name: ProfilerMetric["metricName"]) {
  return metrics.find((item) => item.metricName === name) ?? null;
}

function MetricValue({ label, metric: item, note }: { label: string; metric: ProfilerMetric | null; note?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{item?.value === null || !item ? `Missing · ${humanize(item?.missingReason ?? "not collected")}` : formatMetric(item)}</dd>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function MissingMetric({ label, metrics }: { label: string; metrics: readonly (ProfilerMetric | null)[] }) {
  const present = metrics.find((item): item is ProfilerMetric => item !== null && item.value !== null);
  const reasons = [...new Set(metrics.map((item) => item?.missingReason).filter((value): value is string => Boolean(value)))];
  return (
    <div>
      <dt>{label}</dt>
      <dd>{present ? formatMetric(present) : `Missing · ${reasons.map(humanize).join(" / ") || "not collected"}`}</dd>
    </div>
  );
}

function LaunchLedger({ launch }: { launch: KernelLaunch }) {
  const shape = (value: readonly number[] | null) => value ? value.join(" × ") : "Missing";
  return (
    <dl className="timeline-launch-ledger">
      <div><dt>Grid</dt><dd>{shape(launch.grid)}</dd></div>
      <div><dt>Block</dt><dd>{shape(launch.block)}</dd></div>
      <div><dt>Registers / thread</dt><dd>{launch.registersPerThread ?? "Missing"}</dd></div>
      <div><dt>Dynamic shared</dt><dd>{launch.dynamicSharedMemoryBytes === null ? "Missing" : formatBytes(launch.dynamicSharedMemoryBytes)}</dd></div>
    </dl>
  );
}

function formatMetric(metric: ProfilerMetric) {
  if (metric.value === null) return `Missing · ${humanize(metric.missingReason ?? "not collected")}`;
  if (metric.unit === "percent") return `${metric.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  if (metric.unit === "hz") return `${(metric.value / 1e9).toFixed(3)} GHz`;
  return `${metric.value.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${metric.unit}`;
}

function formatDuration(valueNs: number) {
  if (valueNs >= 1e6) return `${(valueNs / 1e6).toFixed(3)} ms`;
  if (valueNs >= 1e3) return `${(valueNs / 1e3).toFixed(3)} µs`;
  return `${valueNs} ns`;
}

function formatMs(valueNs: number) {
  return `${(valueNs / 1e6).toFixed(3)} ms`;
}

function formatBytes(value: number) {
  return value >= 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${value} B`;
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}
