import { atlasSnapshot } from '../../../testSupport/atlasSnapshot';
import { readRoute } from '../../../app/routes';
import { resolveAnalysisContext } from '../domain/resolveAnalysisContext';
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

it('shows the real stride-copy class with symbolic bytes and an independent NCU replay',()=>{
 const data=atlasSnapshot;
 const model=data.datasets.models.find(item=>item.model_id==='pi0')!;
 const record=data.datasets.model_graphs.find(item=>item.model_id==='pi0')!;
 const run=data.datasets.runs.find(item=>item.run_id==='run-pi0-vlacpp-w5-r10-001')!;
 const route=readRoute(`?model=pi0&tab=runtime&runtime=vla-cpp&runtimePrecision=${run.precision.precision_id}&workload=${run.configuration_id}`);
 const context=resolveAnalysisContext({data,model,record,route});
 const rows=context.kernels.rows.filter(row=>row.signature.kernelSignatureId==='kernel-signature-pi0-vlacpp-fp32-stride-copy-036');
 const row=rows.find(row=>row.capture.tool==='nsys')!;
 expect(row).toBeDefined();
 expect(rows.some(other=>other.capture.tool==='ncu' && other.capture.captureId!==row.capture.captureId)).toBe(true);
 const markup=renderToStaticMarkup(<KernelComputation row={row}/>);
 expect(markup).toContain('FP32 步幅拷贝');
 expect(markup).toContain('8E B');
 expect(markup).toContain('元素数 E 与实际步幅未记录');
 expect(markup).not.toMatch(/\d+(?:\.\d+)?\s*(?:MB|GB|TFLOP)/);
 expect(markup).not.toContain('GEMM 数学维度');
});
