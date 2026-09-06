import type { RoutePatch, RouteState } from "../../../app/routes";
import { RouteLink } from "../../../components/RouteLink";
import type { TimelineViewModel } from "../domain/buildTimelineView";

export function TimelineInspector({ view, route, navigate }: {
  view: TimelineViewModel;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
  locale?: "en" | "zh";
}) {
  const event = view.selectedEvent;
  const labels: Record<string, string> = { scheduler: "CPU 调度运行", cuda_api: "CUDA API 调用", cuda_graph: "CUDA Graph 执行包络", memcpy: "GPU 数据拷贝", kernel: "历史 Kernel 记录" };
  return <aside className="timeline-inspector" aria-labelledby="timeline-inspector-title">
    <h3 id="timeline-inspector-title">{event ? labels[event.eventKind] ?? "系统活动区间" : "点击时间图区间"}</h3>
    {event ? <dl className="timeline-event-ledger">
      <div><dt>开始</dt><dd>{(event.startNs / 1e6).toFixed(3)} ms</dd></div>
      <div><dt>结束</dt><dd>{((event.startNs + event.durationNs) / 1e6).toFixed(3)} ms</dd></div>
      <div><dt>持续时间</dt><dd>{(event.durationNs / 1e6).toFixed(3)} ms</dd></div>
    </dl> : <p>查看 CPU 调度、CUDA API、Graph 或拷贝区间的时间位置。</p>}
    <p className="pi0-funnel-note">系统时间线用于观察时序和重叠；算子融合、计算访存与 Roofline 在 Kernel 工作台查看。</p>
    <RouteLink route={route} patch={{ tab: "roofline-kernels", rooflineLevel: "kernel", entity: null }} navigate={navigate}>查看算子实现与 Kernel 性能 →</RouteLink>
  </aside>;
}
