import type { TimelineViewModel } from "../domain/buildTimelineView";

export function TimelineToolbar({
  view,
  zoom,
  panPercent,
  windowStartNs,
  windowDurationNs,
  onCapture,
  onZoom,
  onPan,
}: {
  view: TimelineViewModel;
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
  const endNs = windowStartNs + windowDurationNs;
  return (
    <section className="timeline-toolbar" aria-label="Timeline capture and viewport controls">
      <label className="timeline-capture-select">
        <span>Nsys capture</span>
        <select value={active.capture.captureId} onChange={(event) => onCapture(event.target.value)}>
          {view.options.map((option) => (
            <option key={option.capture.captureId} value={option.capture.captureId}>{option.label}</option>
          ))}
        </select>
      </label>
      <div className="timeline-capture-basis">
        <strong>{active.label}</strong>
        <code>{active.capture.captureId}</code>
        <span>{active.basisLabel}</span>
        {active.timelineRecordCount > 1 ? (
          <small>{active.timelineRecordCount} timeline records share this capture ID; showing the first canonical timeline ID deterministically.</small>
        ) : null}
      </div>
      <fieldset className="timeline-window-controls">
        <legend>Visible window</legend>
        <div>
          {[1, 2, 4, 8].map((level) => (
            <button key={level} type="button" aria-pressed={zoom === level} onClick={() => onZoom(level)}>{level}×</button>
          ))}
          <output>{formatMs(windowStartNs)}–{formatMs(endNs)}</output>
        </div>
        <label>
          <span>Window position</span>
          <input type="range" min="0" max="100" step="1" value={panPercent} disabled={zoom === 1} onChange={(event) => onPan(Number(event.target.value))} />
        </label>
      </fieldset>
      <div className={`timeline-capture-warning ${active.capture.warnings.includes("intrusive_node_trace") ? "is-intrusive" : ""}`} role="status">
        <strong>{active.capture.warnings.includes("intrusive_node_trace") ? "Intrusive capture" : "Capture boundary"}</strong>
        <span>{warningCopy(active.capture.warnings, active.capture.nsys?.reportMode ?? "graph")}</span>
      </div>
    </section>
  );
}

function warningCopy(warnings: readonly string[], mode: "graph" | "node") {
  if (warnings.includes("intrusive_node_trace")) {
    return "Node tracing perturbs timing. Exact recorded kernel/copy intervals do not replace the less-intrusive graph baseline.";
  }
  if (warnings.includes("profiler_scheduler_activity_present")) {
    return "Profiler scheduler activity is kept excluded; Graph spans remain execution envelopes, not GPU busy time.";
  }
  return mode === "graph"
    ? "CUDA Graph spans are execution envelopes. Only copy activity is recorded outside those envelopes."
    : "Only represented activity is shown.";
}

function formatMs(valueNs: number) {
  return `${(valueNs / 1e6).toFixed(valueNs >= 1e7 ? 1 : 2)} ms`;
}
