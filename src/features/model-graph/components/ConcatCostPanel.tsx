import {BandwidthReferenceBar} from '../../roofline/components/BandwidthReferenceBar';
import {buildConcatCost,type ConcatCostOperation} from '../domain/concatCost';
import './concatCostPanel.css';
export interface ConcatCostPanelProps {
 operation:ConcatCostOperation;
 inputBytes:number|null;
 outputBytes:number|null;
 precisionLabel:string;
 bandwidthBytesPerSecond:number|null;
}
const bytes=(value:number|null)=>value===null?'尺寸待解析':`${value.toLocaleString('zh-CN',{maximumFractionDigits:2})} B`;
export function ConcatCostPanel({operation,inputBytes,outputBytes,precisionLabel,bandwidthBytesPerSecond}:ConcatCostPanelProps) {
 const cost=buildConcatCost(operation,inputBytes,outputBytes,bandwidthBytesPerSecond);
 if(operation==='zero-pad'||operation==='expanded-layout')return <section className="concat-cost-panel" aria-label="扩展张量的理论读写">
  <header><h3>{operation==='zero-pad'?'补零与物化写入':'扩展张量 · 边界读写'}</h3><p>{precisionLabel} · 单次调用 · 理论条件</p></header>
  <BandwidthReferenceBar bandwidth={bandwidthBytesPerSecond}/>
  <div className="concat-cost-path"><h4>{operation==='zero-pad'?'保留输入，新增位置写零':'读取原输入，生成完整输出'}</h4>
   <p>读 {bytes(cost.readBytes)} + 写 {bytes(cost.writeBytes)} = <strong>{bytes(cost.materializedBytes)}</strong></p>
   {operation==='zero-pad'?<p>新增位置写入 {bytes(inputBytes!==null&&outputBytes!==null?outputBytes-inputBytes:null)} 的零值；这部分已包含在输出写入中。</p>:<p>新增元素的生成方式待关联；此处仅给读取原输入一次、写完整输出一次的边界条件。</p>}
   <p>条件读写下界：<strong>{cost.lowerBoundSeconds===null?'带宽或形状待补充':`${(cost.lowerBoundSeconds*1e6).toLocaleString('zh-CN',{maximumFractionDigits:3})} μs`}</strong></p>
  </div><p className="concat-cost-scope">{operation==='zero-pad'?'零值由计算生成，原输入的普通视图无法提供新增位置；可由生产者或后续算子融合处理。':'扩展元素的定义需由算子语义确认，不能仅凭输出变大认定为零拷贝视图。'}</p>
 </section>;
 const reshape=operation!=='concat';
 return <section className="concat-cost-panel" aria-label="布局与物化拷贝的理论路径">
  <header><h3>{operation==='broadcast'?'Broadcast':operation==='permute-rearrange'?'Permute':operation==='slice'?'Slice':reshape?'Reshape':'Concat'}：布局与拷贝</h3><p>{precisionLabel} · 单次元素存储边界 · 理论条件</p></header>
  <BandwidthReferenceBar bandwidth={bandwidthBytesPerSecond}/><div className="concat-cost-path">
   <h4>{operation==='broadcast'?'广播轴使用零步幅视图':reshape?'兼容步幅时只改视图':'生产者直接写目标分区'}</h4>
   <div className="concat-buffer-flow" role="img" aria-label={reshape?'同一 buffer 由另一视图读取':'生产者直接写入目标 buffer 的不同分区'}>
    <span>{reshape?'同一存储':'生产者'}</span><b aria-hidden="true">→</b><span className="concat-buffer"><i>{reshape?'原元素':'分区 A'}</i><i>{reshape?'新视图':'分区 B'}</i></span><b aria-hidden="true">→</b><span>消费者</span>
   </div>
   <p><strong>0 B 额外拷贝</strong> · {reshape?'所需元素可由原存储的步幅与偏移直接访问。':'目标分区预先分配，生产者写入位置满足下游布局。'}</p>
  </div>
  <div className="concat-cost-path">
   <h4>{reshape?'物化选中元素 / 重排布局':'两个源 buffer 经拷贝写入目标'}</h4>
   <div className="concat-buffer-flow" role="img" aria-label={reshape?'源 buffer 读取选中元素，经重排写入新 buffer':'源 A 和源 B 经拷贝写入目标 buffer'}>
    <span className="concat-buffer"><i>{reshape?'源元素':'源 A'}</i>{reshape?null:<i>源 B</i>}</span><b aria-hidden="true">→</b><span>{reshape?'拷贝 / 重排':'拷贝'}</span><b aria-hidden="true">→</b><span className="concat-buffer"><i>目标</i></span>
   </div>
   <p>读 {bytes(cost.readBytes)} + 写 {bytes(cost.writeBytes)} = <strong>{bytes(cost.materializedBytes)}</strong></p>
   <p>条件拷贝下界：<strong>{cost.lowerBoundSeconds===null ? cost.materializedBytes===null?'尺寸待解析':'带宽待选择':`${(cost.lowerBoundSeconds*1e6).toLocaleString('zh-CN',{maximumFractionDigits:3})} μs`}</strong>{bandwidthBytesPerSecond!==null && bandwidthBytesPerSecond>0 ? ` · 所选带宽 ${(bandwidthBytesPerSecond/1e9).toLocaleString('zh-CN',{maximumFractionDigits:2})} GB/s` : ''}</p>
  </div>
  <p className="concat-cost-scope">生产者写入与消费者读取仍归各自算子。实际路径由运行实现关联确定。</p>
 </section>;
}
