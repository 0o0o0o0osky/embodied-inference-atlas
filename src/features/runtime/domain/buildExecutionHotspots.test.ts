import { it, expect } from 'vitest';
import type { TimelineRecord } from '../../profiler/domain/types';
import { buildExecutionHotspots } from './buildExecutionHotspots';

it('keeps recorded API names separate even when their sanitized labels are identical',()=>{
  const trace={timelineId:'t',captureId:'c',window:{startNs:0,durationNs:100},lanes:[{laneId:'api',kind:'cuda_api',coverage:'complete'}],events:[
    {eventId:'submit',eventKind:'cuda_api',apiName:'cudaGraphLaunch',label:'cuda-api-call',laneId:'api',startNs:0,durationNs:10,count:1,evidenceSemantics:'exact_interval',kernelSignatureId:null},
    {eventId:'sync',eventKind:'cuda_api',apiName:'cudaEventSynchronize',label:'cuda-api-call',laneId:'api',startNs:20,durationNs:60,count:1,evidenceSemantics:'exact_interval',kernelSignatureId:null},
  ]} as unknown as TimelineRecord;
  expect(buildExecutionHotspots(trace).map(r=>r.category)).toEqual(['同步调用','提交调用']);
});
