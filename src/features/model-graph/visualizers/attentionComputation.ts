/** Fixed teaching tiles, independent of model inputs and measured traces. */
export const attentionTileInput={
 q:[[1,0],[0,1]], k:[[0,0],[1,1],[4,3],[2,5]],v:[[1,0],[0,2],[3,1],[1,4]],
 mask:[[true,true,true,false],[false,true,true,true]],
};
/** Online softmax keeps an unnormalised numerator; both it and l rescale when m changes. */
export function attentionTileWalkthrough() {
 const {q,k,v,mask}=attentionTileInput;
 let m=[-Infinity,-Infinity],l=[0,0],acc=[[0,0],[0,0]];
 const blocks=[0,2].map(start=>{
  const before={m:[...m],l:[...l],acc:acc.map(row=>[...row])};
  const scores=q.map(query=>k.slice(start,start+2).map(key=>query.reduce((s,x,d)=>s+x*key[d]!,0)));
  const scaled=scores.map((row,i)=>row.map((s,j)=>mask[i]![start+j]?s/Math.sqrt(2):-Infinity));
  const nextM=scaled.map((row,i)=>Math.max(m[i]!,...row));
  const alpha=m.map((value,i)=>Math.exp(value-nextM[i]!));
  const p=scaled.map((row,i)=>row.map(s=>Math.exp(s-nextM[i]!)));
  const pv=p.map(row=>[0,1].map(d=>row.reduce((s,w,j)=>s+w*v[start+j]![d]!,0)));
  l=l.map((old,i)=>old*alpha[i]!+p[i]!.reduce((a,b)=>a+b,0));
  acc=acc.map((row,i)=>row.map((old,d)=>old*alpha[i]!+pv[i]![d]!));m=nextM;
  return {start,before,scores,scaled,alpha,p,pv,m:[...m],l:[...l],acc:acc.map(row=>[...row])};
 });
 return {blocks,output:acc.map((row,i)=>row.map(x=>x/l[i]!))};
}
