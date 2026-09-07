import { STABILITY_LIMIT } from '../domain/analysisSamples';
import type { AnalysisContext } from '../domain/resolveAnalysisContext';

const statusLabel={stable:'稳定',unstable:'波动未通过检查',incomplete:'样本或覆盖不完整'};
const cvLabel=(cv:number|null|undefined)=>cv==null?'未记录':`${(cv*100).toFixed(2)}%`;

export function InferenceSampleSummary({context}:{context:AnalysisContext}) {
  const {batch,nsys}=context;
  const active=nsys.active;
  const summary=context.traceSummary;
  const representative=Boolean(active && summary?.status==='stable'
    && summary.representativeCaptureId===active.capture.captureId);
  const traceStatus = !summary ? '稳定性摘要待导入'
    : summary.status === 'stable' ? '稳定性未核验' : statusLabel[summary.status];
  return <section className="inference-sample-summary" aria-label="采样摘要">
    <div className="inference-sample-line">
      <span>总体统计：<strong>{batch?`${batch.samples.length} 次中位数 · ${statusLabel[batch.status]}`:context.selectedEvidence?.selected?.value!=null?'中位数 · 稳定性未核验':'暂无匹配的总体测量'}</strong></span>
      <span>当前分析：<strong>{representative?'稳定代表 trace':active?`已有单次采集 · ${traceStatus}`:'暂无可用 trace'}</strong></span>
      {active?<span>本次总耗时 <strong>{(active.timeline.window.durationNs/1e6).toFixed(3)} ms</strong></span>:null}
      {batch || summary?<details className="sample-evidence"><summary>稳定性检查</summary>
        {batch?<p>端到端：{batch.samples.length} 次采样，耗时波动 {cvLabel(batch.summary?.cv)} · {statusLabel[batch.status]}。</p>:null}
        {summary?<><p>Trace 批次：{summary.sampleCount} 次采样，耗时波动 {cvLabel(summary.wall.cv)} · {statusLabel[summary.status]}。</p>
          <table><thead><tr><th>主要热点</th><th>累计耗时波动</th><th>每次调用数</th></tr></thead><tbody>{summary.hotspots.map(h=><tr key={h.id}><th>{h.label}</th><td>{cvLabel(h.cv)}</td><td>{h.countsMatch?`${h.calls??'已记录'} · 一致`:'不一致或缺失'}</td></tr>)}</tbody></table>
        </>:null}
        <details className="sample-variation-definition"><summary>耗时波动定义</summary><p>耗时波动 = 标准差 ÷ 平均耗时。数值越小，重复执行越稳定；当前检查门槛为 {STABILITY_LIMIT * 100}%。</p></details>
      </details>:null}
    </div>
  </section>;
}
