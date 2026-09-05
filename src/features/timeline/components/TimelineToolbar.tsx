import type { TimelineViewModel } from "../domain/buildTimelineView";

export function TimelineToolbar({
  view,
  locale = "en",
  zoom,
  panPercent,
  windowStartNs,
  windowDurationNs,
  onCapture,
  onZoom,
  onPan,
}: {
  view: TimelineViewModel;
  locale?: "en" | "zh";
  zoom: number;
  panPercent: number;
  windowStartNs: number;
  windowDurationNs: number;
  onCapture: (captureId: string) => void;
  onZoom: (zoom: number) => void;
  onPan: (percent: number) => void;
}) {
  const active = view.active;
  if (!active) return null;
  const zh = locale === "zh";
  const endNs = windowStartNs + windowDurationNs;
  const captureSelect = (
    <label className="timeline-capture-select">
      <span>{zh ? "采集记录" : "Nsys capture"}</span>
      <select value={active.capture.captureId} onChange={(event) => onCapture(event.target.value)}>
        {view.options.map((option) => (
          <option key={option.capture.captureId} value={option.capture.captureId}>{zh ? captureLabel(option.label) : option.label}</option>
        ))}
      </select>
    </label>
  );
  const captureBasis = (
    <div className="timeline-capture-basis">
      <strong>{zh ? captureLabel(active.label) : active.label}</strong>
      <code>{active.capture.captureId}</code>
      <span>{zh ? basisLabel(active.basisLabel) : active.basisLabel}</span>
      {active.timelineRecordCount > 1 ? (
        <small>{zh
          ? `此 capture ID 对应 ${active.timelineRecordCount} 条时间线记录；当前按确定性顺序显示第一条 canonical timeline。`
          : `${active.timelineRecordCount} timeline records share this capture ID; showing the first canonical timeline ID deterministically.`}</small>
      ) : null}
    </div>
  );
  return (
    <section className={`timeline-toolbar ${zh ? "is-pi0" : ""}`} aria-label={zh ? "时间线采集与视窗控制" : "Timeline capture and viewport controls"}>
      {zh ? (
        <div className="timeline-capture-control">
          {captureSelect}
          <details className="timeline-capture-details">
            <summary>查看采集依据</summary>
            {captureBasis}
          </details>
        </div>
      ) : <>{captureSelect}{captureBasis}</>}
      <fieldset className="timeline-window-controls">
        <legend>{zh ? "视窗缩放" : "Visible window"}</legend>
        <div>
          {[1, 2, 4, 8].map((level) => (
            <button key={level} type="button" aria-pressed={zoom === level} onClick={() => onZoom(level)}>{level}×</button>
          ))}
          <output>{formatMs(windowStartNs)}–{formatMs(endNs)}</output>
        </div>
        <label>
          <span>{zh ? "视窗位置" : "Window position"}</span>
          <input type="range" min="0" max="100" step="1" value={panPercent} disabled={zoom === 1} onChange={(event) => onPan(Number(event.target.value))} />
        </label>
      </fieldset>
      <div className={`timeline-capture-warning ${active.capture.warnings.includes("intrusive_node_trace") ? "is-intrusive" : ""}`} role="status">
        <strong>{active.capture.warnings.includes("intrusive_node_trace")
          ? zh ? "侵入式采集" : "Intrusive capture"
          : zh ? "采集边界" : "Capture boundary"}</strong>
        <span>{warningCopy(active.capture.warnings, active.capture.nsys?.reportMode ?? "graph", locale)}</span>
      </div>
    </section>
  );
}

function warningCopy(warnings: readonly string[], mode: "graph" | "node", locale: "en" | "zh") {
  const zh = locale === "zh";
  if (warnings.includes("intrusive_node_trace")) {
    return zh
      ? "节点追踪会扰动时序；已记录的精确 Kernel / copy 区间不能替代侵入性更低的 Graph 基线。"
      : "Node tracing perturbs timing. Exact recorded kernel/copy intervals do not replace the less-intrusive graph baseline.";
  }
  if (warnings.includes("profiler_scheduler_activity_present")) {
    return zh
      ? "Profiler 调度活动保持排除；Graph 跨度仍是执行包络，不等于 GPU 忙碌时间。"
      : "Profiler scheduler activity is kept excluded; Graph spans remain execution envelopes, not GPU busy time.";
  }
  return mode === "graph"
    ? zh
      ? "CUDA Graph 跨度是执行包络；包络外仅记录 copy 活动。"
      : "CUDA Graph spans are execution envelopes. Only copy activity is recorded outside those envelopes."
    : zh ? "这里只显示采集所覆盖的活动。" : "Only represented activity is shown.";
}

function captureLabel(label: string) {
  if (label === "Intrusive node trace") return "侵入式节点追踪";
  if (label === "Graph-envelope trace") return "Graph 包络追踪";
  if (label === "System-wide scheduler trace") return "全系统调度追踪";
  return label;
}

function basisLabel(label: string) {
  return label
    .replace("relative to target window start", "相对目标窗口起点")
    .replace("exact kernel and copy intervals", "精确 Kernel 与 copy 区间")
    .replace("graph execution envelopes and copy intervals", "Graph 执行包络与 copy 区间")
    .replace("system-wide scheduler-running intervals", "全系统调度运行区间");
}

function formatMs(valueNs: number) {
  return `${(valueNs / 1e6).toFixed(valueNs >= 1e7 ? 1 : 2)} ms`;
}
