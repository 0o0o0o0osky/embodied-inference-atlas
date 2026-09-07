import {BandwidthReferenceBar} from '../../roofline/components/BandwidthReferenceBar';
import type {RemainingOperatorWork,RemainingRates} from '../../roofline/domain/remainingOperatorEstimate';
import {estimateRemainingResources} from '../../roofline/domain/remainingOperatorEstimate';
import {TheoryRooflinePanel} from '../../roofline/components/TheoryRooflinePanel';
import {RooflineMetricsTable} from '../../roofline/components/RooflineMetricsTable';
import {formatNumber,formatQuantity,formatTime} from '../../roofline/presentation/viewModel';
export function RemainingOperatorRooflinePanel({work:w,rates,precisionLabel,rateNotes=[],rateSources=[]}:{work:RemainingOperatorWork;rates:RemainingRates;precisionLabel:string;rateNotes?:readonly string[];rateSources?:readonly {label:string;url:string}[]}) {
 const e=estimateRemainingResources(w,rates);
 const rows=[{label:'理论时间',values:[e.seconds===null?'硬件速率待补充':formatTime(e.seconds)]},{label:'算术工作量',values:[formatQuantity(e.flop,'FLOP')]},{label:'建模读写',values:[formatQuantity(w.bytes,'B')]}];
 const resources=<><p>{w.formula}</p>{w.notes.map(n=><p key={n}>{n}</p>)}<RooflineMetricsTable label="理论资源需求" columns={['次数 / 时间']} rows={[
  ...(['exp','reciprocal','rsqrt','sin','cos'] as const).filter(k=>w[k]>0).map(k=>({label:k,values:[`${w[k].toLocaleString()} 次`]})),
  {label:'CUDA 普通算术与归约',values:[e.cuda===null?'速率待补充':formatTime(e.cuda)]},
  {label:'SFU 共享资源',values:[e.sfu===null?'速率待补充':formatTime(e.sfu)]},
  {label:'存储读写',values:[e.memory===null?'带宽待补充':formatTime(e.memory)]},
 ]}/><p><a href={w.source.url} target="_blank" rel="noreferrer">{w.source.label}</a></p></>;
 if(e.flop===0)return <section className="roofline-pair-chart theory-roofline-panel" aria-label="Token 查表带宽成本">
  <header className="roofline-pair-summary"><span>{w.label} · 理论带宽成本</span><strong>{precisionLabel} · 单次调用</strong></header>
  <BandwidthReferenceBar bandwidth={rates.globalByte}/><RooflineMetricsTable label="查表理论成本" columns={['理论参考']} rows={[...rows,{label:'所选带宽',values:[rates.globalByte===null?'待补充':`${formatNumber(rates.globalByte/1e9)} GB/s`]}]}/>
  <details className="roofline-pair-inspector"><summary>计算过程与参考条件</summary>{resources}</details></section>;
 const compute=e.cuda!==null&&e.sfu!==null?Math.max(e.cuda,e.sfu):null;
 const rate=compute!==null&&compute>0?e.flop/compute:null,ai=e.flop/w.bytes;
 const curve=rate!==null&&rates.globalByte!==null?{computeFlopPerSecond:rate,bandwidthBytePerSecond:rates.globalByte,ridgeFlopPerByte:rate/rates.globalByte}:null;
 return <TheoryRooflinePanel title={`${w.label} · 理论 Roofline`} context={`${precisionLabel} · 单次调用`} curve={curve}
  points={e.seconds!==null&&e.seconds>0?[{id:'remaining-operator',label:w.label,kind:'theory',xFlopPerByte:ai,yFlopPerSecond:e.flop/e.seconds}]:[]}
  columns={['理论参考']} rows={[rows[0]!,{label:'吞吐量',values:[e.seconds===null?'—':`${formatNumber(e.flop/e.seconds/1e12)} TFLOP/s`]},...rows.slice(1),{label:'算术强度',values:[`${formatNumber(ai)} FLOP/B`]},
   {label:'主要限制',values:[e.seconds===null?'速率待补充':e.memory===e.seconds?'存储读写':e.sfu===e.seconds?'特殊函数':'普通算术与归约']}]}
  note="FP32 算术参考 · 特殊函数参考速率 · 边界读写模型">
  {resources}{rateNotes.map(note=><p key={note}>{note}</p>)}
  <p>{rateSources.map((source,i)=><span key={source.url}>{i?' · ':''}<a href={source.url} target="_blank" rel="noreferrer">{source.label}</a></span>)}</p>
 </TheoryRooflinePanel>;
}
