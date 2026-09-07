import type {OperatorDetail} from '../../model-graph/domain/types';
export const remainingOperatorKinds=['layer-norm','gelu','silu','rope','sinusoidal-time-embedding','token-embedding','scalar-scale'] as const;
export type ArithmeticKind='scalarOp'|'reductionAdd'|'exp'|'reciprocal'|'rsqrt'|'sin'|'cos';
export interface RemainingOperatorWork extends Record<ArithmeticKind,number> {bytes:number;label:string;formula:string;notes:string[];source:{label:string;url:string};}
export type RemainingRates=Record<ArithmeticKind|'globalByte',number|null>;
const size=(shape:readonly (number|null)[]|undefined)=>shape&&shape.every(n=>n!==null&&Number.isSafeInteger(n)&&n>0)?shape.reduce<number>((p,n)=>p*n!,1):null;
const torch=(name:string)=>({label:`PyTorch ${name}`,url:`https://docs.pytorch.org/docs/main/generated/torch.nn.${name}.html`});
/** One logical invocation, plain tensor storage and explicitly chosen FP32 algorithms. */
export function remainingOperatorWork(d:OperatorDetail,ib:number,ob:number,wb:number):RemainingOperatorWork|null {
 if(!remainingOperatorKinds.some(k=>k===d.definitionId)||![ib,ob,wb].every(n=>Number.isFinite(n)&&n>0)||d.inputs.length!==1||d.outputs.length!==1)return null;
 const input=d.inputs[0]?.tensor?.shape,output=d.outputs[0]?.tensor?.shape,E=size(output),I=size(input);
 if(E===null||I===null||!input||!output||!output.length)return null;
 const D=output.at(-1)!,R=E/D;
 const w:RemainingOperatorWork={scalarOp:0,reductionAdd:0,exp:0,reciprocal:0,rsqrt:0,sin:0,cos:0,bytes:I*ib+E*ob,label:d.definitionId,formula:'',notes:[],source:torch('GELU')};
 if(d.definitionId==='token-embedding') {
  if(E!==I*D)return null;
  return {...w,bytes:I*8+E*wb+E*ob,label:'Token 查表',formula:'Y[i, :] = W[token_id[i], :]',source:torch('Embedding'),notes:['声明 int64 token ID；仅计选中行的权重读取与输出写入。','每个 token 读取一次对应行，未假设重复 ID 命中缓存；索引与寻址开销未计入带宽参考。']};
 }
 if(d.definitionId==='sinusoidal-time-embedding') {
  if(D%2||R%I!==0)return null;
  return {...w,scalarOp:I*D/2,sin:I*D/2,cos:I*D/2,bytes:I*4+D/2*4+E*ob,label:'时间正弦嵌入',formula:'φᵢ = t × ωᵢ；Y = concat(sin φ, cos φ)',source:{label:'Transformer 正弦位置编码',url:'https://arxiv.org/abs/1706.03762'},notes:['声明已提供 D/2 个 FP32 频率（含周期系数）；每个时间值生成一份向量后广播写出，时间值和共享频率各读取一次。','sin/cos 按近似指令参考；大角度范围归约与精度修正另需计算，频率生成不在此调用内。']};
 }
 if(input.length!==output.length||input.some((n,i)=>n!==output[i]))return null;
 switch(d.definitionId) {
 case 'layer-norm':return {...w,scalarOp:3*E+3*R,reductionAdd:2*R*(D-1),rsqrt:R,label:'基础 LayerNorm',formula:'μ = mean(X)；v = mean((X−μ)²)；Y = (X−μ) × rsqrt(v+ε)',source:torch('LayerNorm'),notes:['按最后一维归一化，使用除以 D 的中心方差；本配方不含 γ/β 仿射。','输入读一次、输出写一次；中心化值与行统计量理想驻留，线程通信与同步另属实现成本。']};
 case 'gelu':return {...w,scalarOp:7*E,exp:E,reciprocal:E,label:'GELU · tanh 近似',formula:'z = √(2/π)(x + 0.044715x³)；y = x / (1 + exp(−2z))',source:torch('GELU'),notes:['等价于 0.5x(1+tanh z) 的明确近似配方；不是精确 erf 版本。','常数 −2√(2/π)log₂e 合并；每元素 7 个普通操作、1 exp2、1 reciprocal。']};
 case 'silu':return {...w,scalarOp:3*E,exp:E,reciprocal:E,label:'SiLU',formula:'y = x × reciprocal(1 + exp2(−x log₂e))',source:torch('SiLU'),notes:['每元素缩放、加 1、乘倒数共 3 个普通操作；exp2 与 reciprocal 另计。']};
 case 'rope':
  if(D%2)return null;
  return {...w,scalarOp:3*E,bytes:w.bytes+E*4,label:'RoPE · 完整旋转维度',formula:'(a,b) → (a cosφ − b sinφ, a sinφ + b cosφ)',source:{label:'RoFormer 旋转位置编码',url:'https://arxiv.org/abs/2104.09864'},notes:['声明最后一维全部按对旋转，每对 4 乘 2 加；相邻或半维配对采用相同工作量。','已提供 FP32 sin/cos 表，每个旋转对各读一项；未假设跨 head 读表命中，角度生成不在此调用内。']};
 case 'scalar-scale':return {...w,scalarOp:E,label:'标量缩放',formula:'Y = αX；α = √D_MODEL',source:{label:'Transformer 嵌入缩放',url:'https://arxiv.org/abs/1706.03762'},notes:['声明 α 为预先算好的共享常量，每个输出元素一次乘法。']};
 default:return null;
 }
}
export function estimateRemainingResources(w:RemainingOperatorWork,r:RemainingRates) {
 const t=(k:ArithmeticKind)=>w[k]===0?0:r[k]!==null&&r[k]!>0?w[k]/r[k]!:null;
 const sum=(values:(number|null)[])=>values.some(v=>v===null)?null:values.reduce<number>((s,v)=>s+v!,0);
 const cuda=sum([t('scalarOp'),t('reductionAdd')]);
 const sfu=sum([t('exp'),t('reciprocal'),t('rsqrt'),t('sin'),t('cos')]);
 const memory=r.globalByte!==null&&r.globalByte>0?w.bytes/r.globalByte:null;
 return {flop:w.scalarOp+w.reductionAdd,cuda,sfu,memory,seconds:cuda!==null&&sfu!==null&&memory!==null?Math.max(cuda,sfu,memory):null};
}
