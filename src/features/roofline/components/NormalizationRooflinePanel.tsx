import type {NormalizationEstimate} from '../domain/normalizationEstimate';
import type {NormalizationHardwareProfile} from '../domain/attentionHardwareProfile';
import {formatNumber,formatQuantity,formatTime} from '../presentation/viewModel';
import {TheoryRooflinePanel} from './TheoryRooflinePanel';
import {RooflineMetricsTable} from './RooflineMetricsTable';

export function NormalizationRooflinePanel({estimate:e,profile,bandwidth,precisionLabel}: {
 estimate:NormalizationEstimate;profile:NormalizationHardwareProfile;bandwidth:number|null;precisionLabel:string;
}) {
 const computeSecond=Math.max(e.knownResourceSeconds.cuda,e.knownResourceSeconds.sfu);
 const computeRate=e.work.flop/computeSecond;
 const curve=e.complete&&bandwidth?{computeFlopPerSecond:computeRate,bandwidthBytePerSecond:bandwidth,ridgeFlopPerByte:computeRate/bandwidth}:null;
 const limits={cuda:'CUDA 算术',sfu:'rsqrt',memory:'存储读写'};
 const limiting=Object.entries(e.knownResourceSeconds).sort((a,b)=>b[1]-a[1])[0]![0] as keyof typeof limits;
 return <TheoryRooflinePanel title="RMSNorm · 理论 Roofline" context={`${precisionLabel} · 单次调用`}
  curve={curve} points={e.complete?[{id:'rms-norm',label:'基础 RMS 归一化',kind:'theory',xFlopPerByte:e.arithmeticIntensity,yFlopPerSecond:e.referencePoint.flopPerSecond!}]:[]}
  columns={['理论参考']} rows={[
   {label:'理论时间',values:[e.complete?formatTime(e.lowerBoundSeconds):'速率待补充']},
   {label:'吞吐量',values:[e.complete?`${formatNumber(e.referencePoint.flopPerSecond!/1e12)} TFLOP/s`:'—']},
   {label:'算术工作量',values:[formatQuantity(e.work.flop,'FLOP')]},
   {label:'建模读写',values:[formatQuantity(e.globalBytes,'B')]},
   {label:'算术强度',values:[`${formatNumber(e.arithmeticIntensity)} FLOP/B`]},
   {label:'主要限制',values:[e.complete?limits[limiting]:'速率待补充']},
  ]} note="基础 RMS 归一化 · FP32 算术与归约 · rsqrt 使用参考速率。">
  <p>平方 → 行归约求均值 → 加 ε → rsqrt → 逐元素相乘。</p>
  <p>rsqrt 共 {formatNumber(e.work.rsqrt)} 次，单独限制时间；普通算术共 {formatQuantity(e.work.flop,'FLOP')}。</p>
  <RooflineMetricsTable label="RMSNorm 资源耗时" columns={['资源时间']} rows={Object.entries(limits).map(([key,label])=>({label,values:[e.resourceSeconds[key as keyof typeof limits]===null?'待补速率':formatTime(e.resourceSeconds[key as keyof typeof limits]!)]}))}/>
  {e.assumptions.slice(1).map(note=><p key={note}>{note}</p>)}
  {profile.notes.map(note=><p key={note}>{note}</p>)}
  <p><a href="https://docs.pytorch.org/docs/main/generated/torch.nn.RMSNorm.html" target="_blank" rel="noreferrer">RMSNorm 公式</a>{profile.sources.map(s=><span key={s.url}> · <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a></span>)}</p>
 </TheoryRooflinePanel>;
}
