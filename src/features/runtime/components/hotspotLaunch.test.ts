import { expect,it } from 'vitest';
import type { TimelineRecord } from '../../profiler/domain/types';
import { buildExecutionHotspots } from '../domain/buildExecutionHotspots';
it('keeps different launch configurations separate within one signature',()=>{
 const timeline={captureId:'c',window:{startNs:0,durationNs:1000},lanes:[],events:[32,64,32].map((block,i)=>({eventId:String(i),eventKind:'kernel',kernelSignatureId:'same',label:'same',laneId:'gpu',startNs:i*100,durationNs:20,count:1,evidenceSemantics:'exact_interval',launch:{grid:[1,1,1],block:[block,1,1],registersPerThread:8,staticSharedMemoryBytes:0,dynamicSharedMemoryBytes:0,wavesPerSm:null}}))} as unknown as TimelineRecord;
 const rows=buildExecutionHotspots(timeline);
 expect(rows).toHaveLength(2);expect(rows.map(row=>row.count)).toEqual([2,1]);
});

it('labels OS wait wall time separately from scheduled CPU running time',()=>{
 const timeline={captureId:'c',window:{startNs:0,durationNs:1000},lanes:[],events:[{eventId:'wait',eventKind:'osrt',apiName:'pthread_cond_wait',label:'OS调用',laneId:'cpu',startNs:0,durationNs:20,count:1,evidenceSemantics:'exact_interval',kernelSignatureId:null}]} as unknown as TimelineRecord;
 const row=buildExecutionHotspots(timeline)[0]!;
 expect(row.category).toBe('OS 等待调用');expect(row.timeMeaning).toContain('不是 CPU 调度运行时间');
});
