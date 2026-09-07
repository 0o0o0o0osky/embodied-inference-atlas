import {expect,it} from 'vitest';
import {attentionExample} from './attentionComputation';
it('computes the marked illustrative row through scaled masked softmax and weighted values',()=>{
 const e=attentionExample;
 expect(e.scores).toEqual([2,1,0]);
 expect(e.scaled[0]).toBeCloseTo(Math.SQRT2);
 expect(e.weights.reduce((a,b)=>a+b,0)).toBeCloseTo(1);
 expect(e.weights[2]).toBe(0);
 expect(e.weights[0]).toBeCloseTo(.66976155);
 expect(e.output[0]).toBeCloseTo(2*e.weights[0]!);
 expect(e.output[1]).toBeCloseTo(4*e.weights[1]!);
});
