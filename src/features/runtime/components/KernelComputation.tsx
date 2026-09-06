import type { KernelRow } from '../../performance/domain/buildKernelRows';
import type { KernelLaunch } from '../../profiler/domain/types';
import type { RooflinePointRecord } from '../../roofline/domain/types';
import './kernelComputation.css';
const dtype=(value:string|null|undefined)=>value?.toUpperCase() ?? '未记录';
// Source-audited exact signature allowlist; not a symbol-name heuristic.
const CONVERSIONS = new Set(['009','016','028','030','041','045','055'].map(id=>`kernel-signature-pi0-vlacpp-fp32-to-bf16-conversion-${id}`));

export function KernelResources({launch,label='执行资源'}:{launch:KernelLaunch;label?:string}) {
 const items=[['Grid',launch.grid?.join(' × ')],['Block（线程）',launch.block?.join(' × ')],['每线程寄存器',launch.registersPerThread],['静态 shared memory',launch.staticSharedMemoryBytes==null?null:`${launch.staticSharedMemoryBytes} B`],['动态 shared memory',launch.dynamicSharedMemoryBytes==null?null:`${launch.dynamicSharedMemoryBytes} B`],['Waves / SM',launch.wavesPerSm]] as const;
 return <section className="kernel-resources"><h5>{label}</h5><dl>{items.filter(([,value])=>value!=null).map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>{items.every(([,value])=>value==null)?<p>当前采集未记录 launch 资源。</p>:<p>Grid / Block 描述启动组织；未记录实际 tile、warp 分工或内部缓冲方案。</p>}</section>;
}
export function isVerifiedConversion(row:KernelRow):boolean {
 return CONVERSIONS.has(row.signature.kernelSignatureId) && row.signature.precisionPath.inputDtypeClass==='fp32' && row.signature.precisionPath.outputDtypeClass==='bf16';
}
export function isVerifiedStrideCopy(row:KernelRow):boolean {
 return row.signature.kernelSignatureId==='kernel-signature-pi0-vlacpp-fp32-stride-copy-036'
  && row.signature.functionFamily==='copy' && row.signature.precisionPath.inputDtypeClass==='fp32'
  && row.signature.precisionPath.outputDtypeClass==='fp32';
}
export function KernelPrecisionSummary({row}:{row:KernelRow}) {
 const precision=row.signature.precisionPath;
 const conflict=[...Object.values(row.signature.missing),...Object.values(precision.missing)].includes('precision_conflict');
 return <><p>输入 {dtype(precision.inputDtypeClass)}{isVerifiedConversion(row)||isVerifiedStrideCopy(row)?'':`；累加 ${dtype(precision.accumulatorDtypeClass)}`}；输出 {dtype(precision.outputDtypeClass)}</p>{conflict?<p role="status">精度证据冲突：运行级精度不能替代本 Kernel 的执行精度。</p>:null}</>;
}
export function KernelComputation({row,point}:{row:KernelRow;point?:RooflinePointRecord | undefined}) {
 const precision=row.signature.precisionPath;
 const conversion=isVerifiedConversion(row),strideCopy=isVerifiedStrideCopy(row);
 const dimensions=point?.entity.shape_or_coverage.match(/M\s*=\s*(\d+).*N\s*=\s*(\d+).*K\s*=\s*(\d+)/);
 const projection=['kernel-signature-pi0-vlacpp-bf16-gemm-4096x51x1024','kernel-signature-pi0-vlacpp-bf16-gemm-16384x304x2048'].includes(row.signature.kernelSignatureId);
 return <section className="kernel-computation" aria-label="计算与数据流"><h4>计算与数据流</h4>
 <KernelPrecisionSummary row={row} />
 {dimensions?<><div className="kernel-matrix-flow" aria-label="GEMM 数学维度"><div><strong>A</strong><span>{dimensions[1]} × {dimensions[3]}</span><small>{dtype(precision.inputDtypeClass)}</small></div><b>×</b><div><strong>B</strong><span>{dimensions[3]} × {dimensions[2]}</span><small>{dtype(precision.inputDtypeClass)}</small></div><b>→</b><div><strong>C</strong><span>{dimensions[1]} × {dimensions[2]}</span><small>{dtype(precision.outputDtypeClass)}</small></div></div><p>Cᵢⱼ = Σₖ Aᵢₖ Bₖⱼ；维度为数学视图，未表示物理 stride 或实际线程 tile。</p></>:conversion?<>
   <div className="kernel-matrix-flow" aria-label="已确认的元素转换"><div><strong>读取 x[ix]</strong><span>FP32 · 4 B / 元素</span></div><b>→</b><div><strong>BF16(x[ix])</strong><span>逐元素类型转换</span></div><b>→</b><div><strong>写出 y[iy]</strong><span>BF16 · 2 B / 元素</span></div></div>
   <p>y[iy] = BF16(x[ix])。输入与输出索引可能包含步幅重排；没有乘加或归约。</p><p>全局存储边界：读取 4E B，写出 2E B，总计 6E B。当前采集未记录元素数 E，不能从 Grid 反推，也不生成数值流量或 FLOPs Roofline。</p>
   <details><summary>转换语义来源</summary><p>source-vla-cpp · ggml/src/ggml-cuda/convert.cu#convert_unary · revision 458681e1d5d4a29a1463c4732e03226cf384b997。已审计 convert_unary&lt;float, nv_bfloat16&gt; 的读取、类型转换与写入；实际 tile、缓存命中和线程内部复用未记录。</p></details>
 </>:strideCopy?<>
  <div className="kernel-matrix-flow" aria-label="FP32 步幅拷贝"><div><strong>读取 x[ix]</strong><span>FP32 · 4 B / 元素</span></div><b>→</b><div><strong>索引与步幅寻址</strong><span>值保持不变</span></div><b>→</b><div><strong>写出 y[iy]</strong><span>FP32 · 4 B / 元素</span></div></div>
  <p>每个线程将展平索引映射到输入和输出各自的步幅，再执行 y[iy] = x[ix]。没有乘加或归约。</p>
  <p>全局存储边界为读 4E B、写 4E B，共 8E B；元素数 E 与实际步幅未记录，不能据 Grid 反推流量或访存是否连续。</p>
  <p>在「执行与资源」查看独立回放的缓存、内存和调度指标；调用的耗时仍来自当前 trace。</p>
 </>:<p>当前证据未给出可核验的逐步计算公式；保留已确认的实现关联与执行耗时。</p>}
 {projection&&dimensions?<p>输出通道 {dimensions[1]}，序列位置 {dimensions[2]}，输入通道 {dimensions[3]}。A 是投影权重，B 是当前输入；Gate 与 Up 使用相同形状，各自执行。</p>:null}
 {point?<><h5>Kernel 存储边界</h5><div className="kernel-boundary-flow">{point.traffic.components.map(component=><div key={component.component_id}><strong>{component.tensor_ref ?? component.component_id}</strong><span>{component.kind.includes('write')?'写出':'读入'} · {(component.byte/1e6).toFixed(3)} MB</span></div>)}</div><p>单次工作量和字节量来自当前窗口已确认同形状的调用集合。边界流量按输入读取与输出写出建模，并非实测 DRAM 流量；L2、shared memory 与寄存器中的实际复用尚待证据。</p></>:null}
 </section>;
}
