import type { ProfilerEvidence } from '../../profiler/domain/types';
import type { RunRecord } from '../../../types/atlas';
import { kernelLaunchKey } from './buildExecutionHotspots';

export const STABILITY_LIMIT = 0.05;
export function summarizeSamples(values: readonly number[]) {
  if (!values.length || values.some(v=>!Number.isFinite(v) || v < 0)) return null;
  const sorted=[...values].sort((a,b)=>a-b);
  const middle=Math.floor(sorted.length/2);
  const median=sorted.length%2 ? sorted[middle]! : (sorted[middle-1]!+sorted[middle]!)/2;
  const mean=values.reduce((a,b)=>a+b,0)/values.length;
  const deviation=values.length>1 ? Math.sqrt(values.reduce((sum,v)=>sum+(v-mean)**2,0)/(values.length-1)) : null;
  const cv=deviation!==null && mean>0 ? deviation/mean : null;
  return {median,mean,cv,min:sorted[0]!,max:sorted.at(-1)!,count:values.length,stable:cv!==null && cv<=STABILITY_LIMIT};
}

export function endToEndBatch(run: RunRecord | null) {
  const batch=run?.analysis_batch;
  if (!batch) return null;
  const samples=batch.samples;
  const summary=summarizeSamples(samples.map(s=>s.wall_time_ns));
  const complete=batch.warmup_iterations===5 && samples.length===10
    && new Set(samples.map(s=>s.sample_index)).size===10
    && samples.every(s=>Number.isInteger(s.sample_index) && s.sample_index>=0 && s.sample_index<10);
  return {batchId:batch.batch_id,inputCaseId:batch.input_case_id,samples,summary,
    status:!complete?'incomplete':summary?.stable?'stable':'unstable'} as const;
}

export function buildTraceBatches(evidence: ProfilerEvidence) {
  const timelines=new Map(evidence.timelines.map(t=>[t.captureId,t]));
  const grouped=new Map<string, typeof evidence.captures[number][]>();
  for (const capture of evidence.captures) {
    if (capture.tool!=='nsys' || capture.nsys?.reportMode!=='node' || !capture.analysisSample) continue;
    const sample=capture.analysisSample;
    const key=`${sample.batchId}|${sample.inputCaseId}`;
    const list=grouped.get(key)??[];
    list.push(capture);grouped.set(key,list);
  }
  return [...grouped.values()].map(captures=>{
    captures.sort((a,b)=>a.analysisSample!.sampleIndex-b.analysisSample!.sampleIndex);
    const meta=captures[0]!.analysisSample!;
    const samples=captures.flatMap(capture=>{
      const timeline=timelines.get(capture.captureId);
      if (!timeline) return [];
      const kernels=new Map<string,{durationNs:number;count:number}>();
      for (const event of timeline.events) {
        if (event.eventKind!=='kernel' || !event.kernelSignatureId) continue;
        const key=`${event.kernelSignatureId}|${kernelLaunchKey(event.launch)}`;
        const value=kernels.get(key)??{durationNs:0,count:0};
        value.durationNs+=event.durationNs;value.count+=event.count;
        kernels.set(key,value);
      }
      return [{captureId:capture.captureId,sampleIndex:capture.analysisSample!.sampleIndex,wallNs:timeline.window.durationNs,kernels}];
    });
    const ids=[...new Set(samples.flatMap(s=>[...s.kernels.keys()]))];
    const candidates=ids.map(id=>{
      const signature=evidence.signatures.find(s=>id.startsWith(`${s.kernelSignatureId}|`));
      const values=samples.map(s=>s.kernels.get(id)??null);
      const summary=values.every(v=>v!==null)?summarizeSamples(values.map(v=>v!.durationNs)):null;
      return {id,label:signature?.labelSanitized??id,isGemm:signature?.functionFamily==='gemm',
        isKnownNonGemm:Boolean(signature && signature.functionFamily!=='gemm' && signature.functionFamily!=='other' && signature.classificationConfidence!=='unknown'),summary,
        countsMatch:values.every(v=>v!==null && v.count===values[0]?.count),
        // A disappearing class still participates in ranking; it fails the check below.
        rank:summarizeSamples(values.flatMap(v=>v?[v.durationNs]:[]))?.median??0};
    }).sort((a,b)=>b.rank-a.rank || a.id.localeCompare(b.id));
    const checkedHotspots=[...candidates.filter(c=>c.isGemm).slice(0,2),...candidates.filter(c=>c.isKnownNonGemm).slice(0,1)];
    const wall=summarizeSamples(samples.map(s=>s.wallNs));
    const complete=samples.length===10 && new Set(samples.map(s=>s.sampleIndex)).size===10
      && samples.every(s=>s.sampleIndex>=0 && s.sampleIndex<10)
      && captures.every(c=>c.analysisSample!.warmupIterations===5 && c.analysisSample!.measuredIterations===10 && c.coverage.isCompleteForPopulation);
    const metricsStable=complete && wall?.stable && checkedHotspots.length>0
      && checkedHotspots.every(h=>h.countsMatch && h.summary?.stable);
    const nearMedian=(value:number,median:number)=>median>0 && Math.abs(value-median)/median<=STABILITY_LIMIT;
    const eligible=metricsStable?samples.filter(s=>nearMedian(s.wallNs,wall!.median)
      && checkedHotspots.every(h=>nearMedian(s.kernels.get(h.id)!.durationNs,h.summary!.median))):[];
    eligible.sort((a,b)=>Math.abs(a.wallNs-wall!.median)-Math.abs(b.wallNs-wall!.median) || a.sampleIndex-b.sampleIndex);
    const representativeCaptureId=eligible[0]?.captureId??null;
    const status=!complete?'incomplete':representativeCaptureId?'stable':'unstable';
    return {batchId:meta.batchId,inputCaseId:meta.inputCaseId,samples,wall,checkedHotspots,
      status:status as 'stable'|'unstable'|'incomplete',representativeCaptureId,
      schedulerPresent:captures.every(c=>c.nsys?.schedulerTracePresent)};
  }).sort((a,b)=>Number(b.status==='stable')-Number(a.status==='stable')
    || Number(b.schedulerPresent)-Number(a.schedulerPresent) || a.batchId.localeCompare(b.batchId));
}
export type TraceBatchAnalysis=ReturnType<typeof buildTraceBatches>[number];
