import { useEffect, useRef, useState } from "react";
import type { TimelineEvent, TimelineRecord } from "../../profiler/domain/types";
import { TimelineTracks } from "./TimelineTracks";

/** One viewport shared by the system preview and the full timeline. */
export function TimelineViewport({ timeline, selectedEventId, onSelect, locale = "zh" }: {
  timeline: TimelineRecord;
  selectedEventId: string | null;
  onSelect: (event: TimelineEvent) => void;
  locale?: "zh" | "en";
}) {
  const [window, setWindow] = useState({ start: 0, span: 1 });
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; start: number; width: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const zh = locale === "zh";
  useEffect(() => { setWindow({ start: 0, span: 1 }); }, [timeline.timelineId]);
  function zoom(factor: number, anchor = 0.5) {
    setWindow((current) => {
      const span = Math.max(1 / 128, Math.min(1, current.span / factor));
      return { span, start: Math.max(0, Math.min(1 - span, current.start + (current.span - span) * anchor)) };
    });
  }
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      const lane = (event.target as Element).closest("svg");
      if (!lane) return;
      event.preventDefault();
      const rect = lane.getBoundingClientRect();
      zoom(Math.exp(-event.deltaY * 0.003), Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  return <div className="timeline-viewport" ref={root}>
    <div className="timeline-viewport-tools">
      <span>{zh ? "图内滚轮缩放 · 拖动平移" : "Scroll to zoom · drag to pan"}</span>
      <button type="button" aria-label={zh ? "缩小时间线" : "Zoom out"} onClick={() => zoom(0.5)}>−</button>
      <output>{(1 / window.span).toFixed(1)}×</output>
      <button type="button" aria-label={zh ? "放大时间线" : "Zoom in"} onClick={() => zoom(2)}>+</button>
      <button type="button" onClick={() => setWindow({ start: 0, span: 1 })}>{zh ? "全览" : "Reset"}</button>
    </div>
    <div className="timeline-pan-surface"
      onPointerDown={(event) => {
        const lane = (event.target as Element).closest("svg");
        if (!lane || event.button !== 0) return;
        suppressClick.current = false;
        drag.current = { x: event.clientX, start: window.start, width: lane.getBoundingClientRect().width, moved: false };
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || !(event.buttons & 1)) return;
        if (Math.abs(event.clientX - current.x) > 3) {
          current.moved = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          setWindow((value) => ({ ...value, start: Math.max(0, Math.min(1 - value.span, current.start - (event.clientX - current.x) / current.width * value.span)) }));
        }
      }}
      onPointerUp={() => { suppressClick.current = drag.current?.moved ?? false; drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onClickCapture={(event) => { if (suppressClick.current) { event.stopPropagation(); suppressClick.current = false; } }}>
      <TimelineTracks timeline={timeline} locale={locale} selectedEventId={selectedEventId} onSelect={onSelect}
        windowStartNs={timeline.window.startNs + window.start * timeline.window.durationNs}
        windowDurationNs={window.span * timeline.window.durationNs} />
    </div>
  </div>;
}
