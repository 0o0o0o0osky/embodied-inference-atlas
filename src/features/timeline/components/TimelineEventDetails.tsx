import type { TimelineEvent, TimelineRecord } from "../../profiler/domain/types";
import { eventTitle, laneTitle, timeLabel } from "./timelineLabels";

export function TimelineEventDetails({ timeline, event, onFocus }: {
  timeline: TimelineRecord; event: TimelineEvent | null; onFocus: (event: TimelineEvent) => void;
}) {
  if (!event) return <div className="timeline-selection-empty">点击一个色块，查看阶段名称、持续时间和调用信息。</div>;
  const polling = event.eventKind === 'osrt' && ['poll', 'ppoll'].includes(event.apiName ?? '');
  const lane = timeline.lanes.find((item) => item.laneId === event.laneId);
  return <aside className="timeline-selection" aria-label="所选区间详情" aria-live="polite">
    <header><div><span>{lane ? laneTitle(lane) : "已记录区间"}</span><h4>{eventTitle(event)}</h4></div>
      <button type="button" onClick={() => onFocus(event)}>聚焦此区间</button></header>
    <dl>
      <div><dt>{polling ? '窗口内等待时间' : '持续时间'}</dt><dd>{timeLabel(event.durationNs)}</dd></div>
      <div><dt>{polling ? '窗口内开始' : '开始'}</dt><dd>{timeLabel(event.startNs)}</dd></div>
      <div><dt>{polling ? '窗口内结束' : '结束'}</dt><dd>{timeLabel(event.startNs + event.durationNs)}</dd></div>
      {event.bytes != null ? <div><dt>传输量 / 方向</dt><dd>{event.bytes.toLocaleString()} B · {event.copyDirection?.toUpperCase() ?? "未知"}</dd></div> : null}
    </dl>
    <p>{event.eventKind === "cuda_graph" ? "本次记录提供整次 Graph 的执行范围。"
      : event.eventKind === "scheduler" ? "线程在 CPU 上运行的时间段。"
      : event.eventKind === "cuda_api" ? "主机侧 CUDA API 调用的持续时间，可包含同步等待。"
      : event.eventKind === "cuda_sync" ? "设备同步区间，可与主机侧同步调用同时发生。"
      : event.eventKind === "osrt" && ['poll', 'ppoll'].includes(event.apiName ?? '') ? "这个线程在等待 I/O 事件。图中显示当前推理窗口内的等待部分；事件到达或超时后调用返回。"
      : event.eventKind === "osrt" && event.apiName === 'ioctl' ? "ioctl 向设备驱动发送控制请求，图中记录这次调用从开始到返回的时间。"
      : event.eventKind === "osrt" ? "CPU 系统调用的持续时间，可包含等待。"
      : event.eventKind === "memcpy" ? "数据拷贝的持续时间，传输量和方向见上方。"
      : "计算、访存及 Roofline 详情可在 Kernel 分析中查看。"}</p>
    {event.eventKind === "cuda_api" || event.eventKind === "scheduler" ? <details className="timeline-callstack-status">
      <summary>函数采样</summary>
      <p>{timeline.cpuSamples?.length ? '函数采样记录各采样时刻的调用栈，可在系统页或 Perfetto 中查看。' : '当前采集未提供 CPU 函数采样。'}</p>
    </details> : null}
  </aside>;
}
