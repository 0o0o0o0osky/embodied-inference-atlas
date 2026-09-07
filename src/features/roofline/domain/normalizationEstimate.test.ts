import {expect,it} from 'vitest';
import {estimateRmsNorm} from './normalizationEstimate';
import {rmsNormFromOperator} from './rmsNormFromOperator';
import type {OperatorDetail} from '../../model-graph/domain/types';
const rates={scalarOp:100,reductionAdd:50,rsqrt:10,globalByte:100};
it('counts RMS square/reduce/mean/epsilon/rsqrt/normalize with shared CUDA demand',()=>{
 const value=estimateRmsNorm({rows:2,width:4,bytes:{input:2,output:2,weight:null},rates});
 expect(value.work).toEqual({flop:26,scalarOp:20,reductionAdd:6,rsqrt:2});
 expect(value.globalBytes).toBe(32);expect(value.resourceSeconds.cuda).toBeCloseTo(.32);
 expect(value.resourceSeconds.sfu).toBe(.2);expect(value.lowerBoundSeconds).toBeCloseTo(.32);
 expect(value.arithmeticIntensity).toBe(26/32);expect(value.complete).toBe(true);
 const affine=estimateRmsNorm({rows:2,width:4,bytes:{input:2,output:2,weight:4},rates});
 expect(affine.work.flop).toBe(34);expect(affine.globalBytes).toBe(48);
});
it('preserves absent SFU evidence and excludes zero-work reduction from missing rates',()=>{
 const value=estimateRmsNorm({rows:2,width:4,bytes:{input:2,output:4,weight:null},rates:{...rates,rsqrt:null}});
 expect(value.complete).toBe(false);expect(value.resourceSeconds.sfu).toBeNull();
 expect(value.missingRates).toEqual(['rsqrt']);expect(value.lowerBoundSeconds).toBe(.48);
 expect(estimateRmsNorm({rows:1,width:1,bytes:{input:2,output:2,weight:null},rates:{...rates,reductionAdd:null}}).complete).toBe(true);
});
it('adapts only a resolved plain RMS node and never inherits layer/denoise repetition',()=>{
 const tensor={tensorId:'x',label:'x',semanticRole:'activation',axes:[],shape:[2,3,4],unresolvedSymbols:[]};
 const detail={definitionId:'rms-norm',inputs:[{port:'input',tensor}],outputs:[{port:'output',tensor}],effectiveRepeat:180} as unknown as OperatorDetail;
 const result=rmsNormFromOperator(detail,{input:2,output:2},rates);
 expect(result?.work.rsqrt).toBe(6);expect(result?.globalBytes).toBe(96);
 expect(rmsNormFromOperator({...detail,definitionId:'layer-norm'},{input:2,output:2},rates)).toBeNull();
 expect(rmsNormFromOperator({...detail,definitionId:'adarms'},{input:2,output:2},rates)).toBeNull();
 expect(rmsNormFromOperator({...detail,inputs:[{port:'input',tensor:{...tensor,shape:[null,4]}}]},{input:2,output:2},rates)).toBeNull();
});
