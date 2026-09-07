/** Dense attention operation bounds. Rates are caller-supplied, never device defaults. */
export interface AttentionShape {
  batch: number;
  queryHeads: number;
  kvHeads: number;
  queryTokens: number;
  keyTokens: number;
  qkDimension: number;
  valueDimension: number;
}
export interface AttentionBytes {
  query: number; key: number; value: number; score: number; probability: number; output: number;
}
export type AttentionMask = {kind: 'none'} | {kind: 'additive'; bytesPerElement: number};
export type AttentionResource = 'matmulFlop' | 'scalarOp' | 'exp' | 'reciprocal' | 'reductionAdd' | 'reductionCompare';
export type AttentionWork = Record<AttentionResource, number>;
/** scalar/reduction rates are ordinary operations/s, not FMA FLOPs/s. */
export type AttentionRates = Record<AttentionResource | 'globalByte', number | null>;
export interface AttentionResourceDemand {
  /** Sum of known operation times sharing this resource. */
  knownSeconds: number;
  /** Null when any nonzero operation lacks its own supported throughput. */
  seconds: number | null;
}
export type AttentionResourceDemands = Record<'tensor' | 'cuda' | 'sfu' | 'memory', AttentionResourceDemand>;
export interface AttentionEstimateInput {
  shape: AttentionShape;
  /** Storage widths of the same input/output tensors in both execution paths. */
  bytes: AttentionBytes;
  mask: AttentionMask;
  rates: AttentionRates;
}
export interface AttentionStage {
  id: 'qk' | 'softmax' | 'pv' | 'fused';
  work: AttentionWork;
  globalBytes: number;
  resourceSeconds: Record<AttentionResource | 'globalByte', number | null>;
  resourceDemands: AttentionResourceDemands;
  missingRates: (AttentionResource | 'globalByte')[];
  /** A bound from available terms; missing terms can only make it weaker. */
  lowerBoundSeconds: number;
  /** Complete only for the declared ideal operation model, not the full implementation. */
  complete: boolean;
}
export interface AttentionPathEstimate {
  kind: 'separate' | 'fused';
  stages: AttentionStage[];
  work: AttentionWork;
  globalBytes: number;
  lowerBoundSeconds: number;
  complete: boolean;
  missingRates: (AttentionResource | 'globalByte')[];
  /** GEMM-equivalent axes: numerator excludes exp, comparisons and scalar work. */
  referencePoint: { matmulFlop: number; arithmeticIntensity: number; matmulFlopPerSecond: number | null };
  assumptions: readonly string[];
}
const resources: AttentionResource[] = ['matmulFlop','scalarOp','exp','reciprocal','reductionAdd','reductionCompare'];
const zeroWork = (): AttentionWork => ({matmulFlop:0,scalarOp:0,exp:0,reciprocal:0,reductionAdd:0,reductionCompare:0});
function positive(value: number, name: string, integer = false) {
  if (!Number.isFinite(value) || value <= 0 || integer && !Number.isSafeInteger(value)) throw new Error(`${name} must be positive${integer ? ' safe integer' : ''}`);
}
function sumWork(stages: readonly AttentionStage[]): AttentionWork {
  return Object.fromEntries(resources.map(key=>[key,stages.reduce((sum,stage)=>sum+stage.work[key],0)])) as AttentionWork;
}
function stage(id: AttentionStage['id'], work: AttentionWork, globalBytes: number, rates: AttentionRates): AttentionStage {
  const counts = {...work,globalByte:globalBytes};
  const keys = [...resources,'globalByte'] as const;
  const missingRates = keys.filter(key=>counts[key]>0 && rates[key]===null);
  const resourceSeconds = Object.fromEntries(keys.map(key=>[key,counts[key]===0 ? 0 : rates[key]===null ? null : counts[key]/rates[key]!])) as AttentionStage['resourceSeconds'];
  const demand = (terms: readonly (AttentionResource | 'globalByte')[]): AttentionResourceDemand => {
    const values=terms.map(key=>resourceSeconds[key]);
    const knownSeconds=values.reduce<number>((sum,value)=>sum+(value ?? 0),0);
    return {knownSeconds,seconds:values.some(value=>value===null)?null:knownSeconds};
  };
  const resourceDemands:AttentionResourceDemands={tensor:demand(['matmulFlop']),
    cuda:demand(['scalarOp','reductionAdd','reductionCompare']),sfu:demand(['exp','reciprocal']),memory:demand(['globalByte'])};
  return {id,work,globalBytes,resourceSeconds,resourceDemands,missingRates,complete:!missingRates.length,
    lowerBoundSeconds:Math.max(0,...Object.values(resourceDemands).map(value=>value.knownSeconds))};
}
function path(kind: AttentionPathEstimate['kind'], stages: AttentionStage[], assumptions: string[]): AttentionPathEstimate {
  const work=sumWork(stages),globalBytes=stages.reduce((sum,s)=>sum+s.globalBytes,0);
  const lowerBoundSeconds=stages.reduce((sum,s)=>sum+s.lowerBoundSeconds,0);
  return {kind,stages,work,globalBytes,lowerBoundSeconds,complete:stages.every(s=>s.complete),
    missingRates:[...new Set(stages.flatMap(s=>s.missingRates))],
    referencePoint:{matmulFlop:work.matmulFlop,arithmeticIntensity:work.matmulFlop/globalBytes,
      matmulFlopPerSecond:lowerBoundSeconds>0 ? work.matmulFlop/lowerBoundSeconds : null},assumptions};
}

/**
 * Separate: QK -> scale/additive mask/stable softmax -> PV, each phase bounded by
 * max(resource times, global memory time). Fused: max over total resource work
 * with ideal global-boundary traffic. Neither is a measured latency prediction.
 */
export function estimateAttention(input: AttentionEstimateInput): {separate: AttentionPathEstimate; fused: AttentionPathEstimate} {
  const {shape:s,bytes:b,mask,rates}=input;
  for(const [key,value] of Object.entries(s))positive(value,key,true);
  if(s.queryHeads%s.kvHeads!==0)throw new Error('queryHeads must be a multiple of kvHeads');
  for(const [key,value] of Object.entries(b))positive(value,`${key} bytes`);
  if(mask.kind==='additive')positive(mask.bytesPerElement,'mask bytes');
  for(const key of [...resources,'globalByte'] as const)if(rates[key]!==null)positive(rates[key]!,`${key} rate`);
  const rows=s.batch*s.queryHeads*s.queryTokens, scores=rows*s.keyTokens;
  const qBytes=rows*s.qkDimension*b.query;
  const kBytes=s.batch*s.kvHeads*s.keyTokens*s.qkDimension*b.key;
  const vBytes=s.batch*s.kvHeads*s.keyTokens*s.valueDimension*b.value;
  const outBytes=rows*s.valueDimension*b.output;
  const scoreBytes=scores*b.score,probabilityBytes=scores*b.probability;
  const maskBytes=mask.kind==='additive'?scores*mask.bytesPerElement:0;
  const qk=stage('qk',{...zeroWork(),matmulFlop:2*scores*s.qkDimension},qBytes+kBytes+scoreBytes,rates);
  const softmax=stage('softmax',{...zeroWork(),
    // scale, subtract row maximum, multiply by reciprocal of row sum; optional mask add.
    scalarOp:scores*(mask.kind==='additive'?4:3),exp:scores,reciprocal:rows,
    reductionAdd:rows*(s.keyTokens-1),reductionCompare:rows*(s.keyTokens-1),
  },scoreBytes+maskBytes+probabilityBytes,rates);
  const pv=stage('pv',{...zeroWork(),matmulFlop:2*scores*s.valueDimension},probabilityBytes+vBytes+outBytes,rates);
  const shared=[
    'Dense score matrix; no causal sparsity or skipped masked positions.',
    'Stable row softmax: max reduction, subtract, exp, sum reduction, reciprocal, multiply.',
    'Operation counts omit instruction lowering, shuffles, synchronization and launch overhead.',
    'CUDA arithmetic and reductions share summed demand; exp and reciprocal share summed SFU demand.',
    'Tensor/CUDA/SFU/global-memory demands may overlap in this ideal bound; dependencies can increase time.',
    'GEMM-equivalent throughput uses only QK and PV FLOPs; other work constrains the time bound.',
  ];
  const separate=path('separate',[qk,softmax,pv],[...shared,
    'Three serial phases; score and probability matrices each written and read once in global memory.',
    'Q, K, V and output use ideal single-transfer traffic; repeated tile loads are excluded.',
  ]);
  const fusedStage=stage('fused',sumWork([qk,softmax,pv]),qBytes+kBytes+vBytes+outBytes+maskBytes,rates);
  const fused=path('fused',[fusedStage],[...shared,
    'Ideal global-boundary residency: Q/K/V read and output written once; score/probability stay on chip.',
    'This is not a tile model: online-softmax rescaling, tile rereads and capacity constraints are excluded.',
  ]);
  return {separate,fused};
}
