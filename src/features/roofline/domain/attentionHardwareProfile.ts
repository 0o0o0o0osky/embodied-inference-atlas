import type {AttentionRates} from './attentionEstimate';
import type {RooflineCeilingRecord} from './types';

export interface AttentionHardwareProfile {
  /** Ordinary FP32 operations/results per second; Tensor and bandwidth stay caller supplied. */
  rates: Pick<AttentionRates,'scalarOp'|'exp'|'reciprocal'|'reductionAdd'|'reductionCompare'>;
  conditional: boolean;
  notes: readonly string[];
  sources: readonly {label:string;url:string}[];
}
const sources:AttentionHardwareProfile['sources']=[
  {label:'NVIDIA Jetson Thor 数据表 v1.5，p.2',url:'https://developer.nvidia.com/downloads/assets/embedded/secure/jetson/thor/docs/jetson-thor-series-modules-datasheet_ds-11945-001.pdf#page=9'},
  {label:'CUDA 13.3 Best Practices，原生算术吞吐表 5',url:'https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html#throughput-of-native-arithmetic-instructions'},
];

/** A local conditional reference, never an amendment to canonical device ceilings. */
export function resolveAttentionHardwareProfile(ceiling:RooflineCeilingRecord|null):AttentionHardwareProfile {
  const empty:AttentionHardwareProfile={rates:{scalarOp:null,exp:null,reciprocal:null,reductionAdd:null,reductionCompare:null},
    conditional:false,notes:['此设备或运行频率尚无 Attention 普通算术与特殊函数速率配置。'],sources:[]};
  if(!ceiling || ceiling.device_id!=='nvidia-jetson-agx-thor')return empty;
  const op=ceiling.operating_point;
  if(op.clock_basis==='unknown')return empty;
  // Only the two documented T5000 operating points: no fallback from a mode label
  // to a different clock, and no T5000 assumptions for the smaller T4000.
  const fp32=op.power_mode==='120W' && op.gpu_clock_hz===1.386e9 ? 7.096e12
    : op.power_mode==='maximum_specification' && op.gpu_clock_hz===1.575e9 ? 8.064e12 : null;
  if(fp32===null)return empty;
  const clock=op.gpu_clock_hz!;
  return {rates:{scalarOp:fp32/2,reductionAdd:fp32/2,exp:20*16*clock,reciprocal:20*16*clock,reductionCompare:20*128*clock},
    conditional:true,sources,notes:[
      '普通 FP32 加/乘及归约加法按数据表 FMA FLOP/s ÷ 2 换算为操作/s；使用所选频率的理论上限。',
      'CUDA 表未列 CC 11.0：SFU 按 20 SM × 每周期 16 个结果、FP32 min/max 按 20 SM × 每周期 128 个结果作参考假设。',
      '指数采用近似 exp2：log2(e) 合入前置缩放系数，沿用一次缩放乘法；倒数采用近似 reciprocal，与 exp2 共享 SFU。',
      '归约比较采用 FP32 max 参考速率；跨线程传递与同步另属实现成本。此配置描述理想操作路径，不替代实际指令或频率测量。',
    ]};
}

export interface NormalizationHardwareProfile {
  rates:{scalarOp:number|null;reductionAdd:number|null;rsqrt:number|null};
  conditional:boolean;
  notes:readonly string[];
  sources:AttentionHardwareProfile['sources'];
}
/** Same scoped T5000 reference; no fallback to BF16 Tensor throughput. */
export function resolveNormalizationHardwareProfile(ceiling:RooflineCeilingRecord|null):NormalizationHardwareProfile {
  const profile=resolveAttentionHardwareProfile(ceiling);
  return {rates:{scalarOp:profile.rates.scalarOp,reductionAdd:profile.rates.reductionAdd,rsqrt:profile.rates.reciprocal},
    conditional:profile.conditional,sources:profile.sources,
    notes:profile.rates.scalarOp===null?['此设备或运行频率尚无归一化算术与 rsqrt 速率配置。']:[
      '普通 FP32 算术按公开 FMA FLOP/s ÷ 2；归约加法共享 CUDA 资源。',
      'CC 11.0 的 rsqrt 吞吐未单列：按 20 SM × 每周期 16 个近似结果作参考假设。',
    ]};
}

/** Explicit shared SFU reference for the declared elementwise/normalization recipes. */
export function resolveRemainingHardwareProfile(ceiling:RooflineCeilingRecord|null): {
  rates:Record<'scalarOp'|'reductionAdd'|'exp'|'reciprocal'|'rsqrt'|'sin'|'cos',number|null>;
  notes:readonly string[];sources:AttentionHardwareProfile['sources'];conditional:boolean;
} {
  const profile=resolveAttentionHardwareProfile(ceiling);
  // Reuse its exact device/operating-point eligibility, then independently state
  // the common approximate-instruction assumption for every SFU operation.
  const sfu=profile.rates.scalarOp===null?null:20*16*ceiling!.operating_point.gpu_clock_hz!;
  return {rates:{scalarOp:profile.rates.scalarOp,reductionAdd:profile.rates.reductionAdd,
    exp:sfu,reciprocal:sfu,rsqrt:sfu,sin:sfu,cos:sfu},sources:profile.sources,conditional:profile.conditional,
    notes:sfu===null?['此设备或频率尚无普通算术及特殊函数参考速率，保留已知工作量和读写量。']:[
      '普通 FP32 加/乘与归约按公开 FMA FLOP/s ÷ 2，合并计算同一 CUDA 资源需求。',
      'CUDA 吞吐表未列 CC 11.0；exp2、reciprocal、rsqrt、sin、cos 统一按 20 SM × 每周期 16 个近似结果作参考假设，并共享 SFU。',
    ]};
}
