import { captureLabel } from "../../runtime/domain/captureLabel";
import type { TimelineCaptureOption, TimelineViewModel } from "../domain/buildTimelineView";

export function TimelineToolbar({ view, onCapture }: {
  view: TimelineViewModel;
  onCapture: (captureId: string) => void;
}) {
  if (!view.active) return null;
  const label = (option: TimelineCaptureOption) => captureLabel(option,view.options);
  return <details className="timeline-capture-archive">
    <summary>采集记录与依据 · {label(view.active)}</summary>
    <label>切换采集<select value={view.active.capture.captureId} onChange={(event) => onCapture(event.target.value)}>
      {view.options.map((option) => <option key={option.capture.captureId} value={option.capture.captureId}>{label(option)}</option>)}
    </select></label>
    <p>{view.active.capture.nsys?.reportMode === "node"
      ? "节点追踪记录逐 Kernel 执行，会扰动时序；各窗口独立于端到端计时。"
      : "Graph 模式记录执行包络与 copy，干扰相对较低；包络时长不等于完整 GPU 忙碌时长。"}</p>
    <code>{view.active.capture.captureId}</code>
  </details>;
}
