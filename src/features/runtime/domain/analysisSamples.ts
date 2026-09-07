import type { RunRecord } from '../../../types/atlas';

import policy from '../../../../schema/analysis-policy.json';

export const STABILITY_LIMIT = policy.cv_limit;
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
  const complete=batch.warmup_iterations===policy.warmup_iterations && samples.length===policy.measured_iterations
    && new Set(samples.map(s=>s.sample_index)).size===policy.measured_iterations
    && samples.every(s=>Number.isInteger(s.sample_index) && s.sample_index>=0 && s.sample_index<policy.measured_iterations);
  return {batchId:batch.batch_id,inputCaseId:batch.input_case_id,samples,summary,
    status:!complete?'incomplete':summary?.stable?'stable':'unstable'} as const;
}
