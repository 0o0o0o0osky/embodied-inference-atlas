import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { atlasSnapshot as data } from '../../../testSupport/atlasSnapshot';
import { readRoute } from '../../../app/routes';
import { resolveAnalysisContext } from './resolveAnalysisContext';
import { KernelComputation } from '../components/KernelComputation';
import { KernelNcuMetrics } from '../components/KernelNcuMetrics';

it('opens both measured cases with their own implementation, stable trace and independent counters',()=>{
  const model=data.datasets.models.find(r=>r.model_id==='pi0')!;
  const record=data.datasets.model_graphs.find(r=>r.model_id==='pi0')!;
  for (const [runId,runtime,chunk,signature,formula,group] of [
    ['run-pi0-realtime-vla-w5-r10-001','realtime-vla',50,'kernel-signature-pi0-realtime-vla-gate-up-fusion-017','Gate Up 融合计算','prefix-gate-up'],
    ['run-pi0-flashrt-fixed-e2e-001','flashrt',10,'kernel-signature-pi0-flashrt-geglu-fp8-028','GEGLU 与 FP8 转换','prefix-geglu-fp8'],
    ['run-pi0-flashrt-fixed-e2e-001','flashrt',10,'kernel-signature-pi0-flashrt-large-gemm-027','前缀 Gate/Up 合并 GEMM','prefix-merged-gate-up'],
  ] as const) {
    const run=data.datasets.runs.find(r=>r.run_id===runId)!;
    const route=readRoute(`?model=pi0&tab=runtime&runtime=${runtime}&runtimePrecision=${run.precision.precision_id}&workload=${run.configuration_id}&selectedRun=${runId}`);
    const context=resolveAnalysisContext({data,model,record,route});
    expect(context.implementationRealization?.runtimeId).toBe(runtime);
    expect(context.selectedRun?.workload.vla?.action_chunk).toBe(chunk);
    expect(context.traceSummary?.status).toBe('stable');
    expect(context.nsys.active?.capture.runId).not.toBe(runId);
    const rows=context.kernels.rows.filter(r=>r.signature.kernelSignatureId===signature);
    const native=rows.find(r=>r.capture.tool==='nsys')!;
    expect(native).toBeDefined();
    expect(native.links.some(link=>link.status==='resolved' && link.executionGroupIds.includes(group))).toBe(true);
    expect(rows.filter(r=>r.capture.tool==='ncu')).toHaveLength(1);
    expect(renderToStaticMarkup(<KernelComputation row={native}/>)).toContain(formula);
    const metrics=renderToStaticMarkup(<KernelNcuMetrics rows={rows}/>);
    expect(metrics).toContain('occupancy');
    expect(metrics).toContain('SM 吞吐');
    expect(context.captureIdentities.endToEnd?.runId).toBe(runId);
  }
});
