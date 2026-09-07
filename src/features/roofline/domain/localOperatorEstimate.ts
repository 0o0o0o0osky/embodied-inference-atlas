import type {OperatorDetail,MaterializedTensor} from '../../model-graph/domain/types';
import {patchProjectionShape} from '../../model-graph/visualizers/patchProjectionShape';
export const localOperatorKinds=['residual-add','elementwise-multiply','patch-embedding','euler-update'] as const;
export interface LocalOperatorWork {flop:number;bytes:number;resource:'scalar'|'fma'|'matrix';formula:string;boundary:string;}
const size=(tensor:MaterializedTensor|null|undefined)=>tensor && tensor.shape.every(n=>n!==null&&Number.isSafeInteger(n)&&n>0)?tensor.shape.reduce<number>((p,n)=>p*n!,1):null;
export function localOperatorWork(detail:OperatorDetail,inputBytes:number,outputBytes:number,weightBytes:number):LocalOperatorWork|null {
 if(![inputBytes,outputBytes,weightBytes].every(n=>Number.isFinite(n)&&n>0))return null;
 if(detail.definitionId==='patch-embedding') {
  const shape=patchProjectionShape(detail);if(!shape)return null;
  const input=size(detail.inputs[0]?.tensor),output=size(detail.outputs[0]?.tensor);if(input===null||output===null)return null;
  const k=shape.patch**2*shape.channels,n=shape.embedding,m=output/n;
  return {flop:2*m*k*n,bytes:input*inputBytes+k*n*weightBytes+output*outputBytes,resource:'matrix',formula:`[${m}, ${k}] × [${k}, ${n}]；2MNK`,boundary:'图像读取、共享投影权重读取、token 输出各一次；图块在原输入中读取。'};
 }
 if(!['residual-add','elementwise-multiply','euler-update'].includes(detail.definitionId)||detail.inputs.length!==2||detail.outputs.length!==1)return null;
 const output=detail.outputs[0]!.tensor,count=size(output);if(count===null||!output)return null;
 const counts=detail.inputs.map(port=>size(port.tensor));if(counts.some(n=>n===null))return null;
 for(const {tensor} of detail.inputs) {
  if(!tensor||tensor.shape.length>output.shape.length)return null;
  const offset=output.shape.length-tensor.shape.length;
  if(tensor.shape.some((n,i)=>n!==1&&n!==output.shape[i+offset]))return null;
 }
 const euler=detail.definitionId==='euler-update';
 if(euler&&(detail.formula.replace(/\s/g,'')!=='x_next=x+dt*v,dt=-1/N_DENOISE'
  ||detail.inputs.some(({tensor})=>tensor!.shape.length!==output.shape.length||tensor!.shape.some((n,i)=>n!==output.shape[i]))))return null;
 const seen=new Set<string>();
 const reads=detail.inputs.reduce((sum,port,i)=>{const id=port.tensor!.tensorId;if(seen.has(id))return sum;seen.add(id);return sum+counts[i]!;},0);
 return {flop:count*(euler?2:1),bytes:reads*inputBytes+count*outputBytes,resource:euler?'fma':'scalar',
  formula:euler?'x_next = fma(Δt, v, x)；每元素 1 FMA = 2 FLOP':detail.definitionId==='residual-add'?'Y = A + B；每输出元素 1 加':'Y = A × B；每输出元素 1 乘',
  boundary:euler?'x、v 读取与输出写入各一次；Δt = −1/N_DENOISE 为当前场景共享常量。':'输入读取与输出写入各一次；广播输入按其原始元素数读取。'};
}
