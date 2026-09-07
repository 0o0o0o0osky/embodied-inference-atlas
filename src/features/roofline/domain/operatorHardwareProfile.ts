import type {AttentionRates} from './attentionEstimate';
import type {InstructionOperation,RooflineCeilingRecord} from './types';

export interface AttentionHardwareProfile {
  rates: Pick<AttentionRates,'scalarOp'|'exp'|'reciprocal'|'reductionAdd'|'reductionCompare'>;
  conditional: boolean;
}

/** Rates belong to an explicit device/operating point; absence never borrows another profile. */
function instructionProfile(ceiling:RooflineCeilingRecord|null) {
  const profile=ceiling?.operation_rates;
  const eligible=profile && ceiling && profile.device_id===ceiling.device_id
    && profile.operating_point_id===ceiling.operating_point.operating_point_id
    && profile.gpu_clock_hz===ceiling.operating_point.gpu_clock_hz
    && ceiling.operating_point.clock_basis!=='unknown';
  const entries=eligible?profile.rates:[];
  const rate=(operation:InstructionOperation):number|null=>{
    const matches=entries.filter(entry=>entry.operations.includes(operation));
    if(matches.length!==1)return null;
    const entry=matches[0]!;
    const resource=operation.startsWith('fp32_')?'cuda_fp32':'sfu';
    return entry.resource===resource && entry.operation_per_second!=null
      && Number.isFinite(entry.operation_per_second) && entry.operation_per_second>0
      ? entry.operation_per_second:null;
  };
  return {rate,conditional:entries.some(entry=>entry.operation_per_second!=null
    && entry.provenance.class!=='published_fact' && entry.provenance.class!=='measured_empirical')};
}

export function resolveAttentionHardwareProfile(ceiling:RooflineCeilingRecord|null):AttentionHardwareProfile {
  const {rate,...metadata}=instructionProfile(ceiling);
  return {...metadata,rates:{scalarOp:rate('fp32_scalar'),reductionAdd:rate('fp32_reduce_add'),
    reductionCompare:rate('fp32_max'),exp:rate('exp2'),reciprocal:rate('reciprocal')}};
}

export interface NormalizationHardwareProfile {
  rates:{scalarOp:number|null;reductionAdd:number|null;rsqrt:number|null};
  conditional:boolean;
}
export function resolveNormalizationHardwareProfile(ceiling:RooflineCeilingRecord|null):NormalizationHardwareProfile {
  const {rate,...metadata}=instructionProfile(ceiling);
  return {...metadata,rates:{scalarOp:rate('fp32_scalar'),reductionAdd:rate('fp32_reduce_add'),rsqrt:rate('rsqrt')}};
}

export function resolveRemainingHardwareProfile(ceiling:RooflineCeilingRecord|null): {
  rates:Record<'scalarOp'|'reductionAdd'|'exp'|'reciprocal'|'rsqrt'|'sin'|'cos',number|null>;
  conditional:boolean;
} {
  const {rate,...metadata}=instructionProfile(ceiling);
  return {...metadata,rates:{scalarOp:rate('fp32_scalar'),reductionAdd:rate('fp32_reduce_add'),
    exp:rate('exp2'),reciprocal:rate('reciprocal'),rsqrt:rate('rsqrt'),sin:rate('sin'),cos:rate('cos')}};
}
