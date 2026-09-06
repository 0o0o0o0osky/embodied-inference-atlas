import type { TimelineCaptureOption, TimelineViewModel } from "../domain/buildTimelineView";

export function TimelineToolbar({ view, onCapture }: {
  view: TimelineViewModel;
  onCapture: (captureId: string) => void;
}) {
  if (!view.active) return null;
  const label = (option: TimelineCaptureOption) => option.capture.nsys?.reportMode === "node"
    ? "历史节点追踪 · 高侵入" : option.capture.nsys?.schedulerScope === "system_wide"
      ? "全系统 CPU 调度 + Graph" : "CUDA Graph 执行包络";
  return <details className="timeline-capture-archive">
    <summary>采集记录与依据 · {label(view.active)}</summary>
    <label>切换采集<select value={view.active.capture.captureId} onChange={(event) => onCapture(event.target.value)}>
      {view.options.map((option) => <option key={option.capture.captureId} value={option.capture.captureId}>{label(option)}</option>)}
    </select></label>
    <p>{view.active.capture.nsys?.reportMode === "node"
      ? "历史节点追踪会扰动时序，仅保留原始记录的查看入口。Kernel 性能分析请进入算子实现与 NCU 工作台。"
      : "Graph 模式记录执行包络与 copy，干扰相对较低；包络时长不等于完整 GPU 忙碌时长。"}</p>
    <code>{view.active.capture.captureId}</code>
  </details>;
}
