import type {OperatorDetail,MaterializedPort} from './types';
export type ConcatCostOperation='concat'|'reshape'|'permute-rearrange'|'zero-pad'|'broadcast'|'expanded-layout';
const known=(value:number|null):value is number=>value!==null && Number.isFinite(value) && value>=0;
/** Element-storage boundary for one invocation; no repeat multiplier or measured traffic. */
export function concatCostFromDetail(detail:OperatorDetail,bitsPerElement:number) {
 if (detail.definitionId!=='concat' && detail.definitionId!=='reshape' && detail.definitionId!=='slice' && detail.definitionId!=='permute-rearrange') return null;
 const bytes=(ports:readonly MaterializedPort[]):number|null=>{
  if (!ports.length || !Number.isFinite(bitsPerElement) || bitsPerElement<=0) return null;
  let total=0;
  for (const port of ports) {
   if (!port.tensor || port.tensor.shape.some(size=>!known(size) || !Number.isInteger(size))) return null;
   const elements=port.tensor.shape.reduce<number>((product,size)=>product*size!,1);
   total+=Math.ceil(elements*bitsPerElement/8);
  }
  return Number.isSafeInteger(total)?total:null;
 };
 const inputBytes=bytes(detail.inputs),outputBytes=bytes(detail.outputs);
 let operation=(detail.definitionId==='slice'?'reshape':detail.definitionId) as ConcatCostOperation;
 if(operation==='reshape'&&inputBytes!==null&&outputBytes!==null&&outputBytes>inputBytes) {
  // These are declared graph operations, not padding inferred from size alone.
  operation=detail.operatorId==='pad-state'&&detail.label==='Zero-pad state'?'zero-pad':detail.operatorId==='broadcast-time'?'broadcast':'expanded-layout';
 }
 return {operation,inputBytes,outputBytes};
}
export function buildConcatCost(operation:ConcatCostOperation,inputBytes:number|null,outputBytes:number|null,bandwidthBytesPerSecond:number|null) {
 // Selected rows read their subset; padding/broadcast read the original values.
 // Filled constants do not add global reads; repeated input reads assume ideal reuse.
 const readBytes=operation==='concat'?inputBytes:known(inputBytes)&&known(outputBytes)?Math.min(inputBytes,outputBytes):null;
 const writeBytes=outputBytes;
 const materializedBytes=known(readBytes) && known(writeBytes)?readBytes+writeBytes:null;
 const lowerBoundSeconds=materializedBytes!==null && bandwidthBytesPerSecond!==null && Number.isFinite(bandwidthBytesPerSecond) && bandwidthBytesPerSecond>0 ? materializedBytes/bandwidthBytesPerSecond:null;
 return {readBytes:known(readBytes)?readBytes:null,writeBytes:known(writeBytes)?writeBytes:null,materializedBytes,lowerBoundSeconds};
}
