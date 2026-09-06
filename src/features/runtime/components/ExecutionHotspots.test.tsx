import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { atlasSnapshot as atlasDocument } from '../../../testSupport/atlasSnapshot';
import type { AtlasData } from '../../../types/atlas';
import { readRoute } from '../../../app/routes';
import { resolveAnalysisContext } from '../domain/resolveAnalysisContext';
import { timelineEventEntity } from '../../workbench/entityKeys';
import { ExecutionHotspots } from './ExecutionHotspots';

it('retains a selected kernel event when moving from the system timeline to hotspots',()=>{
  const data = atlasDocument as unknown as AtlasData;
  const model = data.datasets.models.find(item=>item.model_id === 'pi0')!;
  const record = data.datasets.model_graphs.find(item=>item.model_id === 'pi0')!;
  const run = data.datasets.runs.find(item=>item.run_id === 'run-pi0-flashrt-nsys-node-001')!;
  const route = readRoute(`?model=pi0&runtime=flashrt&hardware=${run.device_id}&runtimePrecision=${run.precision.precision_id}&workload=${run.configuration_id}`);
  const capture = data.datasets.profiler_captures.find(item=>item.run_id === run.run_id)!;
  route.timelineCapture = String(capture.capture_id);
  const context = resolveAnalysisContext({data,model,record,route});
  const event = context.nsys.active!.timeline.events.find(item=>item.eventKind === 'kernel' && item.kernelSignatureId)!;
  route.entity = timelineEventEntity(context.nsys.active!.timeline.timelineId,event.eventId);
  const markup = renderToStaticMarkup(<ExecutionHotspots data={data} record={record} route={route}
    view={context.nsys} kernels={context.kernels} realization={null} workload={context.normalizedWorkload} navigate={()=>undefined} />);
  expect(markup).toContain('关闭热点详情');
});

it('makes the implementation DAG primary and keeps the full inventory collapsed',()=>{
  const data = atlasDocument as unknown as AtlasData;
  const model = data.datasets.models.find(item=>item.model_id === 'pi0')!;
  const record = data.datasets.model_graphs.find(item=>item.model_id === 'pi0')!;
  for (const [runtime,precision,expected] of [
    ['flashrt','mixed-fp8-e4m3-fp16','前缀 Q/K/V 合并 GEMM'],
    ['vla-cpp','q8_0-weight-only','Q8_0'],
  ]) {
    const route = readRoute(`?model=pi0&tab=runtime&runtime=${runtime}&runtimePrecision=${precision}&workload=v=1,p=48,a=50,n=10`);
    const context = resolveAnalysisContext({data,model,record,route});
    const markup = renderToStaticMarkup(<ExecutionHotspots data={data} record={record} route={route}
      view={context.nsys} kernels={context.kernels} realization={context.implementationRealization} workload={context.normalizedWorkload} navigate={()=>undefined} />);
    expect(markup.indexOf('hotspot-primary-dag')).toBeLessThan(markup.indexOf('hotspot-kernel-inventory'));
    expect(markup).toContain(expected);
    expect(markup).toContain('显示精度');
    expect(markup).toContain('<details class="hotspot-kernel-inventory">');
    expect(markup).not.toContain('hotspot-source-dag');
  }
});

it('renders a real BF16 kernel measurement from one selected prediction window',()=>{
  const data = atlasDocument as unknown as AtlasData;
  const model = data.datasets.models.find(item=>item.model_id === 'pi0')!;
  const record = data.datasets.model_graphs.find(item=>item.model_id === 'pi0')!;
  const run = data.datasets.runs.find(item=>item.run_id === 'run-pi0-vlacpp-w5-r10-001')!;
  const route = readRoute(`?model=pi0&tab=runtime&analysisView=hotspots&runtime=vla-cpp&runtimePrecision=${run.precision.precision_id}&workload=${run.configuration_id}&selectedRun=${run.run_id}`);
  const context = resolveAnalysisContext({data,model,record,route});
  expect(context.nsys.active?.capture.captureId).toBe(context.traceSummary?.representativeCaptureId);
  expect(context.traceSummary?.sampleCount).toBe(10);
  expect(context.traceSummary?.status).toBe('stable');
  expect(context.nsys.active?.capture.coverage.isCompleteForPopulation).toBe(true);
  expect(context.kernels.rows.filter(row=>row.observation.observationKind === 'nsys_window_aggregate').length).toBeGreaterThan(3);
  const event = context.nsys.active!.timeline.events.find(item=>item.kernelSignatureId==='kernel-signature-pi0-vlacpp-bf16-gemm-4096x51x1024')!;
  route.entity = timelineEventEntity(context.nsys.active!.timeline.timelineId,event.eventId);
  const markup = renderToStaticMarkup(<ExecutionHotspots data={context.scopedData} record={record} route={route}
    view={context.nsys} kernels={context.kernels} realization={null} workload={context.normalizedWorkload} navigate={()=>undefined} />);
  expect(markup).toContain(`${(2*4096*51*1024/event.durationNs/1000).toFixed(2)} TFLOP/s`);
  expect(markup).toContain(`${(event.durationNs/1e3).toFixed(2)} μs`);
  expect(markup).toContain('选择真实调用');
  expect(markup).toContain('GEMM 数学维度');
  expect(markup).toContain('计算吞吐');
  expect(markup).toContain('并非实测 DRAM 流量');
  expect(context.kernels.rows.some(row=>row.signature.kernelSignatureId===event.kernelSignatureId && row.capture.tool==='ncu' && row.capture.captureId!==context.nsys.active!.capture.captureId)).toBe(true);
  expect(markup).toContain('执行与资源');
  expect(markup).not.toContain('Kernel NCU 指标');
  expect(context.selectedRun?.run_id).toBe(run.run_id);
});
