import { useEffect, useRef, useState } from "react";
import type { TimelineEvent, TimelineRecord } from "../../profiler/domain/types";
import { clipInterval, interval } from "../../profiler/domain/intervals";
import { eventTitle, laneTitle, timeLabel } from "./timelineLabels";

const groups = [
  { id: "gpu", title: "GPU 执行阶段", kinds: ["cuda_graph"], open: true },
  { id: "cpu", title: "CPU 线程 · 调度运行", kinds: ["cpu_thread", "cpu_aggregate"], open: false },
  { id: "api", title: "CUDA API · 主机调用", kinds: ["cuda_api"], open: false },
  { id: "copy", title: "数据传输", kinds: ["gpu_memcpy"], open: false },
  { id: "kernel", title: "历史逐 Kernel 记录", kinds: ["gpu_kernel"], open: false },
  { id: "profiler", title: "采集器 · 已排除", kinds: ["profiler_overhead"], open: false },
];

export function TimelineTracks({ timeline, windowStartNs, windowDurationNs, selectedEventId, onSelect }: {
  locale?: "en" | "zh";
  timeline: TimelineRecord;
  windowStartNs: number;
  windowDurationNs: number;
  selectedEventId: string | null;
  onSelect: (event: TimelineEvent) => void;
}) {
  const ruler = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    if (!ruler.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(Math.max(1, entry.contentRect.width)); });
    observer.observe(ruler.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!selectedEventId) return;
    const laneId = timeline.events.find((event) => event.eventId === selectedEventId)?.laneId;
    const row = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-lane-id]") ?? []).find((element) => element.dataset.laneId === laneId);
    const group = row?.closest("details");
    if (group) group.open = true;
  }, [selectedEventId, timeline]);
  const bounds = { startNs: windowStartNs, endNs: windowStartNs + windowDurationNs };
  const lanes = [...timeline.lanes].sort((a, b) => a.ordinal - b.ordinal);
  const eventsByLane = new Map<string, TimelineEvent[]>();
  for (const event of timeline.events) {
    const events = eventsByLane.get(event.laneId) ?? [];
    events.push(event);
    eventsByLane.set(event.laneId, events);
  }
  return <section ref={root} className="timeline-tracks timeline-grouped" aria-label="分组系统时间线">
    <div className="timeline-ruler-row">
      <span>预测窗口 · 相对时间</span>
      <div ref={ruler}><svg viewBox={`0 0 ${width} 34`} aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => <g key={i}>
          <line x1={i * width / 5} x2={i * width / 5} y1={22} y2={34} />
          <text x={i * width / 5} y={16} textAnchor={i === 0 ? "start" : i === 5 ? "end" : "middle"}>
            {((windowStartNs + windowDurationNs * i / 5) / 1e6).toFixed(1)} ms
          </text>
        </g>)}
      </svg></div>
    </div>
    {groups.map((group) => {
      const members = lanes.filter((lane) => group.kinds.includes(lane.kind));
      if (!members.length || (group.id === "profiler" && !members.some((lane) => eventsByLane.has(lane.laneId)))) return null;
      return <details className="timeline-track-group" key={`${timeline.timelineId}/${group.id}`} open={group.open || undefined}>
        <summary><strong>{group.title}</strong><span>{members.length} 条轨道</span></summary>
        {members.map((lane) => <div className="timeline-lane-row" key={lane.laneId} data-lane-id={lane.laneId}>
          <div className="timeline-lane-label"><strong>{laneTitle(lane)}</strong>
            <span>{lane.coverage === "partial" ? "部分记录" : lane.kind === "cpu_thread" ? "已记录的调度片段" : lane.kind === "cuda_api" ? "调用持续时间，包含等待" : "点击区间查看详情"}</span>
          </div>
          <svg viewBox={`0 0 ${width} 44`} aria-label={`${laneTitle(lane)}时间轨道`}>
            {Array.from({ length: 6 }, (_, i) => <line className="timeline-grid-line" key={i} x1={i * width / 5} x2={i * width / 5} y1={0} y2={44} />)}
            {(eventsByLane.get(lane.laneId) ?? []).map((event) => {
              const clipped = clipInterval(interval(event.startNs, event.durationNs), bounds);
              if (!clipped) return null;
              const x = (clipped.startNs - bounds.startNs) / windowDurationNs * width;
              const w = (clipped.endNs - clipped.startNs) / windowDurationNs * width;
              const title = eventTitle(event);
              const duration = timeLabel(event.durationNs);
              const fullLabel = `${title} · ${duration}`;
              const fits = (text: string) => Array.from(text).reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 13 : 7), 0) + 16 < w;
              return <g key={event.eventId}>
                <rect className={`timeline-event is-${lane.kind} ${event.label === "vision-graph" ? "is-vision" : ""} ${event.eventId === selectedEventId ? "is-selected" : ""}`}
                  x={Math.min(x, width - 1)} y={6} width={Math.min(Math.max(w, 1), width - Math.min(x, width - 1))} height={32} rx={3} role="button" tabIndex={0}
                  aria-label={`${title}，开始 ${timeLabel(event.startNs)}，持续 ${duration}`}
                  onClick={() => onSelect(event)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(event); } }}>
                  <title>{fullLabel}</title>
                </rect>
                {fits(title) ? <text className="timeline-slice-label" x={x + 8} y={26}>{fits(fullLabel) ? fullLabel : title}</text> : null}
              </g>;
            })}
          </svg>
        </div>)}
      </details>;
    })}
    <p className="timeline-evidence-note">Graph 色块表示执行起止范围，并非持续满载；空白不代表空闲。分组用于浏览，不表示函数调用关系。</p>
  </section>;
}
