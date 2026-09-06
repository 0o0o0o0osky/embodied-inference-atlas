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
  locale = "en",
}: {
  locale?: "en" | "zh";
  timeline: TimelineRecord;
  windowStartNs: number;
  windowDurationNs: number;
  selectedEventId: string | null;
  onSelect: (event: TimelineEvent) => void;
}) {
  const zh = locale === "zh";
  const label = (english: string, chinese: string) => zh ? chinese : english;
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
      label: laneLabel(lane, zh),
      detail: laneDetail(lane, zh),
      events: eventsByLane.get(lane.laneId) ?? [],
      missing: null,
    }));
  if (!zh && timeline.missing.gpu_kernel_lane && !timeline.lanes.some((lane) => lane.kind === "gpu_kernel")) {
    const copyIndex = rows.findIndex((row) => row.lane?.kind === "gpu_memcpy");
    rows.splice(copyIndex < 0 ? rows.length : copyIndex, 0, {
      id: "missing-gpu-kernel-lane",
      lane: null,
      label: label("GPU / kernels", "GPU / Kernel"),
      detail: label("not collected", "未采集"),
      events: [],
      missing: label("Not collected at this trace mode", "此采集模式未记录 Kernel 时间线"),
    });
  }

  return (
    <section className="timeline-tracks" aria-labelledby="timeline-tracks-title">
      <header>
        <div><p>{label("One capture / relative nanoseconds", "同一 capture / 相对时间")}</p><h3 id="timeline-tracks-title">{label("Recorded lanes", "已记录时间线")}</h3></div>
        <span>{timeline.events.length.toLocaleString()} {label("intervals", "个区间")} · {rows.length} {label("lanes", "条轨道")}</span>
      </header>
      <div className="timeline-ruler-row" aria-hidden="true">
        <span>{label("Lane / role", "轨道 / 角色")}</span>
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
        <span className="is-exact">{label("Exact recorded interval", "精确记录区间")}</span>
        <span className="is-envelope">{label("Graph execution envelope", "Graph 执行包络")}</span>
        <span className="is-scheduler">{label("Scheduler-running interval", "调度运行区间")}</span>
        <span className="is-unknown">{label("Unclassified / unknown", "未分类 / 未知")}</span>
        <span className="is-selected">{label("Selected interval", "已选区间")}</span>
        <strong>{label("Unfilled space is unobserved, not idle.", "空白为未观测区间，不代表空闲。")}</strong>
      </div>
    </section>
  );
}

function laneLabel(lane: TimelineLane, zh: boolean) {
  if (lane.kind === "cpu_thread") {
    if (lane.role === "target-main") return zh ? "CPU / 目标主线程" : "CPU / target main";
    if (lane.role === "target-worker") return zh ? `CPU / 工作线程 ${lane.ordinal}` : `CPU / target worker ${lane.ordinal}`;
    return zh ? "CPU / CUDA 事件线程" : "CPU / CUDA event handler";
  }
  if (lane.kind === "cpu_aggregate" && lane.role === "non-profiler-all-processes") return zh ? "CPU / 非 Profiler 汇总" : "CPU / non-profiler aggregate";
  if (lane.role === "profiler-excluded") return zh ? "CPU / 排除 Profiler" : "CPU / profiler excluded";
  if (lane.kind === "cuda_api") return zh ? "CUDA API / 目标" : "CUDA API / target";
  if (lane.kind === "cuda_graph") return zh ? "CUDA Graph / 执行包络" : "CUDA Graph / envelope";
  if (lane.kind === "gpu_kernel") return zh ? "GPU / 已记录 Kernel" : "GPU / recorded kernels";
  if (lane.kind === "gpu_memcpy") return zh ? "GPU / 已记录 copy" : "GPU / recorded copies";
  return zh ? "Profiler / 已排除" : "Profiler / excluded";
}

function eventClass(event: TimelineEvent) {
  if (event.eventKind === "scheduler") return "timeline-event is-scheduler";
  if (event.evidenceSemantics === "cuda_graph_execution_span") return "timeline-event is-envelope";
  if (event.eventKind === "cuda_api") return "timeline-event is-api";
  if (event.eventKind === "kernel" && !event.kernelSignatureId) return "timeline-event is-unknown";
  if (event.eventKind === "kernel") return "timeline-event is-kernel";
  if (event.eventKind === "memcpy") return "timeline-event is-copy";
  if (event.eventKind === "profiler_overhead") return "timeline-event is-profiler";
  return "timeline-event is-exact";
}

function laneDetail(lane: TimelineLane, zh: boolean) {
  if (zh) {
    const coverage = lane.coverage === "partial" ? "部分" : lane.coverage === "complete" ? "完整" : lane.coverage;
    return lane.kind === "cuda_api" ? `API 墙钟区间，非 CPU 调度时长；覆盖：${coverage}` : `覆盖：${coverage}`;
  }
  const coverage = lane.coverage === "partial" ? "partial capture" : lane.coverage;
  return lane.kind === "cuda_api"
    ? `API wall interval · not CPU scheduled execution · coverage: ${coverage}`
    : `coverage: ${coverage}`;
}

function eventAriaLabel(event: TimelineEvent) {
  const kind = event.eventKind === "kernel" && !event.kernelSignatureId ? "unclassified kernel" : event.label.replaceAll("-", " ");
  return `${kind}, ${(event.startNs / 1e6).toFixed(3)} milliseconds, duration ${(event.durationNs / 1e6).toFixed(3)} milliseconds`;
}

function formatRuler(valueNs: number) {
  return `${(valueNs / 1e6).toFixed(valueNs % 1e6 === 0 ? 0 : 1)} ms`;
}
