import {expect,it} from 'vitest';
import { atlasSnapshot as atlas } from '../../../testSupport/atlasSnapshot';
import type {AtlasData} from '../../../types/atlas';
import {modelAnalysisDescriptor,existingComparisons} from './modelAnalysisDescriptor';
const data=atlas as unknown as AtlasData;
it('uses existing SmolVLA configurations without promoting 5+50 batches to the default protocol',()=>{
 const descriptor=modelAnalysisDescriptor(data,'smolvla');
 expect(descriptor.defaultWorkload).toMatch(/^cfg-lerobot-smolvla/);
 expect(existingComparisons(data,'smolvla',null,false)).toHaveLength(0);
 const legacy=existingComparisons(data,'smolvla',null,true);
 expect(legacy.length).toBeGreaterThan(0);expect(legacy.every(row=>row.run.model_id==='smolvla')).toBe(true);
 expect(legacy[0]!.measurement.sampleCount).toBe(50);
});
it('does not supply a Pi0 configuration or target matrix when Pi0.5 has no canonical runs',()=>{
 expect(modelAnalysisDescriptor(data,'pi05').defaultWorkload).toBeNull();
 expect(modelAnalysisDescriptor(data,'pi05').comparisonKind).toBe('existing');
 expect(existingComparisons(data,'pi05',null,true)).toHaveLength(0);
 expect(modelAnalysisDescriptor(data,'pi0').defaultWorkload).toBe('v=1,p=48,a=50,n=10');
});
