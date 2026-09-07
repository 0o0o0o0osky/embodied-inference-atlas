/** Small mathematical tiles; independent of hardware launch configuration. */
export const gemmX=[[1,2,0,1],[0,1,2,1],[2,0,1,3],[1,1,1,0]];
export const gemmW=[[1,0,2,1],[0,2,1,0],[2,1,0,1],[1,0,1,2]];
export function gemmTile(row:number,column:number) {
 let accumulator=Array(4).fill(0) as number[];
 return [0,2].map(k=>{
  const a=gemmX.slice(row,row+2).flatMap(values=>values.slice(k,k+2));
  const b=gemmW.slice(k,k+2).flatMap(values=>values.slice(column,column+2));
  const product=Array.from({length:4},(_,i)=>a[Math.floor(i/2)*2]!*b[i%2]!+a[Math.floor(i/2)*2+1]!*b[2+i%2]!);
  const before=[...accumulator];accumulator=accumulator.map((v,i)=>v+product[i]!);
  return {k,a,b,product,before,accumulator:[...accumulator]};
 });
}
