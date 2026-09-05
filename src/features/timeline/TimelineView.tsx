import { useEffect, useMemo, useState } from "react";

import type { RoutePatch, RouteState } from "../../app/routes";
import type { AtlasData, ModelRecord } from "../../types/atlas";
import { adaptProfilerEvidence } from "../profiler/domain/adaptProfilerEvidence";
import { indexProfilerEvidence } from "../profiler/domain/indexProfilerEvidence";
import { timelineEventEntity } from "../workbench/entityKeys";
import { TimelineInspector } from "./components/TimelineInspector";
import { TimelineToolbar } from "./components/TimelineToolbar";
import { TimelineTracks } from "./components/TimelineTracks";
import { buildTimelineView } from "./domain/buildTimelineView";

interface TimelineViewProps {
  data: AtlasData;
  model: ModelRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

export function TimelineView({ data, model, route, navigate }: TimelineViewProps) {
  const evidence = useMemo(() => adaptProfilerEvidence(data), [data]);
  const index = useMemo(() => indexProfilerEvidence(evidence), [evidence]);
  const view = useMemo(() => buildTimelineView(data, evidence, index, {
    modelId: model.model_id,
    runtimeId: route.runtime,
    hardwareId: route.hardware,
    captureId: route.timelineCapture,
    entity: route.entity,
  }), [data, evidence, index, model.model_id, route.entity, route.hardware, route.runtime, route.timelineCapture]);
  const [zoom, setZoom] = useState(1);
  const [panPercent, setPanPercent] = useState(0);
  const captureId = view.active?.capture.captureId ?? null;

  useEffect(() => {
    setZoom(1);
    setPanPercent(0);
  }, [captureId]);

  if (!view.active) {
    return (
      <section className="timeline-empty" aria-labelledby="timeline-empty-title">
        <p>Single-capture evidence boundary</p>
        <h2 id="timeline-empty-title">Timeline unavailable</h2>
        <span>{view.unavailableReason}</span>
        <strong>No capture, interval, or CPU/GPU arithmetic is borrowed from another runtime or model.</strong>
      </section>
    );
  }

  const timeline = view.active.timeline;
  const windowDurationNs = timeline.window.durationNs / zoom;
  const maximumStart = timeline.window.durationNs - windowDurationNs;
  const windowStartNs = timeline.window.startNs + maximumStart * (panPercent / 100);
  return (
    <section className="timeline-workspace" aria-labelledby="timeline-title">
      <header className="timeline-intro">
        <div>
          <p>Sanitized Nsys evidence / exactly one capture</p>
          <h2 id="timeline-title">Prediction timing instrument</h2>
          <span>Intervals share one relative target window. Graph traces show execution envelopes; node traces show recorded kernel/copy activity. Neither is labeled as complete GPU busy time.</span>
        </div>
        <dl>
          <div><dt>Nsys captures</dt><dd>{view.options.length}</dd></div>
          <div><dt>Window</dt><dd>{formatDuration(timeline.window.durationNs)}</dd></div>
          <div><dt>Intervals</dt><dd>{timeline.events.length.toLocaleString()}</dd></div>
        </dl>
      </header>

      {view.requestedCaptureUnavailable ? (
        <p className="timeline-route-warning" role="status">The requested timeline capture is outside the active model/runtime/hardware scope. The default compatible capture is shown without rewriting the URL.</p>
      ) : null}

      <TimelineToolbar
        view={view}
        zoom={zoom}
        panPercent={panPercent}
        windowStartNs={windowStartNs}
        windowDurationNs={windowDurationNs}
        onCapture={(nextCaptureId) => navigate({ timelineCapture: nextCaptureId, entity: null })}
        onZoom={(nextZoom) => {
          setZoom(nextZoom);
          setPanPercent(nextZoom === 1 ? 0 : panPercent);
        }}
        onPan={setPanPercent}
      />

      <div className="timeline-analysis-grid">
        <div className="timeline-primary-column">
          <TimelineTracks
            timeline={timeline}
            windowStartNs={windowStartNs}
            windowDurationNs={windowDurationNs}
            selectedEventId={view.selectedEvent?.eventId ?? null}
            onSelect={(event) => navigate({ entity: timelineEventEntity(timeline.timelineId, event.eventId) }, true)}
          />
          <TimelineSummary view={view} />
        </div>
        <TimelineInspector view={view} route={route} navigate={navigate} />
      </div>
    </section>
  );
}

function TimelineSummary({ view }: { view: ReturnType<typeof buildTimelineView> }) {
  const active = view.active!;
  const summary = (name: string) => view.summariesByName.get(name) ?? null;
  const node = active.capture.nsys?.reportMode === "node";
  const records = node ? [
    ["Recorded kernel + copy union", summary("recorded_gpu_activity_union"), "represented activity; not all GPU busy"],
    ["Target scheduled core-time overlap", summary("target_scheduled_core_time_overlapping_recorded_gpu_activity"), "per-thread scheduled time; may exceed wall overlap"],
    ["Target wall overlap", summary("target_wall_overlap_with_recorded_gpu_activity"), "wall union intersected with represented activity"],
    ["Target scheduled core-time / window", summary("target_scheduled_core_time_over_full_window"), "scheduler-running evidence; not useful-work or idle proof"],
  ] as const : [
    ["CUDA Graph execution span", summary("cuda_graph_span_union"), "execution envelope; not GPU busy"],
    ["Target scheduled core-time overlap", summary("target_scheduled_core_time_overlapping_graph_spans"), "scheduler-running time during graph envelopes"],
    ["Recorded copy activity union", summary("recorded_copy_activity_union"), "copy intervals only; no kernel union at this trace mode"],
    ["Outside graph envelopes", summary("outside_graph_span_union"), "unobserved / unknown; not idle"],
  ] as const;
  const systemWide = active.capture.nsys?.schedulerScope === "system_wide";
  return (
    <section className="timeline-summary" aria-labelledby="timeline-summary-title">
      <header><div><p>Same-capture interval summaries</p><h3 id="timeline-summary-title">Overlap ledger</h3></div><span>No cross-capture arithmetic</span></header>
      <dl>
        {records.map(([label, item, note]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{item ? formatSummary(item.value, item.unit) : "Not available"}</dd>
            <small>{note}</small>
          </div>
        ))}
        {systemWide ? <>
          <div><dt>Non-profiler scheduled cores</dt><dd>{formatOptionalSummary(summary("non_profiler_equivalent_scheduled_cores_during_graph_spans"), "cores")}</dd><small>equivalent scheduled cores during graph spans; not headroom</small></div>
          <div><dt>Observed scheduled capacity share</dt><dd>{formatOptionalSummary(summary("non_profiler_scheduled_capacity_share_during_graph_spans"), "percent")}</dd><small>of 14-core capacity during graph spans</small></div>
        </> : null}
      </dl>
      {view.kernelCoverage ? (
        <p className="timeline-coverage-note">
          <strong>{view.kernelCoverage.classifiedLaunches.toLocaleString()} / {view.kernelCoverage.totalLaunches.toLocaleString()} kernel launches classified</strong>
          <span>{formatDuration(view.kernelCoverage.classifiedDurationNs)} classified ({((view.kernelCoverage.classifiedDurationNs / view.kernelCoverage.totalDurationNs) * 100).toFixed(2)}% duration); {view.kernelCoverage.unclassifiedLaunches.toLocaleString()} launches / {formatDuration(view.kernelCoverage.unclassifiedDurationNs)} remain unclassified.</span>
        </p>
      ) : null}
    </section>
  );
}

function formatOptionalSummary(item: { value: number; unit: string } | null, fallbackUnit: string) {
  return item ? formatSummary(item.value, item.unit || fallbackUnit) : "Not available";
}

function formatSummary(value: number, unit: string) {
  if (unit === "ns") return formatDuration(value);
  if (unit === "percent") return `${value.toFixed(2)}%`;
  if (unit === "cores") return `${value.toFixed(3)} cores`;
  return `${value}`;
}

function formatDuration(valueNs: number) {
  if (valueNs >= 1e6) return `${(valueNs / 1e6).toFixed(3)} ms`;
  if (valueNs >= 1e3) return `${(valueNs / 1e3).toFixed(3)} µs`;
  return `${valueNs.toFixed(0)} ns`;
}
