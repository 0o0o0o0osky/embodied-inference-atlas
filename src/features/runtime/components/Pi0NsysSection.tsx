import { captureLabel } from "../domain/captureLabel";
import { interval, clipInterval, measureIntervals } from "../../profiler/domain/intervals";
import type { TimelineEvent } from "../../profiler/domain/types";
import { TimelineViewport } from "../../timeline/components/TimelineViewport";
import type { TimelineViewModel } from "../../timeline/domain/buildTimelineView";
import { summarizeSamples } from '../domain/analysisSamples';

export interface Pi0NsysSectionProps {
  view: TimelineViewModel;
  onSelectEvent: (event: TimelineEvent) => void;
  onOpenDetails: () => void;
}

export function Pi0NsysSection({ view: model, onSelectEvent, onOpenDetails }: Pi0NsysSectionProps) {
  const active = model.active;
  const node = active?.capture.nsys?.reportMode === "node";
  const savedSummary=active?.capture.analysisSummary;
  const batch=active?.capture.analysisSample;
  const batchOptions=batch?model.options.filter(o=>o.capture.analysisSample?.batchId===batch.batchId && o.capture.analysisSample.inputCaseId===batch.inputCaseId):[];
  const completeBatch=batchOptions.length===10 && new Set(batchOptions.map(o=>o.capture.analysisSample!.sampleIndex)).size===10;
  const batchMedian=(read:(option:NonNullable<typeof active>)=>number|null|undefined)=>{
    if (!completeBatch) return active?read(active):null;
    const values=batchOptions.map(read);
    return values.every(v=>v!=null)?summarizeSamples(values as number[])?.median:null;
  };
  const summary=(option:NonNullable<typeof active>,name:string)=>option.timeline.summaries.find(s=>s.metricName===name)?.value;
  const apiEvents = active?.timeline.events.filter(event => event.eventKind === "cuda_api" && event.evidenceSemantics === "exact_interval") ?? [];
  const apiUnion = active && apiEvents.length ? measureIntervals(apiEvents.flatMap(event => {
    const clipped = clipInterval(interval(event.startNs,event.durationNs), interval(active.timeline.window.startNs,active.timeline.window.durationNs));
    return clipped ? [clipped] : [];
  })) : null;
  const primary = [
    {label:"Nsys 请求墙钟", value:savedSummary?.wall.medianNs ?? batchMedian(o=>o.timeline.window.durationNs), note:"独立于无 profiler 的端到端统计"},
    {label:"CPU 多线程运行累计",value:savedSummary ? savedSummary.systemMedians.cpuCoreTimeNs : batchMedian(o=>summary(o,"target_scheduled_core_time_over_full_window")),note:"CPU 调度核时，可超过墙钟"},
    {label:"GPU 已记录活动并集",value:node ? savedSummary ? savedSummary.systemMedians.gpuActivityUnionNs : batchMedian(o=>summary(o,"recorded_gpu_activity_union")) : null,note:node ? "Kernel 与拷贝区间的并集" : "Graph 包络不能替代活动并集"},
    {label:"API 调用墙钟并集",value:savedSummary?savedSummary.systemMedians.apiWallUnionNs:completeBatch?batchMedian(o=>{
      const events=o.timeline.events.filter(e=>e.eventKind==='cuda_api' && e.evidenceSemantics==='exact_interval');
      return events.length?measureIntervals(events.flatMap(e=>{const clipped=clipInterval(interval(e.startNs,e.durationNs),interval(o.timeline.window.startNs,o.timeline.window.durationNs));return clipped?[clipped]:[];})):null;
    }):apiUnion,note:"调用区间，可与 CPU/GPU 重叠"},
  ];
  const records = node ? [
    ["已记录 Kernel / copy 并集", "recorded_gpu_activity_union", "已记录活动，非完整 GPU busy"],
    ["重叠 CPU 调度核时", "target_scheduled_core_time_overlapping_recorded_gpu_activity", "逐线程调度时长，可超过墙钟时间"],
    ["CPU 墙钟重叠", "target_wall_overlap_with_recorded_gpu_activity", "与已记录 GPU 活动相交的墙钟并集"],
    ["窗口内 CPU 调度核时", "target_scheduled_core_time_over_full_window", "调度执行证据，非 CPU 利用率"],
  ] : [
    ["CUDA Graph 执行范围", "cuda_graph_span_union", "执行范围，非 GPU busy"],
    ["Graph 执行期间 CPU 调度核时", "target_scheduled_core_time_overlapping_graph_spans", "逐线程调度时长，非 CPU 利用率"],
    ["已记录 copy 并集", "recorded_copy_activity_union", "仅 copy 区间，未记录逐 Kernel 区间"],
    ["执行范围之外", "outside_graph_span_union", "未观测 / 未知，不代表空闲"],
  ];
  return (
    <section className="pi0-funnel-section pi0-nsys-section" aria-labelledby="pi0-nsys-title">
      <header className="pi0-funnel-heading">
        <h3 id="pi0-nsys-title">系统耗时</h3>
        {active ? <div className="pi0-funnel-controls">
          <button className="pi0-funnel-detail" type="button" onClick={onOpenDetails}>打开离线 Perfetto</button>
        </div> : null}
      </header>
      {!active ? <p className="pi0-funnel-empty">当前选择暂无 Nsys 系统时间线。</p> : <>
        <p className="pi0-funnel-note">{captureLabel(active, model.options)} · 预测窗口 {(active.timeline.window.durationNs / 1e6).toFixed(3)} ms · 观察 CPU、CUDA 调用与 GPU 活动的重叠。</p>
        {model.requestedCaptureUnavailable ? <p className="pi0-funnel-warning" role="status">请求的 capture 不在当前范围内，显示当前推理栈的可用 capture。</p> : null}
        {node && !active.capture.coverage.isCompleteForPopulation ? <p className="pi0-funnel-note">当前窗口仅收录部分 Kernel；活动并集只覆盖这些已记录区间。</p> : null}
        <p className="pi0-funnel-note">{savedSummary || completeBatch?'本采集批次的总体指标：10 次中位数。':'以下指标来自当前一次采集窗口，尚无完整批次中位数。'}</p>
        <dl className="system-metrics">{primary.map(item=><div key={item.label}><dt>{item.label}</dt><dd>{item.value == null ? "未记录" : `${(item.value/1e6).toFixed(3)} ms`}</dd><small>{item.note}</small></div>)}</dl>
        <p className="pi0-funnel-note">以上是不同时间口径，不能相加。固定执行策略：观测—推理—动作—观测。</p>
        <div className="pi0-system-trace" aria-label="当前采集的紧凑时间线">
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
          <p className="pi0-funnel-note">时间线空白是未观测区间；执行范围不代表 GPU busy，CPU 调度核时不代表空闲或可卸载空间。点击区间查看对应详情。</p>
        </details>
        <details className="system-capabilities"><summary>采集能力与证据范围</summary><dl>
          <div><dt>CPU 调度运行</dt><dd>{active.capture.nsys?.schedulerTracePresent ? "已记录" : "未记录"}</dd></div>
          <div><dt>阻塞 / 可运行未调度</dt><dd>{active.capture.cpuCapabilities?.threadStates?'已记录':'未记录'}</dd></div>
          <div><dt>函数采样</dt><dd>{active.timeline.cpuSamples?.length?`${active.timeline.cpuSamples.length} 个样本`:'未记录'}</dd></div>
          <div><dt>CPU 任务标记</dt><dd>{active.capture.cpuCapabilities?.taskMarkers?'已记录':'未记录'}</dd></div>
          <div><dt>关联事件</dt><dd>{active.capture.cpuCapabilities?.associationEvents?'已记录':'未记录'}</dd></div>
        </dl><p>调度运行不等于函数归因；未记录区间不称为空闲。只有时间重叠时不绘制因果箭头。</p></details>
        {active.timeline.cpuSamples?.length ? <CpuSampleSummary samples={active.timeline.cpuSamples} /> : null}
      </>}
    </section>
  );
}

function CpuSampleSummary({samples}:{samples:NonNullable<import('../../profiler/domain/types').TimelineRecord['cpuSamples']>}) {
  const counts=new Map<string,number>();
  for(const sample of samples){
    const leaf=[...sample.frames].sort((a,b)=>a.depth-b.depth)[0];
    const label=leaf?.labelSanitized??'unresolved';counts.set(label,(counts.get(label)??0)+sample.weight);
  }
  const total=[...counts.values()].reduce((a,b)=>a+b,0);
  const labels:Record<string,string>={'native-predict':'推理入口','cuda-runtime':'CUDA 运行时','thread-wait':'线程等待函数',other:'其他函数',unresolved:'未解析函数'};
  return <details className="system-capabilities"><summary>当前 trace 的 CPU 函数采样</summary>
    <p>这是采样时刻的函数分布，比例不等于精确函数耗时；等待函数样本也不能确定线程调度状态。</p>
    <dl>{[...counts].sort((a,b)=>b[1]-a[1]).map(([label,count])=><div key={label}><dt>{labels[label]??label}</dt><dd>{count} 个 · {total>0?(count/total*100).toFixed(1):'—'}%</dd></div>)}</dl>
  </details>;
}
