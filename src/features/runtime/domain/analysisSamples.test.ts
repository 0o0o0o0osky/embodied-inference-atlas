import { expect, it } from 'vitest';
import type { ProfilerEvidence } from '../../profiler/domain/types';
import { buildTraceBatches, summarizeSamples } from './analysisSamples';

function evidence(): ProfilerEvidence {
  return {
    captures: Array.from({length:10},(_,i)=>({captureId:`c${i}`,tool:'nsys',nsys:{reportMode:'node'},coverage:{isCompleteForPopulation:true},
      analysisSample:{batchId:'b1',inputCaseId:'fixed-input',sampleIndex:i,warmupIterations:5,measuredIterations:10,windowStartNs:0,windowEndNs:100+i}})),
    timelines:Array.from({length:10},(_,i)=>({captureId:`c${i}`,window:{durationNs:100+i},events:[
      {eventKind:'kernel',kernelSignatureId:'gemm',durationNs:40+i/10,count:1},
      {eventKind:'kernel',kernelSignatureId:'other',durationNs:20+i/10,count:1},
    ]})),
    signatures:[{kernelSignatureId:'gemm',functionFamily:'gemm',labelSanitized:'GEMM'},{kernelSignatureId:'other',functionFamily:'elementwise',labelSanitized:'activation'}],
    observations:[],metrics:[],links:[],telemetry:[],
  } as unknown as ProfilerEvidence;
}

it('uses the full sample median and sample standard deviation, without removing outliers',()=>{
  expect(summarizeSamples([1,2,3,4])?.median).toBe(2.5);
  expect(summarizeSamples([1,2,3])?.cv).toBe(0.5);
  expect(summarizeSamples([100,100,100,100,100,100,100,100,100,200])?.stable).toBe(false);
});

it('chooses a real trace closest to the batch median after checking hot kernels',()=>{
  const batch=buildTraceBatches(evidence())[0]!;
  expect(batch.status).toBe('stable');
  expect(batch.representativeCaptureId).toBe('c4');
  expect(batch.wall?.median).toBe(104.5);
  expect(batch.checkedHotspots).toHaveLength(2);
});

it('does not accept stable total latency when hot kernel count or time changes',()=>{
  const e=evidence();
  const changed={...e,timelines:e.timelines.map((t,i)=>i===9?{...t,events:t.events.map(v=>({...v,durationNs:v.durationNs*2}))}:t)};
  expect(buildTraceBatches(changed)[0]?.status).toBe('unstable');
  expect(buildTraceBatches(changed)[0]?.representativeCaptureId).toBeNull();
  const missing={...e,timelines:e.timelines.map((t,i)=>i===9?{...t,events:t.events.slice(1)}:t)};
  expect(buildTraceBatches(missing)[0]?.status).toBe('unstable');
});

it('keeps independent batches separate and refuses incomplete or partial populations',()=>{
  const e=evidence();
  const split={...e,captures:e.captures.map((c,i)=>({...c,analysisSample:{...c.analysisSample!,batchId:i<5?'b1':'b2'}}))};
  expect(buildTraceBatches(split).map(b=>b.status)).toEqual(['incomplete','incomplete']);
  const partial={...e,captures:e.captures.map(c=>({...c,coverage:{...c.coverage,isCompleteForPopulation:false}}))};
  expect(buildTraceBatches(partial)[0]?.status).toBe('incomplete');
});

it('keeps unclassified hot kernels from replacing the verified non-GEMM stability check',()=>{
  const e=evidence();
  const unknown={kernelSignatureId:'unknown',functionFamily:'other',classificationConfidence:'unknown',labelSanitized:'unclassified'} as ProfilerEvidence['signatures'][number];
  const mixed={...e,signatures:[...e.signatures,unknown],timelines:e.timelines.map(t=>({...t,events:[...t.events,{...t.events[0]!,kernelSignatureId:'unknown',durationNs:90}]}))};
  expect(buildTraceBatches(mixed)[0]?.checkedHotspots.map(h=>h.label)).toEqual(['GEMM','activation']);
});
