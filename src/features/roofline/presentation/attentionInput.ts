import type { OperatorDetail, MaterializedTensor } from '../../model-graph/domain/types';
import type { AttentionShape } from '../domain/attentionEstimate';
import type { PrecisionSegment, RooflineScenarioRecord } from '../domain/types';

export function attentionShapeFromDetail(detail: OperatorDetail): AttentionShape | null {
  if (detail.definitionId !== 'attention-core') return null;
  const tensor = (port: string) => detail.inputs.find(item => item.port === port)?.tensor;
  const q=tensor('query'), k=tensor('key'), v=tensor('value');
  if (!q || !k || !v) return null;
  const axis=(t:MaterializedTensor,names:string[]) => t.shape[t.axes.findIndex(a=>names.includes(a.axis))] ?? null;
  const queryHeads=axis(q,['query_heads','query_head','head']);
  const kvHeads=axis(k,['kv_heads','kv_head','head']);
  const queryTokens=axis(q,['query_tokens','query_sequence','sequence']);
  const keyTokens=axis(k,['key_value_tokens','key_sequence','sequence']);
  const qkDimension=axis(q,['head_width','head_dim']);
  const valueDimension=axis(v,['head_width','head_dim']);
  if (![queryHeads,kvHeads,queryTokens,keyTokens,qkDimension,valueDimension,...q.shape].every(n=>n!==null && Number.isSafeInteger(n) && n>0)) return null;
  const batch=q.shape.reduce<number>((p,n)=>p*n!,1)/(queryHeads!*queryTokens!*qkDimension!);
  if (!Number.isSafeInteger(batch) || batch<1 || queryHeads! % kvHeads! !== 0) return null;
  const batchOf=(t:MaterializedTensor,heads:number,tokens:number,width:number)=>
    t.shape.every(n=>n!==null && Number.isSafeInteger(n) && n>0) ? t.shape.reduce<number>((p,n)=>p*n!,1)/(heads*tokens*width) : null;
  if (axis(k,['head_width','head_dim'])!==qkDimension
    || axis(v,['kv_heads','kv_head','head'])!==kvHeads
    || axis(v,['key_value_tokens','key_sequence','sequence'])!==keyTokens
    || batchOf(k,kvHeads!,keyTokens!,qkDimension!)!==batch
    || batchOf(v,kvHeads!,keyTokens!,valueDimension!)!==batch) return null;
  return {batch,queryHeads:queryHeads!,kvHeads:kvHeads!,queryTokens:queryTokens!,keyTokens:keyTokens!,qkDimension:qkDimension!,valueDimension:valueDimension!};
}

/** Only unambiguous logical/uniform selection. Runtime execution-group precision needs its mapping. */
export function operationPrecision(detail:OperatorDetail,scenario:RooflineScenarioRecord):PrecisionSegment|null {
 const matches=scenario.precision_path.segments.filter(s=>s.selector.kind==='all' || s.selector.kind==='logical_refs' && s.selector.refs.includes(detail.ref));
 return matches.length===1 ? matches[0]! : null;
}
export function plainAttentionStorage(segment:PrecisionSegment):boolean {
 return [segment.activation,segment.output].every(e=>e.padding==='none' && e.tensor_scale_bytes===0 && e.scale_bytes_per_block===0 && e.zero_point_bytes_per_block===0 && e.bits_per_value>=16);
}
