import {expect,it} from 'vitest';
import {attentionTileInput,attentionTileWalkthrough} from './attentionComputation';
it('rescales numerator and denominator for a larger second-block maximum, matching masked dense attention',()=>{
 const {blocks,output}=attentionTileWalkthrough(),{q,k,v,mask}=attentionTileInput;
 expect(blocks[1]!.alpha.every(a=>a>0&&a<1)).toBe(true);
 expect(blocks[1]!.p[0]![1]).toBe(0);
 q.forEach((query,i)=>{
  const scores=k.map((key,j)=>mask[i]![j]?query.reduce((s,x,d)=>s+x*key[d]!,0)/Math.sqrt(2):-Infinity);
  const max=Math.max(...scores),weights=scores.map(s=>Math.exp(s-max)),sum=weights.reduce((a,b)=>a+b,0);
  for(let d=0;d<2;d++)expect(output[i]![d]).toBeCloseTo(weights.reduce((s,w,j)=>s+w*v[j]![d]!,0)/sum,12);
  expect(blocks[1]!.l[i]).toBeCloseTo(blocks[0]!.l[i]!*blocks[1]!.alpha[i]!+blocks[1]!.p[i]!.reduce((a,b)=>a+b,0),12);
 });
});
