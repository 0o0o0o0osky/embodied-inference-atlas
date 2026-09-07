import type { CanonicalRecord } from '../../../types/atlas';
import { RuntimeSourceReferences } from './RuntimeSourceReferences';
import type { KernelRow } from '../../performance/domain/buildKernelRows';
import type { KernelLaunch } from '../../profiler/domain/types';
import type { RooflinePointRecord } from '../../roofline/domain/types';
import './kernelComputation.css';
const dtype=(value:string|null|undefined)=>value?.toUpperCase() ?? '未记录';
// Source-audited exact signature allowlist; not a symbol-name heuristic.
const CONVERSIONS = new Set(['009','016','028','030','041','045','055'].map(id=>`kernel-signature-pi0-vlacpp-fp32-to-bf16-conversion-${id}`));
const FLASH_GEGLU = new Set(['028','044'].map(id=>`kernel-signature-pi0-flashrt-geglu-fp8-${id}`));

export function KernelResources({launch,label='执行资源'}:{launch:KernelLaunch;label?:string}) {
 const items=[['Grid',launch.grid?.join(' × ')],['Block（线程）',launch.block?.join(' × ')],['每线程寄存器',launch.registersPerThread],['静态 shared memory',launch.staticSharedMemoryBytes==null?null:`${launch.staticSharedMemoryBytes} B`],['动态 shared memory',launch.dynamicSharedMemoryBytes==null?null:`${launch.dynamicSharedMemoryBytes} B`],['Waves / SM',launch.wavesPerSm]] as const;
 return <section className="kernel-resources"><h5>{label}</h5><dl>{items.filter(([,value])=>value!=null).map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>{items.every(([,value])=>value==null)?<p>当前采集未记录 launch 资源。</p>:null}</section>;
}
export function isVerifiedConversion(row:KernelRow):boolean {
 return CONVERSIONS.has(row.signature.kernelSignatureId) && row.signature.precisionPath.inputDtypeClass==='fp32' && row.signature.precisionPath.outputDtypeClass==='bf16';
}
export function isVerifiedStrideCopy(row:KernelRow):boolean {
 return row.signature.kernelSignatureId==='kernel-signature-pi0-vlacpp-fp32-stride-copy-036'
  && row.signature.functionFamily==='copy' && row.signature.precisionPath.inputDtypeClass==='fp32'
  && row.signature.precisionPath.outputDtypeClass==='fp32';
}
export function KernelPrecisionSummary({row,implementationOutput}:{row:KernelRow;implementationOutput?:string | undefined}) {
 const precision=row.signature.precisionPath;
 const conflict=[...Object.values(row.signature.missing),...Object.values(precision.missing)].includes('precision_conflict');
 return <><p>输入 {dtype(precision.inputDtypeClass)}{isVerifiedConversion(row)||isVerifiedStrideCopy(row)?'':`；累加 ${dtype(precision.accumulatorDtypeClass)}`}；输出 {precision.outputDtypeClass == null && implementationOutput ? `${dtype(implementationOutput)}（实现关联）` : dtype(precision.outputDtypeClass)}</p>{conflict?<p role="status">精度证据冲突，当前执行精度待核对。</p>:null}</>;
}
export function KernelComputation({row,point,sources}:{row:KernelRow;point?:RooflinePointRecord | undefined;sources?:readonly CanonicalRecord[] | undefined}) {
 const precision=row.signature.precisionPath;
 const conversion=isVerifiedConversion(row),strideCopy=isVerifiedStrideCopy(row);
 const fusedGate=row.signature.kernelSignatureId==='kernel-signature-pi0-realtime-vla-gate-up-fusion-017';
 const mergedFlashProjection=row.signature.kernelSignatureId==='kernel-signature-pi0-flashrt-large-gemm-027'
  && precision.inputDtypeClass==='fp8_e4m3' && precision.accumulatorDtypeClass==='fp32'
  && row.links.some(link=>link.status==='resolved' && link.executionGroupIds.includes('prefix-merged-gate-up'));
 const fp8Geglu=FLASH_GEGLU.has(row.signature.kernelSignatureId);
 const dimensions=point?.entity.shape_or_coverage.match(/M\s*=\s*(\d+).*N\s*=\s*(\d+).*K\s*=\s*(\d+)/);
 const projection=['kernel-signature-pi0-vlacpp-bf16-gemm-4096x51x1024','kernel-signature-pi0-vlacpp-bf16-gemm-16384x304x2048'].includes(row.signature.kernelSignatureId);
 const downProjection=['kernel-signature-pi0-vlacpp-bf16-gemm-2048x304x16384','kernel-signature-pi0-vlacpp-bf16-gemm-1024x51x4096'].includes(row.signature.kernelSignatureId);
 return <section className="kernel-computation" aria-label="计算与数据流"><h4>计算与数据流</h4>
 <KernelPrecisionSummary row={row} implementationOutput={mergedFlashProjection && row.observation?.observationKind !== 'ncu_replayed_launch' ? 'fp16' : undefined} />
 {dimensions&&!mergedFlashProjection?<><div className="kernel-matrix-flow" aria-label="GEMM 数学维度"><div><strong>A</strong><span>{dimensions[1]} × {dimensions[3]}</span><small>{dtype(precision.inputDtypeClass)}</small></div><b>×</b><div><strong>B</strong><span>{dimensions[3]} × {dimensions[2]}</span><small>{dtype(precision.inputDtypeClass)}</small></div><b>→</b><div><strong>C</strong><span>{dimensions[1]} × {dimensions[2]}</span><small>{dtype(precision.outputDtypeClass)}</small></div></div><p>Cᵢⱼ = Σₖ Aᵢₖ Bₖⱼ。</p></>:mergedFlashProjection?<>
  <div className="kernel-matrix-flow" aria-label="前缀 Gate/Up 合并 GEMM"><div><strong>X</strong><span>304 × 2048</span><small>FP8 E4M3</small></div><b>×</b><div><strong>[Wgate, Wup]</strong><span>2048 × 32768</span><small>FP8 E4M3</small></div><b>→</b><div><strong>[Gate, Up]</strong><span>304 × 32768</span><small>FP16</small></div></div>
  <p>[Gate, Up] = FP16(α · X[Wgate, Wup])；FP32 累加，α 在 epilogue 缩放，β = 0。两组投影合并为一次 GEMM。</p>
  <p>输出合并的 Gate/Up 中间值；GELU、乘积及 FP8 转换由后续 028 Kernel 执行。</p>
 </>:fusedGate?<>
  <div className="kernel-matrix-flow" aria-label="Gate Up 融合计算"><div><strong>共享输入 X</strong><span>BF16 输入与两组权重</span></div><b>→</b><div><strong>Gate / Up 矩阵乘</strong><span>两组 FP32 累加器</span></div><b>→</b><div><strong>GELU(Gate) × Up</strong><span>写出 BF16</span></div></div>
  <p>G = XWgate，U = XWup，Y = BF16(GELU(G) ⊙ U)。两次矩阵乘、原生 GELU 近似和逐元素乘法在同一次 Kernel 中完成；计算两组投影时共用已读取的输入块。</p>
  <p>Gate 与 Up 中间结果保存在 Kernel 内部，存储边界应按融合后的输入和最终输出计算。实际缓存与调度指标见「执行与资源」。</p>
 </>:fp8Geglu?<>
  <div className="kernel-matrix-flow" aria-label="GEGLU 与 FP8 转换"><div><strong>读取 Gate / Up</strong><span>合并布局 · FP16</span></div><b>→</b><div><strong>GELU × Up × scale</strong><span>FP32 运算与裁剪</span></div><b>→</b><div><strong>写出 FP8 E4M3</strong><span>供后续投影读取</span></div></div>
  <p>Y = FP8(clamp(GELU(Gate) ⊙ Up / max(descale, 10⁻¹²), −448, 448))。激活、逐元素乘法和量化在同一次 Kernel 中完成；上游 GEMM 另行执行。</p>
  <p>每个输出元素读取两份 FP16 值、写出一份 FP8 值，另读取缩放参数。这里描述存储边界，硬件访存与缓存行为由独立 NCU 指标提供。</p>
 </>:conversion?<>
   <div className="kernel-matrix-flow" aria-label="已确认的元素转换"><div><strong>读取 x[ix]</strong><span>FP32 · 4 B / 元素</span></div><b>→</b><div><strong>BF16(x[ix])</strong><span>逐元素类型转换</span></div><b>→</b><div><strong>写出 y[iy]</strong><span>BF16 · 2 B / 元素</span></div></div>
   <p>y[iy] = BF16(x[ix])。输入与输出索引可能包含步幅重排；没有乘加或归约。</p><p>全局存储边界：读取 4E B，写出 2E B，总计 6E B。E 为处理的元素数，当前记录中其值未知。</p>
   <p>参考来源：<RuntimeSourceReferences sources={sources} sourceIds={["source-vla-cpp"]} /></p>
 </>:strideCopy?<>
  <div className="kernel-matrix-flow" aria-label="FP32 步幅拷贝"><div><strong>读取 x[ix]</strong><span>FP32 · 4 B / 元素</span></div><b>→</b><div><strong>索引与步幅寻址</strong><span>值保持不变</span></div><b>→</b><div><strong>写出 y[iy]</strong><span>FP32 · 4 B / 元素</span></div></div>
  <p>每个线程将展平索引映射到输入和输出各自的步幅，再执行 y[iy] = x[ix]。没有乘加或归约。</p>
  <p>全局存储边界为读 4E B、写 4E B，共 8E B；E 为处理的元素数；元素数与实际步幅待补。</p>
  <p>在「执行与资源」查看缓存、内存和调度指标。</p>
 </>:<p>当前证据未给出可核验的逐步计算公式；保留已确认的实现关联与执行耗时。</p>}
 {projection&&dimensions?<p>输出通道 {dimensions[1]}，序列位置 {dimensions[2]}，输入通道 {dimensions[3]}。A 是投影权重，B 是当前输入；Gate 与 Up 使用相同形状，各自执行。</p>:null}
 {downProjection&&dimensions?<p>Down 投影将中间通道 {dimensions[3]} 映射回隐藏通道 {dimensions[1]}，处理 {dimensions[2]} 个序列位置。A 是投影权重，B 是门控后的中间激活。</p>:null}
 {point?<><h5>单次读写量（{point.traffic.value_kind === 'measured' ? '实测' : '估算'}）</h5><div className="kernel-boundary-flow">{point.traffic.components.map(component=><div key={component.component_id}><strong>{component.tensor_ref ?? component.component_id}</strong><span>{component.kind.includes('write')?'写出':'读入'} · {(component.byte/1e6).toFixed(3)} MB</span></div>)}</div><p>{point.traffic.value_kind === 'measured' ? '读写字节数来自采集记录。' : '按输入、权重各读一次，输出写一次估算；字节数由矩阵大小和数据精度计算。'}</p></>:null}
 </section>;
}
