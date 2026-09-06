import { expect, it } from 'vitest';
import { readRoute, routeHref } from '../../../app/routes';
import { buildExecutionHotspots } from './buildExecutionHotspots';
import type { TimelineRecord } from '../../profiler/domain/types';

it('retains input shape and selected capture while mapping old detail URLs into the runtime shell', () => {
  const route = readRoute('?model=pi0&tab=timeline&runtime=flashrt&timelineCapture=capture-a&entity=timeline:event&inputShape=v=3,p=48,a=20,n=10');
  expect(route.tab).toBe('runtime');
  expect(route.analysisView).toBe('system');
  expect(readRoute(routeHref(route, { analysisView: 'reuse' }))).toMatchObject({
    inputShape: 'v=3,p=48,a=20,n=10', timelineCapture: 'capture-a', entity: 'timeline:event', analysisView: 'reuse',
  });
});

it('keeps CPU, API, copies and unmapped GPU timing in the selected capture without treating graph envelopes as kernels', () => {
  const event = {eventId:'',laneId:'cpu',eventKind:'scheduler',label:'running',startNs:0,durationNs:20,count:1,kernelSignatureId:null,bytes:null,copyDirection:null,evidenceSemantics:'scheduler_running_interval'} as const;
  const timeline = { timelineId:'t1',captureId:'c1',runId:'r1',sourceId:'s1',window:{label:'predict',startNs:0,durationNs:100},timeBasis:'relative_to_target_window_start',summaries:[],missing:{},
    lanes:[{laneId:'cpu',kind:'cpu_thread',role:'target-main',ordinal:0,coverage:'partial'}],
    events:[{...event,eventId:'c'}, {...event,eventId:'api',eventKind:'cuda_api',label:'cudaStreamSynchronize',durationNs:50,evidenceSemantics:'exact_interval'}, {...event,eventId:'k',eventKind:'kernel',label:'unmapped',durationNs:30,evidenceSemantics:'exact_interval'}, {...event,eventId:'copy',eventKind:'memcpy',label:'copy',durationNs:10,evidenceSemantics:'exact_interval'}, {...event,eventId:'graph',eventKind:'cuda_graph',label:'graph',durationNs:90,evidenceSemantics:'cuda_graph_execution_span'}],
  } as TimelineRecord;
  const rows = buildExecutionHotspots(timeline);
  expect(rows.map(row=>row.category)).toEqual(['同步调用','GPU Kernel','CPU 调度执行','拷贝']);
  expect(rows.map(row=>row.durationNs)).toEqual([50,30,20,10]);
  expect(rows.every(row=>row.captureId === 'c1')).toBe(true);
  expect(rows.find(row=>row.category === 'GPU Kernel')?.kernelSignatureId).toBeNull();
});
