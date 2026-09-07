export type LayoutExampleKind='concat'|'reshape'|'slice'|'permute-rearrange';
export interface SliceExampleRange { axis: 'row'|'column'; start: number; stop: number; size: number }
export function layoutExample(kind:LayoutExampleKind, slice?:SliceExampleRange) {
 const count=kind==='concat'||kind==='slice'?9:6;
 const source=Array.from({length:count},(_,i)=>i+1);
 const columnSlice=kind==='slice'&&slice?.axis==='column';
 const start=columnSlice?Math.min(2,Math.floor(slice.start/slice.size*3)):1;
 const stop=columnSlice?Math.min(3,Math.max(start+1,Math.ceil(slice.stop/slice.size*3))):2;
 const indices=kind==='slice'?(columnSlice?source.map((_,i)=>i).filter(i=>i%3>=start&&i%3<stop):[3,4,5]):kind==='permute-rearrange'?[0,3,1,4,2,5]:source.map((_,i)=>i);
 return {source,indices,output:indices.map(i=>source[i]!),inputRows:count/3,inputColumns:3,columnSlice,sliceStart:start,sliceStop:stop,outputRows:kind==='slice'&&!columnSlice?1:3,outputColumns:columnSlice?stop-start:kind==='reshape'||kind==='permute-rearrange'?2:3};
}
export const lookupIds=[2,0];
export const lookupTable=Array.from({length:6},(_,row)=>Array.from({length:4},(_,column)=>row*10+column));
export function lookupDimensionTile(token:number,block:number) {return lookupTable[lookupIds[token]!]!.slice(block*2,block*2+2);}

export function expansionLayoutExample(kind:'zero-pad'|'broadcast') {
 const source=[3,7];
 const indices=kind==='zero-pad'?[0,1,null,null]:[0,1,0,1,0,1];
 return {source,indices,output:indices.map(i=>i===null?0:source[i]!),rows:kind==='zero-pad'?1:3,columns:kind==='zero-pad'?4:2};
}
