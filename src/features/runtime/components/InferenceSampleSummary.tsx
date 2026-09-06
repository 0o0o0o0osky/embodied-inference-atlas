import type { AnalysisContext } from '../domain/resolveAnalysisContext';

const statusLabel={stable:'稳定',unstable:'波动未通过检查',incomplete:'样本或覆盖不完整'};
const cvLabel=(cv:number|null|undefined)=>cv==null?'未记录':`${(cv*100).toFixed(2)}%`;

export function InferenceSampleSummary({context}:{context:AnalysisContext}) {
  const {batch,traceBatches,nsys}=context;
  const active=nsys.active;
  const traceBatch=traceBatches.find(b=>b.samples.some(s=>s.captureId===active?.capture.captureId));
  // Full-data fixtures and local inspection can still supply the original batch.
  // Published pages retain its checked summary, never recompute CV from one trace.
  const summary=context.traceSummary ?? (traceBatch ? {
    sampleCount:traceBatch.samples.length,status:traceBatch.status,
    representativeCaptureId:traceBatch.representativeCaptureId,
    wall:{medianNs:traceBatch.wall?.median,cv:traceBatch.wall?.cv},
    hotspots:traceBatch.checkedHotspots.map(h=>({id:h.id,label:h.label,cv:h.summary?.cv,
      countsMatch:h.countsMatch,calls:traceBatch.samples[0]?.kernels.get(h.id)?.count??null})),
  }:null);
  const representative=Boolean(active && summary?.status==='stable'
    && summary.representativeCaptureId===active.capture.captureId);
  return <section className="inference-sample-summary" aria-label="采样摘要">
    <div className="inference-sample-line">
      <span>总体统计：<strong>{batch?`${batch.samples.length} 次中位数 · ${statusLabel[batch.status]}`:context.selectedEvidence?.selected?.value!=null?'中位数 · 稳定性未核验':'暂无匹配的总体测量'}</strong></span>
      <span>当前分析：<strong>{representative?'稳定代表 trace':active?'已有单次采集 · 稳定性未核验':'暂无可用 trace'}</strong></span>
      {active?<span>本次墙钟 <strong>{(active.timeline.window.durationNs/1e6).toFixed(3)} ms</strong></span>:null}
      {batch || summary?<details className="sample-evidence"><summary>稳定性检查</summary>
        {batch?<p>端到端：{batch.samples.length} 次采样，墙钟 CV {cvLabel(batch.summary?.cv)} · {statusLabel[batch.status]}。</p>:null}
        {summary?<><p>Trace 批次：{summary.sampleCount} 次采样，墙钟 CV {cvLabel(summary.wall.cv)} · {statusLabel[summary.status]}。门槛 ≤5%。</p>
          <table><thead><tr><th>主要热点</th><th>累计时间 CV</th><th>每次调用数</th></tr></thead><tbody>{summary.hotspots.map(h=><tr key={h.id}><th>{h.label}</th><td>{cvLabel(h.cv)}</td><td>{h.countsMatch?`${h.calls??'已记录'} · 一致`:'不一致或缺失'}</td></tr>)}</tbody></table>
        </>:null}
        <p>端到端与 Trace 是独立采集，各自检查稳定性。</p>
      </details>:null}
    </div>
  </section>;
}
