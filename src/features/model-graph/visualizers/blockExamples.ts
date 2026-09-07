/** Small teaching inputs. These values and tile widths never describe a measured Kernel. */
export const exampleVector=[-2,-1,0,1,2,3,4,5] as const;
export const exampleRight=[1,2,3,4,5,6,7,8] as const;
export const sigmoid=(x:number)=>1/(1+Math.exp(-x));
export const geluPolynomial=(x:number)=>Math.sqrt(2/Math.PI)*(x+0.044715*x*x*x);
export const geluTanh=(x:number)=>x*sigmoid(2*geluPolynomial(x));
export function normalizeExample(input:readonly number[],layer:boolean,epsilon=1e-5) {
 const mean=layer?input.reduce((s,x)=>s+x,0)/input.length:0;
 const centered=input.map(x=>x-mean);
 const squares=centered.map(x=>x*x);
 const variance=squares.reduce((s,x)=>s+x,0)/input.length;
 const scale=1/Math.sqrt(variance+epsilon);
 return {mean,centered,squares,variance,scale,output:centered.map(x=>x*scale)};
}
export function rotatePair(x:number,y:number,angle:number) {
 return [x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)] as const;
}
export const vectorShape=(shape:readonly (number|null)[]|undefined)=>shape?`[${shape.map(v=>v?.toLocaleString()??'?').join(' × ')}]`:'形状待补充';
