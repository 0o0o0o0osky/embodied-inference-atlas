import type { TimelineEvent, TimelineRecord } from "../../profiler/domain/types";
import { eventTitle, laneTitle, timeLabel } from "./timelineLabels";

export function TimelineEventDetails({ timeline, event, onFocus }: {
  timeline: TimelineRecord; event: TimelineEvent | null; onFocus: (event: TimelineEvent) => void;
}) {
  if (!event) return <div className="timeline-selection-empty">点击一个色块，查看阶段名称、持续时间和调用信息。</div>;
  const lane = timeline.lanes.find((item) => item.laneId === event.laneId);
  return <aside className="timeline-selection" aria-label="所选区间详情" aria-live="polite">
    <header><div><span>{lane ? laneTitle(lane) : "已记录区间"}</span><h4>{eventTitle(event)}</h4></div>
      <button type="button" onClick={() => onFocus(event)}>聚焦此区间</button></header>
    <dl>
      <div><dt>持续时间</dt><dd>{timeLabel(event.durationNs)}</dd></div>
      <div><dt>开始</dt><dd>{timeLabel(event.startNs)}</dd></div>
      <div><dt>结束</dt><dd>{timeLabel(event.startNs + event.durationNs)}</dd></div>
      {event.bytes != null ? <div><dt>传输量 / 方向</dt><dd>{event.bytes.toLocaleString()} B · {event.copyDirection?.toUpperCase() ?? "未知"}</dd></div> : null}
    </dl>
    <p>{event.eventKind === "cuda_graph" ? "这是一次 Graph 的执行范围，内部可能有间隙。当前记录不能展开内部函数或 Kernel。"
      : event.eventKind === "scheduler" ? "这是该线程被调度到 CPU 上运行的片段，不是一个函数的执行时间；不能由未记录区间推断 CPU 空闲。"
      : event.eventKind === "cuda_api" ? "这是主机侧 CUDA API 的调用时间，可能包含同步等待；不是 CPU 持续计算的时间。"
      : event.eventKind === "memcpy" ? "这是已记录的数据拷贝区间，不等于所有硬件访存活动。"
      : "此处仅展示记录的时间位置；计算访存及 Roofline 请在 Kernel 分析中查看。"}</p>
    {event.eventKind === "cuda_api" || event.eventKind === "scheduler" ? <details className="timeline-callstack-status">
      <summary>函数调用栈 · 当前视图暂无可展开栈帧</summary>
      <p>当前页面的数据未包含 CPU 采样栈或 CUDA 调用栈，因此不会将调度片段画成函数嵌套。系统调用的局部栈也不等于完整的 CPU 函数调用树。</p>
    </details> : null}
  </aside>;
}
