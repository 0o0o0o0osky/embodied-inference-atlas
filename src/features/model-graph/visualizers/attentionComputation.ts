/** Fixed teaching example, independent of model inputs and measured traces. */
const query=[1,1] as const;
const keys=[[2,0],[0,1],[-1,1]] as const;
const values=[[2,0],[0,4],[8,8]] as const;
const scores=keys.map(key=>key.reduce<number>((sum,value,index)=>sum+value*query[index]!,0));
const scaled=scores.map(value=>value/Math.sqrt(query.length));
const mask=[true,true,false] as const;
const maximum=Math.max(...scaled.filter((_,index)=>mask[index]));
const exponentials=scaled.map((value,index)=>mask[index]?Math.exp(value-maximum):0);
const sum=exponentials.reduce((total,value)=>total+value,0);
const weights=exponentials.map(value=>value/sum);
const contributions=values.map((value,index)=>value.map(element=>element*weights[index]!));
const output=query.map((_,axis)=>contributions.reduce((total,row)=>total+row[axis]!,0));
export const attentionExample={query,keys,values,scores,scaled,mask,maximum,exponentials,weights,contributions,output} as const;
