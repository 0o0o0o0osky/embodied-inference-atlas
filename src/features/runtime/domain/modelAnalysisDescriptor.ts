import type {AtlasData} from '../../../types/atlas';
import {buildEvidenceRows,type EvidenceRow} from '../../end-to-end/domain/buildEvidenceRows';
export interface ModelAnalysisDescriptor {
 modelId:string;
 comparisonKind:'pi0-target'|'existing';
 defaultWorkload:string|null;
}
export function modelAnalysisDescriptor(data:AtlasData,modelId:string):ModelAnalysisDescriptor {
 const run=data.datasets.runs.filter(item=>item.model_id===modelId && item.evidence==='measured_local').sort((a,b)=>a.run_id.localeCompare(b.run_id))[0];
 return {modelId,comparisonKind:modelId==='pi0'?'pi0-target':'existing',defaultWorkload:modelId==='pi0'?'v=1,p=48,a=50,n=10':run?.configuration_id ?? null};
}
export function existingComparisons(data:AtlasData,modelId:string,hardwareId:string|null,includeLegacy:boolean):readonly EvidenceRow[] {
 return buildEvidenceRows(data,modelId,{runtimeId:null,hardwareId,entity:null}).allRows.filter(row=>row.run.evidence==='measured_local' && row.measurement.evidence==='measured_local'
  && (!hardwareId || row.run.device_id===hardwareId) && row.measurement.metric==='latency' && row.measurement.measurementMethod==='wall_clock'
  && (includeLegacy || row.run.timing.warmup_iterations===5 && row.measurement.sampleCount===10));
}
/** Same complete input and measurement contract; runtime and actual precision are compared, batches are not pooled. */
export function existingComparisonKey(row:EvidenceRow):string {
 return JSON.stringify([row.run.model_id,row.run.model_artifact_id,row.run.device_id,row.run.workload.common,row.run.workload.vla,
  row.run.timing,row.run.operating_point,row.measurement.timingBoundaryId,row.measurement.workUnit,row.measurement.measurementMethod,row.measurement.sampleCount]);
}
export function existingShapeLabel(row:EvidenceRow):string {
 const v=row.run.workload.vla;
 const value=(item:number|null|undefined)=>item==null?'未记录':String(item);
 return `${value(v?.camera_views)} 视角 · prompt ${value(v?.executed_prompt_tokens)}（语义 ${value(v?.semantic_prompt_tokens)}）· chunk ${value(v?.action_chunk)} · ${value(v?.denoise_steps)} 步 · ${value(v?.image_height)}×${value(v?.image_width)} · 动作维度 ${value(v?.action_dimension)}`;
}
