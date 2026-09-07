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
    {label:"Nsys 请求墙钟", value:savedSummary?.wall.medianNs ?? batchMedian(o=>o.timeline.window.durationNs), note:"采集期间的请求起止时间"},
    {label:"CPU 多线程运行累计",value:savedSummary ? savedSummary.systemMedians.cpuCoreTimeNs : batchMedian(o=>summary(o,"target_scheduled_core_time_over_full_window")),note:"各线程实际运行时间之和"},
    {label:"GPU 活动时长",value:node ? savedSummary ? savedSummary.systemMedians.gpuActivityUnionNs : batchMedian(o=>summary(o,"recorded_gpu_activity_union")) : null,note:node ? "已记录的 Kernel 与拷贝，重叠部分计一次" : "需要逐 Kernel 活动记录"},
    {label:"CUDA API 调用时长",value:savedSummary?savedSummary.systemMedians.apiWallUnionNs:completeBatch?batchMedian(o=>{
      const events=o.timeline.events.filter(e=>e.eventKind==='cuda_api' && e.evidenceSemantics==='exact_interval');
      return events.length?measureIntervals(events.flatMap(e=>{const clipped=clipInterval(interval(e.startNs,e.durationNs),interval(o.timeline.window.startNs,o.timeline.window.durationNs));return clipped?[clipped]:[];})):null;
    }):apiUnion,note:"主机调用区间，重叠部分计一次"},
  ];
  const records = node ? [
    ["GPU 活动期间 CPU 累计运行", "target_scheduled_core_time_overlapping_recorded_gpu_activity", "各线程与 GPU 活动重叠的运行时间之和"],
    ["CPU / GPU 同时活动时长", "target_wall_overlap_with_recorded_gpu_activity", "CPU 与 GPU 活动相交的时间，重叠部分计一次"],
  ] : [
    ["CUDA Graph 执行范围", "cuda_graph_span_union", "各张 Graph 从开始到结束的区间合并"],
    ["Graph 执行期间 CPU 累计运行", "target_scheduled_core_time_overlapping_graph_spans", "Graph 范围内的各线程运行时间之和"],
    ["数据拷贝时长", "recorded_copy_activity_union", "已记录拷贝区间，重叠部分计一次"],
  ];
  const capabilities = [
    ["CPU 线程调度", active?.capture.nsys?.schedulerTracePresent ? '已记录' : null],
    ["线程状态", active?.capture.cpuCapabilities?.threadStates ? '已记录' : null],
    ["函数采样", active?.timeline.cpuSamples?.length ? `${active.timeline.cpuSamples.length} 个样本` : null],
    ["CPU 任务标记", active?.capture.cpuCapabilities?.taskMarkers ? '已记录' : null],
    ["关联事件", active?.capture.cpuCapabilities?.associationEvents ? '已记录' : null],
  ].filter(([,value]) => value !== null);
  return (
    <section className="pi0-funnel-section pi0-nsys-section" aria-labelledby="pi0-nsys-title">
      <header className="pi0-funnel-heading">
        <h3 id="pi0-nsys-title">系统耗时</h3>
        {active ? <div className="pi0-funnel-controls">
          <button className="pi0-funnel-detail" type="button" onClick={onOpenDetails}>打开离线 Perfetto</button>
        </div> : null}
      </header>
      {!active ? <p className="pi0-funnel-empty">当前选择暂无 Nsys 系统时间线。</p> : <>
        {model.requestedCaptureUnavailable ? <p className="pi0-funnel-warning" role="status">请求的 capture 不在当前范围内，显示当前推理栈的可用 capture。</p> : null}
        {node && !active.capture.coverage.isCompleteForPopulation ? <p className="pi0-funnel-note">当前窗口的 Kernel 记录为部分覆盖。</p> : null}
        <p className="pi0-funnel-note">{savedSummary || completeBatch?`Nsys 采集统计 · ${savedSummary?.sampleCount ?? batchOptions.length} 次中位数`:'当前 trace 的测量值'}</p>
        <dl className="system-metrics">{primary.map(item=><div key={item.label}><dt>{item.label}</dt><dd>{item.value == null ? "未记录" : `${(item.value/1e6).toFixed(3)} ms`}</dd><small>{item.note}</small></div>)}</dl>
        <div className="pi0-system-trace" aria-label="当前采集的紧凑时间线">
          <TimelineViewport locale="zh" timeline={active.timeline} selectedEventId={model.selectedEvent?.eventId ?? null} onSelect={onSelectEvent} />
        </div>
        <details className="pi0-runtime-mapping-disclosure">
          <summary>采集信息与重叠统计</summary>
          <p>{captureLabel(active, model.options)} · 窗口 {(active.timeline.window.durationNs / 1e6).toFixed(3)} ms</p>
          <dl className="pi0-nsys-ledger">
            {records.map(([label, metric, note]) => {
              const summary = model.summariesByName.get(metric!);
              return summary ? <div key={metric}><dt>{label}</dt><dd>{summary.unit === "ns" ? `${(summary.value / 1e6).toFixed(3)} ms` : `${summary.value.toFixed(2)} ${summary.unit === "percent" ? "%" : "核"}`}</dd><small>{note}</small></div> : null;
            })}
          </dl>
          {capabilities.length ? <><h4>已采集信息</h4><dl className="system-capture-capabilities">{capabilities.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></> : null}
        </details>
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
    <p>函数采样分布，按采样权重统计占比。</p>
    <dl>{[...counts].sort((a,b)=>b[1]-a[1]).map(([label,count])=><div key={label}><dt>{labels[label]??label}</dt><dd>{count} 个 · {total>0?(count/total*100).toFixed(1):'—'}%</dd></div>)}</dl>
  </details>;
}
