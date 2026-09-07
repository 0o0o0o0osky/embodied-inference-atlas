import {TheoryRooflinePanel} from '../../roofline/components/TheoryRooflinePanel';
import {RooflineMetricsTable} from '../../roofline/components/RooflineMetricsTable';
import type {LocalOperatorWork} from '../../roofline/domain/localOperatorEstimate';
import {formatQuantity,formatTime,formatNumber} from '../../roofline/presentation/viewModel';
export function LocalOperatorRooflinePanel({work,rate,bandwidth,precisionLabel}:{work:LocalOperatorWork;rate:number|null;bandwidth:number|null;precisionLabel:string}) {
 const compute=rate!==null&&rate>0?work.flop/rate:null,memory=bandwidth!==null&&bandwidth>0?work.bytes/bandwidth:null;
 const duration=compute!==null&&memory!==null?Math.max(compute,memory):null,ai=work.flop/work.bytes;
 const curve=rate!==null&&rate>0&&bandwidth!==null&&bandwidth>0?{computeFlopPerSecond:rate,bandwidthBytePerSecond:bandwidth,ridgeFlopPerByte:rate/bandwidth}:null;
 return <TheoryRooflinePanel title="算子 · 理论 Roofline" context={`${precisionLabel} · 单次调用`} curve={curve}
  points={duration!==null&&duration>0?[{id:'local-operator',label:'理论参考',kind:'theory',xFlopPerByte:ai,yFlopPerSecond:work.flop/duration}]:[]}
  columns={['理论参考']} rows={[
   {label:'理论时间',values:[duration===null?'硬件速率待补充':formatTime(duration)]},
   {label:'吞吐量',values:[duration===null?'—':`${formatNumber(work.flop/duration/1e12)} TFLOP/s`]},
   {label:'算术工作量',values:[formatQuantity(work.flop,'FLOP')]},
   {label:'建模读写',values:[formatQuantity(work.bytes,'B')]},
   {label:'算术强度',values:[`${formatNumber(ai)} FLOP/B`]},
   {label:'主要限制',values:[duration===null?'速率待补充':compute!>memory!?'计算':'存储读写']},
  ]} note={work.resource==='matrix'?'所选矩阵计算上限 · 图块投影边界读写模型':work.resource==='fma'?'FP32 融合乘加参考上限 · 边界读写模型':'普通 FP32 算术参考上限 · 边界读写模型'}>
  <p>{work.formula}</p><p>{work.boundary}</p>
  <RooflineMetricsTable label="算子资源耗时" columns={['资源时间']} rows={[
   {label:work.resource==='matrix'?'矩阵计算':'FP32 算术',values:[compute===null?'计算速率待补充':formatTime(compute)]},
   {label:'存储读写',values:[memory===null?'带宽待补充':formatTime(memory)]},
  ]}/>
 </TheoryRooflinePanel>;
}
