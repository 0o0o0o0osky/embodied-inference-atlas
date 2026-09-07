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
 expect(markup).not.toContain('Waves / SM');expect(markup).not.toContain('未记录实际 tile');
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
 expect(markup).toContain('已确认的元素转换');expect(markup).toContain('总计 6E B');expect(markup).toContain('E 为处理的元素数');
 expect(renderToStaticMarkup(<KernelComputation row={{...row,signature:{...row.signature,kernelSignatureId:'other-conversion'}}}/>)).not.toContain('已确认的元素转换');
 const withSources=renderToStaticMarkup(<KernelComputation row={row} sources={atlasSnapshot.datasets.sources}/>);
 expect(withSources).toContain('https://github.com/VinRobotics/vla.cpp');
 expect(withSources).not.toContain('source-vla-cpp');expect(withSources).not.toContain('458681e1');
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
 expect(markup).toContain('元素数与实际步幅待补');
 expect(markup).not.toMatch(/\d+(?:\.\d+)?\s*(?:MB|GB|TFLOP)/);
 expect(markup).not.toContain('GEMM 数学维度');
});

it('shows the audited FlashRT merged projection only with its resolved implementation link',()=>{
 const row={links:[{status:'resolved',executionGroupIds:['prefix-merged-gate-up']}],observation:{observationKind:'nsys_window_aggregate'},signature:{kernelSignatureId:'kernel-signature-pi0-flashrt-large-gemm-027',precisionPath:{inputDtypeClass:'fp8_e4m3',accumulatorDtypeClass:'fp32',outputDtypeClass:null,missing:{}},missing:{}}} as unknown as KernelRow;
 const markup=renderToStaticMarkup(<KernelComputation row={row}/>);
 expect(markup).toContain('前缀 Gate/Up 合并 GEMM');
 expect(markup).toContain('304 × 2048');expect(markup).toContain('2048 × 32768');
 expect(markup).toContain('FP32 累加');expect(markup).toContain('α');
 expect(markup).toContain('028');expect(markup).not.toContain('TFLOP/s');
 expect(markup).toContain('FP16（实现关联）');
 const unconfirmed={...row,links:[]};
 expect(renderToStaticMarkup(<KernelComputation row={unconfirmed}/>)).not.toContain('304 × 2048');
 const replay={...row,observation:{...row.observation,observationKind:'ncu_replayed_launch' as const}};
 expect(renderToStaticMarkup(<KernelComputation row={replay}/>)).toContain('输出 未记录');
});

it('fills missing native precision only from current resolved source-backed groups, never from replay or an unlinked name',()=>{
 const data=atlasSnapshot,model=data.datasets.models.find(item=>item.model_id==='pi0')!,record=data.datasets.model_graphs.find(item=>item.model_id==='pi0')!;
 const route=readRoute('?model=pi0&tab=runtime&runtime=flashrt&runtimePrecision=mixed-fp8-e4m3-fp16&workload=config-pi0-flashrt-nsys-node-002');
 const context=resolveAnalysisContext({data,model,record,route});
 const row=context.kernels.rows.find(row=>row.capture.captureId===context.nsys.active?.capture.captureId && row.signature.kernelSignatureId==='kernel-signature-pi0-flashrt-nvjet-64x16-041')!;
 const realization=context.implementationRealization!;
 const render=(candidate:KernelRow,impl=realization)=>renderToStaticMarkup(<KernelComputation row={candidate} realization={impl} sources={data.datasets.sources}/>);
 const markup=render(row);
 expect(markup).toContain('FP8_E4M3（实现关联）');expect(markup).toContain('FP32（实现关联）');expect(markup).toContain('FP16（实现关联）');
 expect(markup).toContain('https://github.com/flashrt-project/FlashRT');
 expect(row.signature.precisionPath.inputDtypeClass).toBeNull();
 expect(render({...row,links:[]})).not.toContain('（实现关联）');
 expect(render({...row,observation:{...row.observation,observationKind:'ncu_replayed_launch'}})).not.toContain('（实现关联）');
 expect(render(row,{...realization,evidence:[]})).not.toContain('（实现关联）');
 expect(render({...row,signature:{...row.signature,missing:{run_precision_linkage:'precision_conflict'}}})).not.toContain('（实现关联）');
});

it('shows the audited action Gate/Up computation from its current resolved group without a synthetic Roofline',()=>{
 const data=atlasSnapshot,model=data.datasets.models.find(item=>item.model_id==='pi0')!,record=data.datasets.model_graphs.find(item=>item.model_id==='pi0')!;
 const route=readRoute('?model=pi0&tab=runtime&runtime=flashrt&runtimePrecision=mixed-fp8-e4m3-fp16&workload=config-pi0-flashrt-nsys-node-002');
 const context=resolveAnalysisContext({data,model,record,route});
 const row=context.kernels.rows.find(row=>row.capture.captureId===context.nsys.active?.capture.captureId && row.signature.kernelSignatureId==='kernel-signature-pi0-flashrt-nvjet-512x16-043')!;
 const markup=renderToStaticMarkup(<KernelComputation row={row} realization={context.implementationRealization} sources={data.datasets.sources}/>);
 expect(markup).toContain('X[11,1024] × 合并权重[1024,8192]');
 expect(markup).toContain('FP16 Gate/Up，随后独立 GEGLU');
 expect(markup).toContain('10 步 × 18 层');
 expect(markup).not.toContain('当前证据未给出');
 expect(markup).not.toContain('TFLOP/s');
 expect(markup).toContain('<details><summary>实现来源</summary>');
 expect(renderToStaticMarkup(<KernelComputation row={{...row,links:[]}} realization={context.implementationRealization}/>)).not.toContain('X[11,1024]');
});
