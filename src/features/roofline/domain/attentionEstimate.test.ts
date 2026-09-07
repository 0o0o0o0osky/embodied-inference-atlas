import {expect,it} from 'vitest';
import {estimateAttention,type AttentionEstimateInput} from './attentionEstimate';
const input:AttentionEstimateInput={shape:{batch:1,queryHeads:2,kvHeads:1,queryTokens:3,keyTokens:4,qkDimension:5,valueDimension:6},
 bytes:{query:2,key:2,value:2,score:4,probability:4,output:2},mask:{kind:'none'},
 rates:{matmulFlop:1000,scalarOp:1000,exp:100,reciprocal:100,reductionAdd:100,reductionCompare:100,globalByte:1000}};
it('counts dense attention and uses serial phase maxima versus fused boundary traffic',()=>{
 const {separate,fused}=estimateAttention(input);
 expect(separate.work).toEqual({matmulFlop:528,scalarOp:72,exp:24,reciprocal:6,reductionAdd:18,reductionCompare:18});
 expect(separate.globalBytes).toBe(604);expect(fused.globalBytes).toBe(220);
 separate.stages.forEach((stage,index)=>expect(stage.lowerBoundSeconds).toBeCloseTo([.24,.432,.288][index]!));
 expect(fused.stages[0]!.resourceDemands.cuda.seconds).toBeCloseTo(.432);
 expect(fused.stages[0]!.resourceDemands.sfu.seconds).toBeCloseTo(.3);
 expect(separate.lowerBoundSeconds).toBeCloseTo(.96);
 expect(fused.lowerBoundSeconds).toBe(.528);
 expect(fused.work).toEqual(separate.work);
 expect(fused.referencePoint.matmulFlopPerSecond).toBe(1000);
});
it('preserves unknown special-function rates as partial bounds and separates additive-mask traffic',()=>{
 const {separate,fused}=estimateAttention({...input,mask:{kind:'additive',bytesPerElement:4},rates:{...input.rates,exp:null,reciprocal:null}});
 expect(fused.complete).toBe(false);expect(fused.missingRates).toEqual(['exp','reciprocal']);
 expect(fused.stages[0]!.resourceSeconds.exp).toBeNull();
 expect(fused.stages[0]!.resourceDemands.sfu.seconds).toBeNull();
 const partial=estimateAttention({...input,rates:{...input.rates,reciprocal:null}}).fused;
 expect(partial.stages[0]!.resourceDemands.sfu).toEqual({seconds:null,knownSeconds:.24});
 expect(fused.work.scalarOp).toBe(96);expect(fused.globalBytes).toBe(316);
 expect(separate.globalBytes-fused.globalBytes).toBe(384);
 const allMissing=estimateAttention({...input,rates:{matmulFlop:null,scalarOp:null,exp:null,reciprocal:null,reductionAdd:null,reductionCompare:null,globalByte:null}});
 expect(allMissing.fused.referencePoint.matmulFlopPerSecond).toBeNull();
});
it('does not charge missing reduction rates for a singleton row and respects supplied dtype widths',()=>{
 const singleton=estimateAttention({...input,shape:{...input.shape,keyTokens:1},rates:{...input.rates,reductionAdd:null,reductionCompare:null}});
 expect(singleton.fused.complete).toBe(true);
 const wide=estimateAttention({...input,bytes:{query:4,key:4,value:4,score:8,probability:8,output:4}});
 expect(wide.fused.globalBytes).toBe(440);expect(wide.separate.globalBytes).toBe(1208);
 expect(wide.fused.work).toEqual(estimateAttention(input).fused.work);
});
