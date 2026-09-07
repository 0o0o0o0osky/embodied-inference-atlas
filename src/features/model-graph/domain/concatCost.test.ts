import {expect,it} from 'vitest';
import type {OperatorDetail} from './types';
import {concatCostFromDetail,buildConcatCost} from './concatCost';
const detail=(definitionId:string,inputs:(number|null)[][],outputs:(number|null)[][])=>({definitionId,inputs:inputs.map(shape=>({tensor:{shape}})),outputs:outputs.map(shape=>({tensor:{shape}})),effectiveRepeat:10}) as unknown as OperatorDetail;
it('counts one invocation using selected precision, preserving unknown shapes',()=>{
 expect(concatCostFromDetail(detail('concat',[[2,4],[3,4]],[[5,4]]),16)).toEqual({operation:'concat',inputBytes:40,outputBytes:40});
 expect(concatCostFromDetail(detail('reshape',[[5,4]],[[4,4]]),32)).toEqual({operation:'reshape',inputBytes:80,outputBytes:64});
 expect(concatCostFromDetail(detail('slice',[[5,4]],[[4,4]]),32)).toEqual({operation:'slice',inputBytes:80,outputBytes:64});
 expect(concatCostFromDetail(detail('concat',[[null,4],[3,4]],[[null,4]]),16)?.inputBytes).toBeNull();
 expect(concatCostFromDetail(detail('linear',[[2,4]],[[2,4]]),16)).toBeNull();
});
it('distinguishes conditional zero-copy from materialization and selected-row reads',()=>{
 expect(buildConcatCost('concat',40,40,1000)).toEqual({readBytes:40,writeBytes:40,materializedBytes:80,lowerBoundSeconds:.08});
 expect(buildConcatCost('reshape',80,64,1000)).toEqual({readBytes:64,writeBytes:64,materializedBytes:128,lowerBoundSeconds:.128});
 expect(buildConcatCost('concat',null,40,1000).lowerBoundSeconds).toBeNull();
 expect(buildConcatCost('concat',40,40,null).lowerBoundSeconds).toBeNull();
});
it('distinguishes declared padding from broadcast and reads only existing elements',()=>{
 const pad={...detail('reshape',[[1,6]],[[1,1,32]]),operatorId:'pad-state',label:'Zero-pad state'};
 expect(concatCostFromDetail(pad,16)).toEqual({operation:'zero-pad',inputBytes:12,outputBytes:64});
 expect(buildConcatCost('zero-pad',12,64,1000).materializedBytes).toBe(76);
 const broadcast={...detail('reshape',[[1,720]],[[1,50,720]]),operatorId:'broadcast-time'};
 expect(concatCostFromDetail(broadcast,16)?.operation).toBe('broadcast');
 expect(buildConcatCost('broadcast',1440,72000,1000).readBytes).toBe(1440);
 expect(concatCostFromDetail(detail('reshape',[[1,6]],[[1,32]]),16)?.operation).toBe('expanded-layout');
});
