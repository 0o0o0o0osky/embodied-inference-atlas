import type {OperatorDetail} from '../../model-graph/domain/types';
import {estimateRmsNorm,type NormalizationRates,type NormalizationEstimate} from './normalizationEstimate';

/** The graph's plain Y=X/RMS(X) node only; affine/conditional siblings stay separate. */
export function rmsNormFromOperator(
  detail:OperatorDetail,
  bytes:{input:number;output:number},
  rates:NormalizationRates,
):NormalizationEstimate|null {
  if(detail.definitionId!=='rms-norm')return null;
  const input=detail.inputs.find(port=>port.port==='input')?.tensor;
  const output=detail.outputs.find(port=>port.port==='output')?.tensor;
  if(!input||!output||input.shape.length===0||input.shape.length!==output.shape.length)return null;
  if(input.shape.some((value,index)=>value===null||!Number.isSafeInteger(value)||value<=0||value!==output.shape[index]))return null;
  const shape=input.shape as readonly number[];
  const width=shape[shape.length-1]!;
  const rows=shape.slice(0,-1).reduce((product,value)=>product*value,1);
  return estimateRmsNorm({rows,width,bytes:{...bytes,weight:null},rates});
}
