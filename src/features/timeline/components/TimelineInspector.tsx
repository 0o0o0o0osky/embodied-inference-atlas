import type { RoutePatch, RouteState } from "../../../app/routes";
import { RouteLink } from "../../../components/RouteLink";
import type {
  KernelLaunch,
  NcuWarpTrigger,
  NcuWarpTriggerCriterion,
  ProfilerMetric,
  TelemetryRecord,
} from "../../profiler/domain/types";
import { TENSOR_ACTIVE_METRIC_NAMES } from "../../performance/components/KernelTable";
import { kernelEntity } from "../../workbench/entityKeys";
import type { TimelineViewModel, TimelineWarpSupplement } from "../domain/buildTimelineView";

export function TimelineInspector({
  view,
  route,
  navigate,
  locale = "en",
}: {
  view: TimelineViewModel;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
  locale?: "en" | "zh";
}) {
  const active = view.active;
  if (!active) return null;
  const zh = locale === "zh";
  const event = view.selectedEvent;
  const observation = view.selectedObservation;
  const replay = view.separateReplay;
  const metrics = view.replayMetrics;
  const warpMetrics = view.warpSupplement?.metrics ?? metrics;
  return (
    <aside className="timeline-inspector" aria-labelledby="timeline-inspector-title">
      <header>
        <p>{zh ? "当前 capture 内的选中区间" : "Selected interval / capture-local"}</p>
        <h3 id="timeline-inspector-title">{view.selectedSignature?.labelSanitized ?? event?.label.replaceAll("-", " ") ?? (zh ? "未选择区间" : "No interval selected")}</h3>
        <code>{active.capture.captureId}</code>
      </header>

      {event ? (
        <dl className="timeline-event-ledger">
          <div><dt>{zh ? "轨道" : "Lane"}</dt><dd>{event.laneId}</dd></div>
          <div><dt>{zh ? "证据语义" : "Semantics"}</dt><dd>{humanize(event.evidenceSemantics)}</dd></div>
          <div><dt>{zh ? "起止位置" : "Start / end"}</dt><dd>{formatMs(event.startNs)} / {formatMs(event.startNs + event.durationNs)}</dd></div>
          <div><dt>{zh ? "持续时间" : "Interval duration"}</dt><dd>{formatDuration(event.durationNs)}</dd></div>
        </dl>
      ) : <p className="timeline-inspector-empty">{zh ? "此 capture 没有可选择的区间。" : "This capture has no selectable interval."}</p>}

      {observation ? (
        <section className="timeline-aggregate">
          <div className="timeline-inspector-section-heading">
            <div><p>{zh ? "当前 capture 内的 Nsys 聚合" : "Nsys aggregate / this capture"}</p><h4>{observation.calls.toLocaleString()} {zh ? "次同签名调用" : "matching calls"}</h4></div>
            <strong>{formatDuration(observation.duration.valueNs)}</strong>
          </div>
          <p>
            {observation.durationShare
              ? zh
                ? `占此 capture 的 ${humanize(observation.durationShare.denominator)} 的 ${observation.durationShare.value.toFixed(2)}%。`
                : `${observation.durationShare.value.toFixed(2)}% of this capture's ${humanize(observation.durationShare.denominator)}.`
              : zh ? "此观测未定义时长占比。" : "No duration share is defined on this observation."}
          </p>
          <RouteLink
            route={route}
            patch={{ tab: "roofline-kernels", rooflineLevel: "overview", entity: kernelEntity(observation.captureId, observation.observationId) }}
            navigate={navigate}
          >
            {zh ? "在 Kernel 诊断中查看当前 capture 聚合" : "Open this capture-local row in kernel diagnostics"}
          </RouteLink>
        </section>
      ) : null}

      {replay && view.separateReplayCapture && view.separateReplayRun ? (
        <section className="timeline-replay">
          <div className="timeline-replay-divider">
            <p>{view.separateReplayCapture.ncu?.sectionMode === "scheduler_stats_with_sysmem_sectors"
              ? "SchedulerStats NCU replay · one profiled launch"
              : "Separate NCU replay · one profiled launch"}</p>
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
            <div><dt>Section mode</dt><dd>{humanize(view.separateReplayCapture.ncu?.sectionMode ?? "unknown")}</dd></div>
            <div><dt>NCU sections</dt><dd>{formatDeclaredList(view.separateReplayCapture.ncu?.sections ?? null)}</dd></div>
            <div><dt>Explicit metrics</dt><dd>{formatDeclaredList(view.separateReplayCapture.ncu?.explicitMetrics ?? null)}</dd></div>
            <div><dt>Clock provenance</dt><dd>{view.separateReplayCapture.ncu
              ? `${view.separateReplayCapture.ncu.clockControlRequest} · ${humanize(view.separateReplayCapture.ncu.origins.clockControlRequest ?? "unknown origin")} · ${view.separateReplayCapture.ncu.externalClockControl
                ? `${humanize(view.separateReplayCapture.ncu.externalClockControl.controller)} ${humanize(view.separateReplayCapture.ncu.externalClockControl.state)} · ${humanize(view.separateReplayCapture.ncu.origins.externalClockControl ?? "unknown origin")}`
                : "external clock unknown"}`
              : "Unknown"}</dd></div>
            {view.separateReplayCapture.ncu?.warpTrigger ? <>
              <div><dt>Collection sequence</dt><dd>SchedulerStats first → one WarpStateStats supplemental replay</dd></div>
              <div><dt>Scheduler source</dt><dd>{view.separateReplayCapture.ncu.warpTrigger.schedulerCaptureId} · {view.separateReplayCapture.ncu.warpTrigger.schedulerObservationId} · {humanize(view.separateReplayCapture.ncu.warpTrigger.origin)}</dd></div>
              <div><dt>Observed gate</dt><dd>{formatWarpTriggerCriteria(view.separateReplayCapture.ncu.warpTrigger.criteria)}</dd></div>
              <div><dt>Launch / occupancy review</dt><dd>{formatLaunchOccupancyReview(view.separateReplayCapture.ncu.warpTrigger.launchOccupancyReview)}</dd></div>
            </> : null}
          </dl>
          {view.separateReplayCapture.ncu?.warpTrigger
            ? <p>Stored collection gate only; no bottleneck conclusion is inferred.</p>
            : null}
          <p className="timeline-replay-independence">Same model/runtime/device only. Independent run and operating point; matched signature, not sample.</p>
          <dl className="timeline-metric-grid">
            <MetricValue label="SM throughput" metric={metric(metrics, "sm_throughput_pct_of_peak_sustained_elapsed")} />
            <MetricValue label="Tensor active" metric={preferredMetric(metrics, TENSOR_ACTIVE_METRIC_NAMES)} note="Active-cycle counter preferred; legacy elapsed-cycle counter remains visible" />
            <MetricValue label="Memory SOL" metric={metric(metrics, "memory_sol_pct_of_peak_sustained_elapsed")} />
            <MetricValue label="Memory access throughput" metric={metric(metrics, "memory_access_throughput_pct_of_peak_sustained_elapsed")} />
            <MetricValue label="L1TEX sector hit rate" metric={metric(metrics, "l1tex_sector_hit_rate_percent")} />
            <MetricValue label="Memory request throughput" metric={metric(metrics, "memory_request_throughput_pct_of_peak_sustained_elapsed")} />
            <MetricValue label="L2 sector hit rate" metric={metric(metrics, "l2_sector_hit_rate_percent")} />
            <MetricValue label="Memory pipe throughput" metric={metric(metrics, "memory_pipes_throughput_pct_of_peak_sustained_elapsed")} />
            <MetricValue label="L1 throughput" metric={metric(metrics, "l1_throughput_pct_of_peak_sustained_active")} />
            <MetricValue label="L2 / LTS throughput" metric={metric(metrics, "l2_throughput_pct_of_peak_sustained_elapsed")} />
            <MetricValue label="L2 sysmem fill" metric={metric(metrics, "l2_sysmem_fill_pct_of_peak_sustained_elapsed")} note="Not LPDDR utilization" />
            <MetricValue label="Occupancy achieved" metric={metric(metrics, "achieved_occupancy_percent")} />
            <MetricValue label="Occupancy theoretical" metric={metric(metrics, "theoretical_occupancy_percent")} />
            <MetricValue label="Issued warps / scheduler active cycle" metric={metric(metrics, "scheduler_issue_active_per_active_cycle")} />
            <MetricValue label="One or more eligible" metric={metric(metrics, "scheduler_issue_active_pct_of_peak_sustained_active")} />
            <MetricValue label="No eligible" metric={metric(metrics, "scheduler_issue_inst0_percent")} />
            <MetricValue label="Active warps / active cycle" metric={metric(metrics, "scheduler_active_warps_per_active_cycle")} />
            <MetricValue label="Eligible warps / active cycle" metric={metric(metrics, "scheduler_eligible_warps_per_active_cycle")} />
            <MetricValue label="Maximum warps / active cycle" metric={metric(metrics, "scheduler_maximum_warps_per_active_cycle")} />
            <MetricValue label="Active warps / peak sustained" metric={metric(metrics, "scheduler_warps_active_peak_sustained")} />
            <MetricValue label="L2 sysmem fill sectors" metric={metric(metrics, "l2_sysmem_fill_sectors")} note="Do not add; not LPDDR traffic or utilization" />
            <MetricValue label="L2 sysmem write sectors" metric={metric(metrics, "l2_sysmem_write_sectors")} note="Do not add; not LPDDR traffic or utilization" />
            <MetricValue label="L2 sysmem lookup-miss sectors" metric={metric(metrics, "l2_sysmem_lookup_miss_sectors")} note="Do not add; not LPDDR traffic or utilization" />
            {!view.warpSupplement ? <>
              <MetricValue label="Average warp latency / issued instruction" metric={metric(metrics, "average_warp_latency_cycles_per_issued_instruction")} />
              <MetricValue label="Long scoreboard cycles / issued instruction" metric={metric(metrics, "long_scoreboard_cycles_per_issued_instruction")} />
              <MetricValue label="Short scoreboard cycles / issued instruction" metric={metric(metrics, "short_scoreboard_cycles_per_issued_instruction")} />
            </> : null}
          </dl>
          {view.replayTelemetry.length ? <TelemetryLedger telemetry={view.replayTelemetry} /> : null}
          <LaunchLedger launch={replay.launch} />
          {view.warpSupplement ? <WarpSupplementLedger supplement={view.warpSupplement} /> : null}
          <dl className="timeline-missing-evidence">
            <MissingMetric label="DRAM / system-memory throughput" metrics={[metric(metrics, "system_memory_throughput_pct_of_ceiling")]} />
            <MissingMetric label="DRAM / system-memory bytes" metrics={[metric(metrics, "system_memory_bytes")]} />
            <MissingMetric label="SchedulerStats" metrics={[metric(metrics, "scheduler_issue_active_per_active_cycle"), metric(metrics, "scheduler_issue_active_percent")]} />
            <MissingMetric label="Long scoreboard" metrics={[metric(warpMetrics, "long_scoreboard_cycles_per_issued_instruction"), metric(warpMetrics, "warp_stall_long_scoreboard_percent")]} />
            <MissingMetric label="Short scoreboard" metrics={[metric(warpMetrics, "short_scoreboard_cycles_per_issued_instruction"), metric(warpMetrics, "warp_stall_short_scoreboard_percent")]} />
            <MissingMetric label="SourceCounters attribution" metrics={[metric(metrics, "source_counter_attribution")]} />
          </dl>
          <p className="timeline-diagnosis-boundary">
            Whole-system traffic remains unavailable, so no LPDDR-saturation conclusion is supported. Scheduler and scoreboard counters, when present above, are diagnostic evidence rather than a standalone bottleneck verdict.
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

function WarpSupplementLedger({ supplement }: { supplement: TimelineWarpSupplement }) {
  const trigger = supplement.capture.ncu?.warpTrigger;
  if (!trigger) return null;
  return (
    <div className="timeline-replay-supplement">
      <div className="timeline-replay-divider">
        <p>WarpStateStats supplement · one separately profiled launch</p>
        <h4>{supplement.capture.captureId}</h4>
        <strong>supplemental replay, not an additive duration</strong>
      </div>
      <p className="timeline-replay-basis">
        {formatDuration(supplement.observation.duration.valueNs)} single supplemental replay · reported separately; never added to the SchedulerStats replay
      </p>
      <dl className="timeline-replay-context">
        <div><dt>Independent run</dt><dd><code>{supplement.run.run_id}</code></dd></div>
        <div><dt>Device basis</dt><dd>{supplement.deviceLabel}<small>{supplement.run.device_id}</small></dd></div>
        <div><dt>Operating point</dt><dd>{humanize(supplement.run.operating_point.operating_point_id)}</dd></div>
        <div><dt>Section mode</dt><dd>{humanize(supplement.capture.ncu?.sectionMode ?? "unknown")}</dd></div>
        <div><dt>NCU sections</dt><dd>{formatDeclaredList(supplement.capture.ncu?.sections ?? null)}</dd></div>
        <div><dt>Explicit metrics</dt><dd>{formatDeclaredList(supplement.capture.ncu?.explicitMetrics ?? null)}</dd></div>
        <div><dt>Clock provenance</dt><dd>{supplement.capture.ncu
          ? `${supplement.capture.ncu.clockControlRequest} · ${humanize(supplement.capture.ncu.origins.clockControlRequest ?? "unknown origin")} · ${supplement.capture.ncu.externalClockControl
            ? `${humanize(supplement.capture.ncu.externalClockControl.controller)} ${humanize(supplement.capture.ncu.externalClockControl.state)} · ${humanize(supplement.capture.ncu.origins.externalClockControl ?? "unknown origin")}`
            : "external clock unknown"}`
          : "Unknown"}</dd></div>
        <div><dt>Collection sequence</dt><dd>SchedulerStats first → one WarpStateStats supplemental replay</dd></div>
        <div><dt>Scheduler source</dt><dd>{trigger.schedulerCaptureId} · {trigger.schedulerObservationId} · {humanize(trigger.origin)}</dd></div>
        <div><dt>Observed gate</dt><dd>{formatWarpTriggerCriteria(trigger.criteria)}</dd></div>
        <div><dt>Launch / occupancy review</dt><dd>{formatLaunchOccupancyReview(trigger.launchOccupancyReview)}</dd></div>
      </dl>
      <p>Stored collection gate only; no bottleneck conclusion is inferred.</p>
      <dl className="timeline-metric-grid">
        <MetricValue label="Average warp latency / issued instruction" metric={metric(supplement.metrics, "average_warp_latency_cycles_per_issued_instruction")} />
        <MetricValue label="Long scoreboard cycles / issued instruction" metric={metric(supplement.metrics, "long_scoreboard_cycles_per_issued_instruction")} />
        <MetricValue label="Short scoreboard cycles / issued instruction" metric={metric(supplement.metrics, "short_scoreboard_cycles_per_issued_instruction")} />
      </dl>
      {supplement.telemetry.length ? <TelemetryLedger telemetry={supplement.telemetry} /> : null}
      <LaunchLedger launch={supplement.observation.launch} />
    </div>
  );
}

function metric(metrics: readonly ProfilerMetric[], name: ProfilerMetric["metricName"]) {
  return metrics.find((item) => item.metricName === name) ?? null;
}

function preferredMetric(metrics: readonly ProfilerMetric[], names: readonly ProfilerMetric["metricName"][]) {
  const candidates = names.flatMap((name) => metric(metrics, name) ?? []);
  return candidates.find((item) => item.value !== null) ?? candidates[0] ?? null;
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
    <dl className="timeline-metric-grid">
      {telemetry.map((item) => (
        <div key={item.telemetryId}>
          <dt>{humanize(item.metricName)}</dt>
          <dd>{item.summary
            ? `${item.summary.value.toLocaleString()} ${item.summary.unit}`
            : `Missing · ${humanize(item.missingReason ?? "unknown")}`}</dd>
          <small>{humanize(item.measurementSource ?? "unknown source")}</small>
        </div>
      ))}
    </dl>
  );
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
