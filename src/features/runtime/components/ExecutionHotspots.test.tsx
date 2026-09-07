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
  expect(markup).not.toContain('DAG 定位');
  expect(markup).not.toContain('查看当前 Kernel 的 DAG 关联');
  const cpu = context.nsys.active!.timeline.events.find(item=>item.eventKind==='cuda_api')!;
  route.entity=timelineEventEntity(context.nsys.active!.timeline.timelineId,cpu.eventId);
  const cpuMarkup=renderToStaticMarkup(<ExecutionHotspots data={data} record={record} route={route}
    view={context.nsys} kernels={context.kernels} realization={context.implementationRealization} workload={context.normalizedWorkload} navigate={()=>undefined}/>);
  expect(cpuMarkup).toContain('关闭热点详情');
  expect(cpuMarkup).not.toContain('DAG 定位');
  expect(cpuMarkup).not.toContain('查看当前 Kernel 的 DAG 关联');
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
  expect(markup).toContain('单次读写量（估算）');
  expect(markup).toContain('按输入、权重各读一次，输出写一次估算');
  expect(markup).not.toContain('实际复用尚待证据');
  expect(context.kernels.rows.some(row=>row.signature.kernelSignatureId===event.kernelSignatureId && row.capture.tool==='ncu' && row.capture.captureId!==context.nsys.active!.capture.captureId)).toBe(true);
  expect(markup).toContain('执行与资源');
  expect(markup).not.toContain('Kernel NCU 指标');
  expect(context.selectedRun?.run_id).toBe(run.run_id);
});

it('offers direct DAG location and a readable path for a uniquely mapped selected call',()=>{
  const data=atlasDocument as unknown as AtlasData;
  const model=data.datasets.models.find(item=>item.model_id==='pi0')!;
  const record=data.datasets.model_graphs.find(item=>item.model_id==='pi0')!;
  const run=data.datasets.runs.find(item=>item.run_id==='run-pi0-vlacpp-w5-r10-001')!;
  const route=readRoute(`?model=pi0&tab=runtime&analysisView=hotspots&runtime=vla-cpp&runtimePrecision=${run.precision.precision_id}&workload=${run.configuration_id}&selectedRun=${run.run_id}`);
  const context=resolveAnalysisContext({data,model,record,route});
  const row=context.kernels.rows.find(item=>item.observation.observationKind==='nsys_window_aggregate' && item.links.some(link=>link.realizationId===context.implementationRealization?.realizationId && link.status==='resolved' && link.executionGroupIds.length===1))!;
  const event=context.nsys.active!.timeline.events.find(item=>item.kernelSignatureId===row.signature.kernelSignatureId)!;
  route.entity=timelineEventEntity(context.nsys.active!.timeline.timelineId,event.eventId);
  const markup=renderToStaticMarkup(<ExecutionHotspots data={context.scopedData} record={record} route={route}
    view={context.nsys} kernels={context.kernels} realization={context.implementationRealization} workload={context.normalizedWorkload} navigate={()=>undefined}/>);
  expect(markup).toContain('aria-label="当前 Kernel 的 DAG 位置"');
  expect(markup).toContain('aria-label="定位当前 Kernel 对应的 DAG 计算位置"');
  expect(markup).toContain('选择真实调用');
  expect(markup).not.toContain('在图中选择对应执行组');
  expect(markup).toContain('<details class="hotspot-kernel-inventory">');
});

it('asks for an explicit DAG position when a legacy signature is shared by two groups',()=>{
  const data=atlasDocument as unknown as AtlasData;
  const model=data.datasets.models.find(item=>item.model_id==='pi0')!;
  const record=data.datasets.model_graphs.find(item=>item.model_id==='pi0')!;
  const run=data.datasets.runs.find(item=>item.run_id==='run-pi0-flashrt-nsys-node-001')!;
  const route=readRoute(`?model=pi0&runtime=flashrt&hardware=${run.device_id}&runtimePrecision=${run.precision.precision_id}&workload=${run.configuration_id}`);
  route.timelineCapture='capture-pi0-flashrt-nsys-node-001';
  const context=resolveAnalysisContext({data,model,record,route});
  const event=context.nsys.active!.timeline.events.find(item=>item.kernelSignatureId==='kernel-signature-pi0-encoder-geglu')!;
  route.entity=timelineEventEntity(context.nsys.active!.timeline.timelineId,event.eventId);
  const markup=renderToStaticMarkup(<ExecutionHotspots data={context.scopedData} record={record} route={route}
    view={context.nsys} kernels={context.kernels} realization={context.implementationRealization} workload={context.normalizedWorkload} navigate={()=>undefined}/>);
  expect(markup).toContain('选择 DAG 位置');
  expect(markup).not.toContain('aria-label="定位当前 Kernel 对应的 DAG 计算位置"');
  expect(markup).toContain('前缀编码 /');
  expect(markup).toContain('动作专家 /');
  expect(markup).toContain('第1–17层');
  expect(markup).not.toContain('Prefix GELU × up + FP8 cast');
});

it('keeps a linked Kernel detail visible when its logical graph has not been provided',()=>{
 const data=atlasDocument as unknown as AtlasData;
 const model=data.datasets.models.find(item=>item.model_id==='pi0')!;
 const route=readRoute('?model=pi0&tab=runtime&runtime=flashrt&runtimePrecision=mixed-fp8-e4m3-fp16&workload=config-pi0-flashrt-nsys-node-002');
 const context=resolveAnalysisContext({data,model,record:null,route});
 const event=context.nsys.active!.timeline.events.find(item=>item.kernelSignatureId==='kernel-signature-pi0-flashrt-large-gemm-027')!;
 route.entity=timelineEventEntity(context.nsys.active!.timeline.timelineId,event.eventId);
 const html=renderToStaticMarkup(<ExecutionHotspots data={context.scopedData} record={null} route={route}
   view={context.nsys} kernels={context.kernels} realization={context.implementationRealization} workload={context.normalizedWorkload} navigate={()=>undefined}/>);
 expect(html).toContain('关闭热点详情');expect(html).toContain('选择真实调用');
 expect(html).toContain('执行结构与算子映射尚未填写');
 expect(html).not.toContain('定位当前 Kernel 对应的 DAG 计算位置');
});
