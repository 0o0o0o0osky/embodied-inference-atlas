import {expect,it} from 'vitest';
import ceilings from '../../../../data/analysis/roofline_ceilings.json';
import type {RooflineCeilingRecord} from './types';
import {resolveAttentionHardwareProfile,resolveNormalizationHardwareProfile,resolveRemainingHardwareProfile} from './operatorHardwareProfile';
const ceiling=ceilings.records.find(c=>c.ceiling_id==='thor-t5000-120w-1386mhz') as unknown as RooflineCeilingRecord;
it('preserves recorded ordinary and approximate instruction rates',()=>{
 const result=resolveAttentionHardwareProfile(ceiling);
 expect(result.rates).toEqual({scalarOp:3.548e12,reductionAdd:3.548e12,exp:443.52e9,reciprocal:443.52e9,reductionCompare:3548.16e9});
 expect(result.conditional).toBe(true);
 expect(resolveNormalizationHardwareProfile(ceiling).rates.rsqrt).toBe(443.52e9);
 const remaining=resolveRemainingHardwareProfile(ceiling);
 for(const name of ['exp','reciprocal','rsqrt','sin','cos'] as const)expect(remaining.rates[name]).toBe(443.52e9);
 const max=ceilings.records.find(c=>c.ceiling_id==='thor-t5000-published-max') as unknown as RooflineCeilingRecord;
 expect(resolveAttentionHardwareProfile(max).rates.scalarOp).toBe(4.032e12);
});
it('reads another explicitly configured device without model-specific code',()=>{
 const other:RooflineCeilingRecord={...ceiling,device_id:'fixture-device',operating_point:{...ceiling.operating_point,power_mode:'fixture-mode'},operation_rates:{...ceiling.operation_rates!,device_id:'fixture-device',
  rates:ceiling.operation_rates!.rates.flatMap(rate=>[
    {...rate,operations:rate.operations.filter(op=>op!=='sin'),operation_per_second:123},
    ...(rate.operations.includes('sin')?[{...rate,operations:['sin' as const],operation_per_second:null}]:[]),
  ])}};
 expect(resolveAttentionHardwareProfile(other).rates.scalarOp).toBe(123);
 expect(resolveRemainingHardwareProfile(other).rates.cos).toBe(123);
 expect(resolveRemainingHardwareProfile(other).rates.sin).toBeNull();
});
it('leaves missing or mismatched device/clock configurations empty',()=>{
 const {operation_rates:ignored,...missing}=ceiling;
 for(const input of [null,missing,{...ceiling,device_id:'unconfigured-device'},
   {...ceiling,operating_point:{...ceiling.operating_point,gpu_clock_hz:1e9}}]){
  expect(resolveAttentionHardwareProfile(input).rates.scalarOp).toBeNull();
  expect(resolveNormalizationHardwareProfile(input).rates.rsqrt).toBeNull();
 }
});
