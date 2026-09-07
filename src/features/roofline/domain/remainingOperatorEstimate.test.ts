import {expect,it} from 'vitest';
import type {OperatorDetail} from '../../model-graph/domain/types';
import {remainingOperatorWork,estimateRemainingResources} from './remainingOperatorEstimate';
const detail=(definitionId:string,input:number[],output=input)=>({definitionId,inputs:[{port:'input',tensor:{shape:input}}],outputs:[{port:'output',tensor:{shape:output}}]} as unknown as OperatorDetail);
it('counts declared activation and centered LayerNorm recipes without treating SFU results as FLOPs',()=>{
 const gelu=remainingOperatorWork(detail('gelu',[2,4]),2,2,2)!;
 expect(gelu.scalarOp).toBe(56);expect(gelu.exp).toBe(8);expect(gelu.reciprocal).toBe(8);expect(gelu.bytes).toBe(32);
 const ln=remainingOperatorWork(detail('layer-norm',[2,4]),2,2,2)!;
 expect(ln.scalarOp).toBe(30);expect(ln.reductionAdd).toBe(12);expect(ln.rsqrt).toBe(2);
 const estimate=estimateRemainingResources(gelu,{scalarOp:100,reductionAdd:100,exp:10,reciprocal:10,rsqrt:10,sin:10,cos:10,globalByte:100});
 expect(estimate.sfu).toBe(1.6);expect(estimate.flop).toBe(56);expect(estimate.seconds).toBe(1.6);
 expect(estimateRemainingResources(gelu,{scalarOp:100,reductionAdd:null,exp:null,reciprocal:10,rsqrt:null,sin:null,cos:null,globalByte:100}).seconds).toBeNull();
});
it('accounts for precomputed trig tables, phase generation and indexed lookup separately',()=>{
 const rope=remainingOperatorWork(detail('rope',[2,4]),2,2,2)!;
 expect(rope.scalarOp).toBe(24);expect(rope.sin).toBe(0);expect(rope.bytes).toBe(64);
 const time=remainingOperatorWork(detail('sinusoidal-time-embedding',[2],[2,4]),2,2,2)!;
 expect(time.scalarOp).toBe(4);expect(time.sin).toBe(4);expect(time.cos).toBe(4);expect(time.bytes).toBe(32);
 const broadcast=remainingOperatorWork(detail('sinusoidal-time-embedding',[1],[1,50,4]),2,2,2)!;
 expect(broadcast.sin).toBe(2);expect(broadcast.bytes).toBe(412);
 const lookup=remainingOperatorWork(detail('token-embedding',[3],[3,4]),2,2,2)!;
 expect(lookup.scalarOp).toBe(0);expect(lookup.bytes).toBe(72);
 expect(remainingOperatorWork(detail('rope',[2,3]),2,2,2)).toBeNull();
});
