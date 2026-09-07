import {useState} from 'react';
import {estimateAttention, type AttentionEstimateInput, type AttentionPathEstimate} from '../domain/attentionEstimate';
import {formatNumber,formatQuantity,formatTime} from '../presentation/viewModel';
import './attentionRoofline.css';

export interface AttentionRooflinePanelProps {
 input:AttentionEstimateInput;
 precisionLabel:string;
 ceilingLabel:string;
 assumptions:readonly string[];
 sources:readonly {label:string;url:string}[];
}
const labels={qk:'Q @ Kᵀ',softmax:'缩放与 Softmax',pv:'P @ V',fused:'融合执行'};
const names={tensor:'Tensor',cuda:'CUDA 算术',sfu:'指数 / 倒数',memory:'存储读写'};

function AttentionRooflinePlot({paths,input}:{paths:AttentionPathEstimate[];input:AttentionEstimateInput}) {
 const fused=paths[1]!;
 const resources=fused.stages[0]!.resourceDemands;
 if (!paths.every(p=>p.complete) || !input.rates.globalByte) return <p role="status">补齐硬件速率后显示两条路径的 Roofline。</p>;
 const f=fused.work.matmulFlop;
 const compute=f/Math.max(resources.tensor.seconds!,resources.cuda.seconds!,resources.sfu.seconds!)/1e12;
 const bw=input.rates.globalByte/1e12;
 const ais=paths.map(p=>p.referencePoint.arithmeticIntensity);
 const ys=paths.map(p=>p.referencePoint.matmulFlopPerSecond!/1e12);
 const ridge=compute/bw;
 const xMin=10**Math.floor(Math.log10(Math.min(...ais,ridge)/2));
 const xMax=10**Math.ceil(Math.log10(Math.max(...ais,ridge)*2));
 const yMin=10**Math.floor(Math.log10(Math.min(...ys,bw*xMin)/2));
 const yMax=10**Math.ceil(Math.log10(compute*2));
 const x=(v:number)=>60+Math.log10(v/xMin)/Math.log10(xMax/xMin)*400;
 const y=(v:number)=>195-Math.log10(v/yMin)/Math.log10(yMax/yMin)*155;
 const ticks=(min:number,max:number)=>Array.from({length:Math.round(Math.log10(max/min))+1},(_,i)=>min*10**i);
 return <figure className="attention-roofline-plot">
  <svg viewBox="0 0 500 245" role="img" aria-label="Attention 分项与融合理想路径 Roofline，包含 CUDA 与特殊函数资源上限">
   {ticks(yMin,yMax).map(v=><g key={v}><line x1="60" x2="460" y1={y(v)} y2={y(v)} className="ar-grid"/><text x="52" y={y(v)+4} textAnchor="end">{formatNumber(v)}</text></g>)}
   {ticks(xMin,xMax).map(v=><g key={v}><line x1={x(v)} x2={x(v)} y1="40" y2="195" className="ar-grid"/><text x={x(v)} y="213" textAnchor="middle">{formatNumber(v)}</text></g>)}
   <text x="60" y="19">等效矩阵吞吐 · TFLOP/s</text>
   <path className="ar-roof" d={`M ${x(xMin)} ${y(Math.min(compute,bw*xMin))} L ${x(ridge)} ${y(compute)} L ${x(xMax)} ${y(compute)}`}/>
   {paths.map((p,i)=><g key={p.kind}><circle className={`ar-point ar-${p.kind}`} cx={x(ais[i]!)} cy={y(ys[i]!)} r="5"><title>{i?'融合':'分项'}：{formatNumber(ys[i]!)} TFLOP/s</title></circle><text className={`ar-label-${p.kind}`} x={x(ais[i]!)+(i?9:-9)} y={y(ys[i]!)+(i?-10:18)} textAnchor={i?'start':'end'}>{i?'融合':'分项'}</text></g>)}
   <text x="260" y="238" textAnchor="middle">矩阵 FLOP / 建模字节 · FLOP/B</text>
  </svg>
  <figcaption><span className="ar-line-key"/>综合资源上限 · 两点为理论估计</figcaption>
 </figure>;
}

export function AttentionRooflinePanel({input,precisionLabel,ceilingLabel,assumptions,sources}:AttentionRooflinePanelProps) {
 const [externalMask,setExternalMask]=useState(input.mask.kind==='additive');
 const effective={...input,mask:externalMask?{kind:'additive' as const,bytesPerElement:input.mask.kind==='additive'?input.mask.bytesPerElement:4}:{kind:'none' as const}};
 const estimate=estimateAttention(effective);
 const paths=[estimate.separate,estimate.fused];
 const shape=input.shape;
 return <section className="attention-roofline-panel" aria-label="Attention 的两种理论执行路径">
  <header><h3>Attention：分项与融合</h3><p>{precisionLabel} · 单次调用 · Q {shape.queryTokens} / KV {shape.keyTokens} · H {shape.queryHeads}/{shape.kvHeads}</p></header>
  <p>分项把分数和概率矩阵写回全局存储；融合让它们留在片上。</p>
  <div className="attention-path-flow"><span>QK</span><i>写 S → 读 S</i><span>Softmax</span><i>写 P → 读 P</i><span>PV</span></div>
  <div className="attention-path-flow is-fused"><b>Q、K、V →</b><span>QK → Softmax → PV<small>S、P 留在片上</small></span><b>→ O</b></div>
  <AttentionRooflinePlot paths={paths} input={effective}/>
  <div className="attention-table-scroll"><table><thead><tr><th>理论路径</th><th>全局读写</th><th>理想最短时间</th><th>等效吞吐</th></tr></thead><tbody>
   {paths.map(p=><tr key={p.kind}><th>{p.kind==='separate'?'三阶段分项':'理想融合'}</th><td>{formatQuantity(p.globalBytes,'B')}</td><td>{p.complete?formatTime(p.lowerBoundSeconds):'速率待补充'}</td><td>{p.complete?`${formatNumber(p.referencePoint.matmulFlopPerSecond!/1e12)} TFLOP/s`:'—'}</td></tr>)}
  </tbody></table></div>
  <p className="attention-model-note">{ceilingLabel} · {input.rates.exp===null?'特殊函数速率待补充':'特殊函数使用参考速率'}。这里比较理想上限；实际 Kernel 的 tile 与并行度会影响结果。</p>
  <details><summary>阶段耗时与估计方法</summary>
   <label className="attention-mask-option"><input type="checkbox" checked={externalMask} onChange={e=>setExternalMask(e.currentTarget.checked)}/>读取完整 FP32 加法 mask</label>
   <p>稠密计算 · {externalMask?'读取外部加法 mask':'无外部 mask 读取'}。S 每元素 {input.bytes.score} B，P 每元素 {input.bytes.probability} B；Softmax 使用 FP32 算术。</p>
   <p>计算速率：Tensor {input.rates.matmulFlop===null?'待补充':`${formatNumber(input.rates.matmulFlop/1e12)} TFLOP/s`}；CUDA 加/乘 {input.rates.scalarOp===null?'待补充':`${formatNumber(input.rates.scalarOp/1e12)} 万亿操作/s`}；指数/倒数 {input.rates.exp===null?'待补充':`${formatNumber(input.rates.exp/1e9)} 十亿结果/s`}。带宽 {input.rates.globalByte===null?'待补充':`${formatNumber(input.rates.globalByte/1e9)} GB/s`}。</p>
   <p>矩阵工作量 {formatQuantity(estimate.fused.work.matmulFlop,'FLOP')}；指数 {formatNumber(estimate.fused.work.exp)} 次；归约加法和比较各 {formatNumber(estimate.fused.work.reductionAdd)} 次。</p>
   <div className="attention-table-scroll"><table><thead><tr><th>阶段</th>{Object.values(names).map(n=><th key={n}>{n}</th>)}<th>最短时间</th></tr></thead><tbody>{[...estimate.separate.stages,...estimate.fused.stages].map(s=><tr key={s.id}><th>{labels[s.id]}</th>{Object.entries(s.resourceDemands).map(([k,v])=><td key={k}>{v.seconds===null?'待补速率':formatTime(v.seconds)}</td>)}<td>{s.complete?formatTime(s.lowerBoundSeconds):'待补速率'}</td></tr>)}</tbody></table></div>
   <p>分项：每阶段取计算与读写的较大值，再相加。融合：取 Tensor、CUDA、特殊函数、读写需求的最大值。同一资源上的操作先相加。</p>
   <p>两条路径使用相同 QK/PV 工作量。等效吞吐以矩阵 FLOP 除以时间；指数、归约和比较单独限制时间。边界读写按每个张量一次传输计算。</p>
   <p>融合采用理想片上驻留；实际分块重复读取、在线 Softmax 额外重缩放、线程通信和提交开销需要具体 Kernel 的实现模型。</p>
   {assumptions.map(note=><p key={note}>{note}</p>)}
   <p>{sources.map((source,i)=><span key={source.url}>{i?' · ':''}<a href={source.url} target="_blank" rel="noreferrer">{source.label}</a></span>)}</p>
  </details>
 </section>;
}
