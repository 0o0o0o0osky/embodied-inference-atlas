import { renderToStaticMarkup } from 'react-dom/server';
import { expect,it } from 'vitest';
import { KernelResources,KernelComputation } from './KernelComputation';
import type { KernelRow } from '../../performance/domain/buildKernelRows';
it('shows recorded launch zero values without inferring thread tiles',()=>{
 const markup=renderToStaticMarkup(<KernelResources launch={{grid:[8,2,1],block:[256,1,1],registersPerThread:21,staticSharedMemoryBytes:0,dynamicSharedMemoryBytes:0,wavesPerSm:null}}/>);
 expect(markup).toContain('8 × 2 × 1');expect(markup).toContain('0 B');
 expect(markup).not.toContain('Waves / SM');expect(markup).toContain('未记录实际 tile');
});
it('keeps precision conflicts visible even without a roofline point',()=>{
 const row={signature:{precisionPath:{inputDtypeClass:null,accumulatorDtypeClass:null,outputDtypeClass:null,missing:{}},missing:{run_precision_linkage:'precision_conflict'}}} as unknown as KernelRow;
 const markup=renderToStaticMarkup(<KernelComputation row={row}/>);
 expect(markup).toContain('精度证据冲突');expect(markup).toContain('输入 未记录');
 expect(markup).not.toContain('GEMM 数学维度');
});

it('explains only source-audited conversion signatures and leaves element count symbolic',()=>{
 const row={signature:{kernelSignatureId:'kernel-signature-pi0-vlacpp-fp32-to-bf16-conversion-009',precisionPath:{inputDtypeClass:'fp32',outputDtypeClass:'bf16',accumulatorDtypeClass:null,missing:{}},missing:{}}} as unknown as KernelRow;
 const markup=renderToStaticMarkup(<KernelComputation row={row}/>);
 expect(markup).toContain('已确认的元素转换');expect(markup).toContain('总计 6E B');expect(markup).toContain('不能从 Grid 反推');
 expect(renderToStaticMarkup(<KernelComputation row={{...row,signature:{...row.signature,kernelSignatureId:'other-conversion'}}}/>)).not.toContain('已确认的元素转换');
});
