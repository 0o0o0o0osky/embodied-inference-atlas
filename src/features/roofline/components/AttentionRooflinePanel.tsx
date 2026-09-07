import {useState} from 'react';
import {estimateAttention,type AttentionEstimateInput} from '../domain/attentionEstimate';
import {formatNumber,formatQuantity,formatTime} from '../presentation/viewModel';
import {TheoryRooflinePanel} from './TheoryRooflinePanel';
import {RooflineMetricsTable} from './RooflineMetricsTable';
import type {RooflinePlotPoint} from './RooflinePlot';
import './attentionRoofline.css';

export interface AttentionRooflinePanelProps {
 input:AttentionEstimateInput;precisionLabel:string;ceilingLabel:string;
 assumptions:readonly string[];sources:readonly {label:string;url:string}[];
}
const labels={qk:'Q @ Kᵀ',softmax:'缩放与 Softmax',pv:'P @ V',fused:'融合执行'};
const names={tensor:'Tensor 计算',cuda:'CUDA 算术',sfu:'指数 / 倒数',memory:'存储读写'};
export function AttentionRooflinePanel({input,precisionLabel,ceilingLabel,assumptions,sources}:AttentionRooflinePanelProps) {
 const [externalMask,setExternalMask]=useState(input.mask.kind==='additive');
 const effective={...input,mask:externalMask?{kind:'additive' as const,bytesPerElement:input.mask.kind==='additive'?input.mask.bytesPerElement:4}:{kind:'none' as const}};
 const estimate=estimateAttention(effective),paths=[estimate.separate,estimate.fused],shape=input.shape;
 const demand=estimate.fused.stages[0]!.resourceDemands;
 const computeSeconds=Math.max(...[demand.tensor,demand.cuda,demand.sfu].map(d=>d.knownSeconds));
 const computeRate=estimate.fused.work.matmulFlop/computeSeconds;
 const complete=paths.every(p=>p.complete) && !!input.rates.globalByte;
 const curve=complete?{computeFlopPerSecond:computeRate,bandwidthBytePerSecond:input.rates.globalByte!,ridgeFlopPerByte:computeRate/input.rates.globalByte!}:null;
 const points:RooflinePlotPoint[]=complete?paths.map((p,i)=>({id:p.kind,label:i?'理想融合':'三阶段分项',kind:i?'theory':'alternate',xFlopPerByte:p.referencePoint.arithmeticIntensity,yFlopPerSecond:p.referencePoint.matmulFlopPerSecond!})):[];
 const stages=estimate.separate.stages;
 return <TheoryRooflinePanel title="Attention · 理论 Roofline" context={`${precisionLabel} · 单次调用`}
  curve={curve} points={points} columns={['三阶段分项','理想融合']} yLabel="等效矩阵吞吐（TFLOP/s）" rows={[
   {label:'理论时间',values:paths.map(p=>p.complete?formatTime(p.lowerBoundSeconds):'速率待补充')},
   {label:'等效吞吐',values:paths.map(p=>p.complete?`${formatNumber(p.referencePoint.matmulFlopPerSecond!/1e12)} TFLOP/s`:'—')},
   {label:'矩阵工作量',values:paths.map(p=>formatQuantity(p.work.matmulFlop,'FLOP'))},
   {label:'建模读写',values:paths.map(p=>formatQuantity(p.globalBytes,'B'))},
   {label:'算术强度',values:paths.map(p=>`${formatNumber(p.referencePoint.arithmeticIntensity)} FLOP/B`)},
  ]} note={`Q ${shape.queryTokens} / KV ${shape.keyTokens} · H ${shape.queryHeads}/${shape.kvHeads} · ${ceilingLabel}。${input.rates.exp===null?'特殊函数速率待补充':'特殊函数使用参考速率'}。`}>
  <p>分项把分数 S 和概率 P 写回全局存储；融合让它们留在片上。</p>
  <div className="attention-path-flow"><span>QK</span><i>写 S → 读 S</i><span>Softmax</span><i>写 P → 读 P</i><span>PV</span></div>
  <div className="attention-path-flow is-fused"><b>Q、K、V →</b><span>QK → Softmax → PV<small>S、P 留在片上</small></span><b>→ O</b></div>
  <label className="attention-mask-option"><input type="checkbox" checked={externalMask} onChange={e=>setExternalMask(e.currentTarget.checked)}/>读取完整 FP32 加法 mask</label>
  <p>S 每元素 {input.bytes.score} B，P 每元素 {input.bytes.probability} B；Softmax 使用 FP32 算术。</p>
  <RooflineMetricsTable label="Attention 阶段资源耗时" columns={stages.map(s=>labels[s.id])} rows={Object.entries(names).map(([key,label])=>({label,values:stages.map(s=>{
   const seconds=s.resourceDemands[key as keyof typeof names].seconds;return seconds===null?'待补速率':formatTime(seconds);
  })}))}/>
  <p>分项：每阶段取计算与读写的较大值，再相加。融合：取 Tensor、CUDA、特殊函数、读写需求的最大值。同一资源上的操作先相加。</p>
  <p>等效吞吐以 QK/PV 矩阵 FLOP 除以时间；指数、归约和比较单独限制时间。实际分块重读、在线 Softmax 重缩放、线程通信与提交开销另需实现模型。</p>
  {assumptions.map(note=><p key={note}>{note}</p>)}
  <p>{sources.map((s,i)=><span key={s.url}>{i?' · ':''}<a href={s.url} target="_blank" rel="noreferrer">{s.label}</a></span>)}</p>
 </TheoryRooflinePanel>;
}
