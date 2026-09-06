import type { TimelineEvent } from "../../profiler/domain/types";
import { TimelineViewport } from "../../timeline/components/TimelineViewport";
import { TimelineToolbar } from "../../timeline/components/TimelineToolbar";
import type { TimelineCaptureOption, TimelineViewModel } from "../../timeline/domain/buildTimelineView";

export interface Pi0NsysSectionProps {
  view: TimelineViewModel;
  onCaptureChange: (captureId: string) => void;
  onSelectEvent: (event: TimelineEvent) => void;
  onOpenDetails: () => void;
}

function captureLabel(option: TimelineCaptureOption) {
  if (option.capture.nsys?.reportMode === "node") return "节点 trace（较高侵入）";
  if (option.capture.nsys?.schedulerScope === "system_wide") return "全系统调度 trace";
  return "Graph 执行包络";
}

export function Pi0NsysSection({ view: model, onCaptureChange, onSelectEvent, onOpenDetails }: Pi0NsysSectionProps) {
  const active = model.active;
  const node = active?.capture.nsys?.reportMode === "node";
  const records = node ? [
    ["已记录 Kernel / copy 并集", "recorded_gpu_activity_union", "已记录活动，非完整 GPU busy"],
    ["重叠 CPU 调度核时", "target_scheduled_core_time_overlapping_recorded_gpu_activity", "逐线程调度时长，可超过墙钟时间"],
    ["CPU 墙钟重叠", "target_wall_overlap_with_recorded_gpu_activity", "与已记录 GPU 活动相交的墙钟并集"],
    ["窗口内 CPU 调度核时", "target_scheduled_core_time_over_full_window", "调度执行证据，非 CPU 利用率"],
  ] : [
    ["CUDA Graph 执行包络", "cuda_graph_span_union", "执行包络，非 GPU busy"],
    ["包络内 CPU 调度核时", "target_scheduled_core_time_overlapping_graph_spans", "逐线程调度时长，非 CPU 利用率"],
    ["已记录 copy 并集", "recorded_copy_activity_union", "仅 copy 区间，未记录逐 Kernel 区间"],
    ["执行包络之外", "outside_graph_span_union", "未观测 / 未知，不代表空闲"],
  ];
  return (
    <section className="pi0-funnel-section pi0-nsys-section" aria-labelledby="pi0-nsys-title">
      <header className="pi0-funnel-heading">
        <h3 id="pi0-nsys-title">系统时间线</h3>
        {active ? <div className="pi0-funnel-controls">
          <button className="pi0-funnel-detail" type="button" onClick={onOpenDetails}>放大系统时间线 →</button>
        </div> : null}
      </header>
      {!active ? <><p className="pi0-funnel-empty">当前选择暂无低侵入 Nsys 系统时间线。</p>
        {model.options.length ? <details className="timeline-capture-archive"><summary>历史采集 · 非默认系统基线</summary>
          {model.options.map((option) => <button type="button" key={option.capture.captureId} onClick={() => onCaptureChange(option.capture.captureId)}>{captureLabel(option)}</button>)}
        </details> : null}</> : <>
        <p className="pi0-funnel-note">{captureLabel(active)} · 预测窗口 {(active.timeline.window.durationNs / 1e6).toFixed(3)} ms · 观察 CPU、CUDA 调用与 GPU 活动的重叠。</p>
        {model.requestedCaptureUnavailable ? <p className="pi0-funnel-warning" role="status">请求的 capture 不在当前范围内，显示当前推理栈的可用 capture。</p> : null}
        <div className="pi0-nsys-instrument" aria-label="当前 capture 的紧凑时间线">
          <TimelineViewport locale="zh" timeline={active.timeline} selectedEventId={model.selectedEvent?.eventId ?? null} onSelect={onSelectEvent} />
        </div>
        <details className="pi0-runtime-mapping-disclosure">
          <summary>展开 Nsys 摘要</summary>
          <dl className="pi0-nsys-ledger">
            {records.map(([label, metric, note]) => {
              const summary = model.summariesByName.get(metric!);
              return <div key={metric}><dt>{label}</dt><dd>{summary ? summary.unit === "ns" ? `${(summary.value / 1e6).toFixed(3)} ms` : `${summary.value.toFixed(2)} ${summary.unit === "percent" ? "%" : "核"}` : "未记录"}</dd><small>{note}</small></div>;
            })}
          </dl>
          <p className="pi0-funnel-note">摘要与时间线来自同一 capture。{active.run.workload.vla?.executed_prompt_tokens == null ? "此 capture 未记录提示词元，不能视为上方端到端测量的同次执行。" : `此 capture 的已执行提示词元为 ${active.run.workload.vla.executed_prompt_tokens}，与上方端到端测量独立。`}</p>
          <p className="pi0-funnel-note">时间线空白是未观测区间；执行包络不代表 GPU busy，CPU 调度核时不代表空闲或可卸载空间。点击区间查看对应详情。</p>
        </details>
        <TimelineToolbar view={model} onCapture={onCaptureChange} />
      </>}
    </section>
  );
}
