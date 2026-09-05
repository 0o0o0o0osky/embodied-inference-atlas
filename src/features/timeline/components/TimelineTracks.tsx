import type { TimelineEvent, TimelineLane, TimelineRecord } from "../../profiler/domain/types";
import { clipInterval, interval } from "../../profiler/domain/intervals";

interface TrackRow {
  id: string;
  lane: TimelineLane | null;
  label: string;
  detail: string;
  events: readonly TimelineEvent[];
  missing: string | null;
}

export function TimelineTracks({
  timeline,
  windowStartNs,
  windowDurationNs,
  selectedEventId,
  onSelect,
}: {
  timeline: TimelineRecord;
  windowStartNs: number;
  windowDurationNs: number;
  selectedEventId: string | null;
  onSelect: (event: TimelineEvent) => void;
}) {
  const bounds = { startNs: windowStartNs, endNs: windowStartNs + windowDurationNs };
  const eventsByLane = new Map<string, TimelineEvent[]>();
  timeline.events.forEach((event) => {
    const values = eventsByLane.get(event.laneId) ?? [];
    values.push(event);
    eventsByLane.set(event.laneId, values);
  });
  eventsByLane.forEach((events) => events.sort((left, right) => left.startNs - right.startNs || left.eventId.localeCompare(right.eventId)));
  const rows: TrackRow[] = [...timeline.lanes]
    .sort((left, right) => left.ordinal - right.ordinal || left.laneId.localeCompare(right.laneId))
    .map((lane) => ({
      id: lane.laneId,
      lane,
      label: laneLabel(lane),
      detail: lane.coverage === "partial" ? "partial capture" : lane.coverage,
      events: eventsByLane.get(lane.laneId) ?? [],
      missing: null,
    }));
  if (timeline.missing.gpu_kernel_lane && !timeline.lanes.some((lane) => lane.kind === "gpu_kernel")) {
    const copyIndex = rows.findIndex((row) => row.lane?.kind === "gpu_memcpy");
    rows.splice(copyIndex < 0 ? rows.length : copyIndex, 0, {
      id: "missing-gpu-kernel-lane",
      lane: null,
      label: "GPU / kernels",
      detail: "not collected",
      events: [],
      missing: "Not collected at this trace mode",
    });
  }

  return (
    <section className="timeline-tracks" aria-labelledby="timeline-tracks-title">
      <header>
        <div><p>One capture / relative nanoseconds</p><h3 id="timeline-tracks-title">Recorded lanes</h3></div>
        <span>{timeline.events.length.toLocaleString()} intervals · {rows.length} lanes</span>
      </header>
      <div className="timeline-ruler-row" aria-hidden="true">
        <span>Lane / role</span>
        <svg viewBox="0 0 1000 34" preserveAspectRatio="none">
          {Array.from({ length: 6 }, (_, index) => {
            const x = index * 200;
            const value = windowStartNs + (windowDurationNs * index) / 5;
            return <g key={index}><line x1={x} y1="17" x2={x} y2="34" /><text x={x} y="12" textAnchor={index === 0 ? "start" : index === 5 ? "end" : "middle"}>{formatRuler(value)}</text></g>;
          })}
        </svg>
      </div>
      <div className="timeline-lane-list">
        {rows.map((row) => (
          <div className={`timeline-lane-row ${row.missing ? "is-missing" : ""}`} key={row.id}>
            <div className="timeline-lane-label">
              <strong>{row.label}</strong>
              <span>{row.detail}</span>
            </div>
            <svg viewBox="0 0 1000 34" preserveAspectRatio="none" aria-label={`${row.label} timing lane`}>
              <line className="timeline-lane-rule" x1="0" y1="17" x2="1000" y2="17" />
              {row.missing ? <text className="timeline-missing-label" x="16" y="22">{row.missing}</text> : null}
              {row.events.flatMap((event) => {
                const clipped = clipInterval(interval(event.startNs, event.durationNs), bounds);
                if (!clipped) return [];
                const x = ((clipped.startNs - bounds.startNs) / windowDurationNs) * 1000;
                const width = ((clipped.endNs - clipped.startNs) / windowDurationNs) * 1000;
                const selected = event.eventId === selectedEventId;
                return [
                  <rect
                    key={`${timeline.timelineId}/${row.id}/${event.eventId}`}
                    className={`${eventClass(event)} ${selected ? "is-selected" : ""}`}
                    x={x}
                    y={selected ? 5 : 8}
                    width={Math.max(width, 0.18)}
                    height={selected ? 24 : 18}
                    vectorEffect="non-scaling-stroke"
                    role="button"
                    tabIndex={0}
                    aria-label={eventAriaLabel(event)}
                    onClick={() => onSelect(event)}
                    onKeyDown={(keyboardEvent) => {
                      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
                        keyboardEvent.preventDefault();
                        onSelect(event);
                      }
                    }}
                  />,
                ];
              })}
            </svg>
          </div>
        ))}
      </div>
      <div className="timeline-legend" aria-label="Timeline evidence legend">
        <span className="is-exact">Exact recorded interval</span>
        <span className="is-envelope">Graph execution envelope</span>
        <span className="is-scheduler">Scheduler-running interval</span>
        <span className="is-unknown">Unclassified / unknown</span>
        <strong>Unfilled space is unobserved, not idle.</strong>
      </div>
    </section>
  );
}

function laneLabel(lane: TimelineLane) {
  if (lane.kind === "cpu_thread") {
    if (lane.role === "target-main") return "CPU / target main";
    if (lane.role === "target-worker") return `CPU / target worker ${lane.ordinal}`;
    return "CPU / CUDA event handler";
  }
  if (lane.kind === "cpu_aggregate" && lane.role === "non-profiler-all-processes") return "CPU / non-profiler aggregate";
  if (lane.role === "profiler-excluded") return "CPU / profiler excluded";
  if (lane.kind === "cuda_api") return "CUDA API / target";
  if (lane.kind === "cuda_graph") return "CUDA Graph / envelope";
  if (lane.kind === "gpu_kernel") return "GPU / recorded kernels";
  if (lane.kind === "gpu_memcpy") return "GPU / recorded copies";
  return "Profiler / excluded";
}

function eventClass(event: TimelineEvent) {
  if (event.eventKind === "scheduler") return "timeline-event is-scheduler";
  if (event.evidenceSemantics === "cuda_graph_execution_span") return "timeline-event is-envelope";
  if (event.eventKind === "kernel" && !event.kernelSignatureId) return "timeline-event is-unknown";
  if (event.eventKind === "kernel") return "timeline-event is-kernel";
  if (event.eventKind === "memcpy") return "timeline-event is-copy";
  if (event.eventKind === "profiler_overhead") return "timeline-event is-profiler";
  return "timeline-event is-exact";
}

function eventAriaLabel(event: TimelineEvent) {
  const kind = event.eventKind === "kernel" && !event.kernelSignatureId ? "unclassified kernel" : event.label.replaceAll("-", " ");
  return `${kind}, ${(event.startNs / 1e6).toFixed(3)} milliseconds, duration ${(event.durationNs / 1e6).toFixed(3)} milliseconds`;
}

function formatRuler(valueNs: number) {
  return `${(valueNs / 1e6).toFixed(valueNs % 1e6 === 0 ? 0 : 1)} ms`;
}
