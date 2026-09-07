import {expect,it} from 'vitest';
import {geluTanh,normalizeExample,rotatePair,sigmoid} from './blockExamples';
it('normalizes across the entire row and uses both tiles in shared statistics',()=>{
 const x=[1,2,3,4,5,6,7,8];
 const layer=normalizeExample(x,true,0),rms=normalizeExample(x,false,0);
 expect(layer.mean).toBe(4.5);expect(layer.variance).toBe(5.25);
 expect(layer.output.reduce((s,y)=>s+y,0)).toBeCloseTo(0);
 expect(layer.output.reduce((s,y)=>s+y*y,0)/8).toBeCloseTo(1);
 expect(rms.variance).toBe(25.5);
});
it('uses the stated tanh GELU identity and preserves each rotated pair norm',()=>{
 for(const x of [-2,0,2])expect(geluTanh(x)).toBeCloseTo(.5*x*(1+Math.tanh(Math.sqrt(2/Math.PI)*(x+.044715*x**3))),12);
 expect(sigmoid(0)).toBe(.5);
 const rotated=rotatePair(1,2,Math.PI/4);
 expect(rotated[0]**2+rotated[1]**2).toBeCloseTo(5);
});
