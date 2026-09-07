import {expect,it} from 'vitest';
import type {RooflineCeilingRecord} from './types';
import {resolveAttentionHardwareProfile,resolveNormalizationHardwareProfile} from './attentionHardwareProfile';
const ceiling:RooflineCeilingRecord={schema_version:'2.0.0',ceiling_id:'test',label:'test',device_id:'nvidia-jetson-agx-thor',
 operating_point:{operating_point_id:'test',power_mode:'120W',gpu_clock_hz:1.386e9,emc_clock_hz:null,clock_basis:'mode_assumption',sparsity_on:null},
 compute:[],bandwidth:[],missing:[]};
it('separates ordinary FP32 operations from FMA FLOPs and exposes SFU/compare assumptions',()=>{
 const result=resolveAttentionHardwareProfile(ceiling);
 expect(result.rates.scalarOp).toBe(7.096e12/2);
 expect(result.rates.reductionAdd).toBe(result.rates.scalarOp);
 expect(result.rates.exp).toBe(20*16*1.386e9);
 expect(result.rates.reciprocal).toBe(result.rates.exp);
 expect(result.rates.reductionCompare).toBe(20*128*1.386e9);
 expect(result.conditional).toBe(true);
 expect(result.notes.join(' ')).toContain('CC 11.0');
 expect(result.notes.join(' ')).toContain('exp2');
 expect(result.sources).toHaveLength(2);
 const max=resolveAttentionHardwareProfile({...ceiling,operating_point:{...ceiling.operating_point,power_mode:'maximum_specification',gpu_clock_hz:1.575e9}});
 expect(max.rates.scalarOp).toBe(8.064e12/2);expect(max.rates.exp).toBe(504e9);
});
it('does not transfer the profile to another device, unknown clock or a different operating point',()=>{
 const empty={scalarOp:null,exp:null,reciprocal:null,reductionAdd:null,reductionCompare:null};
 expect(resolveAttentionHardwareProfile(null).rates).toEqual(empty);
 expect(resolveAttentionHardwareProfile({...ceiling,device_id:'other-device'}).rates).toEqual(empty);
 expect(resolveAttentionHardwareProfile({...ceiling,operating_point:{...ceiling.operating_point,gpu_clock_hz:null,clock_basis:'unknown'}}).rates).toEqual(empty);
 // A clock changed independently of the power label must not retain the published rate.
 expect(resolveAttentionHardwareProfile({...ceiling,operating_point:{...ceiling.operating_point,gpu_clock_hz:1e9}}).rates).toEqual(empty);
});

it('uses explicit approximate rsqrt assumptions without borrowing Tensor peaks',()=>{
 const profile=resolveNormalizationHardwareProfile(ceiling);
 expect(profile.rates).toEqual({scalarOp:3.548e12,reductionAdd:3.548e12,rsqrt:443.52e9});
 expect(profile.conditional).toBe(true);expect(profile.notes.join(' ')).toContain('近似');
 expect(resolveNormalizationHardwareProfile({...ceiling,device_id:'unknown'}).rates.rsqrt).toBeNull();
});
