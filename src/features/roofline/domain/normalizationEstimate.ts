/** Ordinary FP32 arithmetic and approximate rsqrt, independent of Tensor ceilings. */
export interface NormalizationRates {
  scalarOp:number|null;
  reductionAdd:number|null;
  rsqrt:number|null;
  globalByte:number|null;
}
export interface RmsNormInput {
  rows:number;
  width:number;
  /** Weight is a shared width-vector; null explicitly means no affine scale. */
  bytes:{input:number;output:number;weight:number|null};
  rates:NormalizationRates;
}
export interface NormalizationEstimate {
  /** FLOPs include ordinary arithmetic/reduction, with rsqrt reported separately. */
  work:{flop:number;scalarOp:number;reductionAdd:number;rsqrt:number};
  globalBytes:number;
  resourceSeconds:{cuda:number|null;sfu:number|null;memory:number|null};
  knownResourceSeconds:{cuda:number;sfu:number;memory:number};
  lowerBoundSeconds:number;
  complete:boolean;
  missingRates:(keyof NormalizationRates)[];
  arithmeticIntensity:number;
  referencePoint:{flop:number;arithmeticIntensity:number;flopPerSecond:number|null};
  assumptions:readonly string[];
}
function positive(value:number,name:string,integer=false) {
  if(!Number.isFinite(value)||value<=0||integer&&!Number.isSafeInteger(value))throw new Error(`${name} must be positive${integer?' safe integer':''}`);
}
/** Formula: https://docs.pytorch.org/docs/main/generated/torch.nn.RMSNorm.html
 * Ideal single-call RMS: y=x*rsqrt(mean(x*x)+epsilon), optionally y*=gamma. */
export function estimateRmsNorm({rows,width,bytes,rates}:RmsNormInput):NormalizationEstimate {
  positive(rows,'rows',true);positive(width,'width',true);
  positive(bytes.input,'input bytes');positive(bytes.output,'output bytes');
  if(bytes.weight!==null)positive(bytes.weight,'weight bytes');
  for(const [key,value] of Object.entries(rates))if(value!==null)positive(value,key);
  const elements=rows*width;
  // Square + normalize, two scalar ops per row (multiply by reciprocal width,
  // add epsilon), and optional per-element affine multiplication.
  const scalarOp=2*elements+2*rows+(bytes.weight===null?0:elements);
  const reductionAdd=rows*(width-1);
  const work={flop:scalarOp+reductionAdd,scalarOp,reductionAdd,rsqrt:rows};
  const globalBytes=elements*(bytes.input+bytes.output)+(bytes.weight===null?0:width*bytes.weight);
  const counts={scalarOp,reductionAdd,rsqrt:rows,globalByte:globalBytes};
  const keys=Object.keys(counts) as (keyof NormalizationRates)[];
  const missingRates=keys.filter(key=>counts[key]>0&&rates[key]===null);
  const time=(key:keyof NormalizationRates)=>counts[key]===0?0:rates[key]===null?null:counts[key]/rates[key]!;
  const scalar=time('scalarOp'),reduction=time('reductionAdd'),sfu=time('rsqrt'),memory=time('globalByte');
  const cuda=scalar===null||reduction===null?null:scalar+reduction;
  const knownResourceSeconds={cuda:(scalar??0)+(reduction??0),sfu:sfu??0,memory:memory??0};
  const lowerBoundSeconds=Math.max(...Object.values(knownResourceSeconds));
  const arithmeticIntensity=work.flop/globalBytes;
  return {work,globalBytes,resourceSeconds:{cuda,sfu,memory},knownResourceSeconds,lowerBoundSeconds,
    complete:missingRates.length===0,missingRates,arithmeticIntensity,
    referencePoint:{flop:work.flop,arithmeticIntensity,flopPerSecond:missingRates.length===0&&lowerBoundSeconds>0?work.flop/lowerBoundSeconds:null},
    assumptions:[
      '单次调用：平方、行归约、均值与 ε、rsqrt、逐元素归一化。',
      bytes.weight===null?'仅基础 RMS 归一化，不含可学习缩放或条件化仿射。':'另含共享 γ 向量的一次边界读取与逐元素相乘。',
      '输入读取、输出写出各一次；行内中间量理想驻留，未加入线程通信、同步或额外重读。',
      '普通算术与归约加法共享 CUDA 资源；rsqrt 单列 SFU，FLOP 计数不含 rsqrt。',
    ]};
}
