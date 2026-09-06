import { expect, it } from 'vitest';
import type { TimelineEvent } from '../../profiler/domain/types';
import { atlasSnapshot as atlas } from '../../../testSupport/atlasSnapshot';
import type { RooflinePointRecord } from '../../roofline/domain/types';
import { invocationSelection, invocationPoint } from './kernelInvocation';
const events = [9, 2, 5, 6].map((durationNs,i)=>({eventId:String(i),startNs:i*20,durationNs,count:1,evidenceSemantics:'exact_interval',kernelSignatureId:'sig'} as TimelineEvent));
it('selects an actual invocation closest to median and preserves explicit selection',()=>{
 expect(invocationSelection(events).selected?.durationNs).toBe(5);
 expect(invocationSelection(events,'0').selected?.durationNs).toBe(9);
 expect(invocationSelection(events).medianNs).toBe(5.5);
 expect(invocationSelection([{...events[0]!,count:2}]).selected).toBeNull();
});
it('uses selected trace timing and divides only a known homogeneous modeled population',()=>{
 const point = (atlas.datasets.roofline_points as unknown as readonly RooflinePointRecord[]).find(p=>p.entity.shape_or_coverage.includes('M=16384'))! as unknown as RooflinePointRecord;
 const event = {...events[0]!,durationNs:123000};
 const projected=invocationPoint(point,event,point.calls);
 expect(projected?.calls).toBe(1);
 expect(projected?.timing.observed_second).toBe(0.000123);
 expect(projected?.work.total_flop).toBe(point.work.total_flop/point.calls);
 expect(projected?.derived.efficiency).toBeNull();
 expect(invocationPoint(point,event,point.calls+1)).toBeNull();
 expect(invocationPoint({...point,calls:0},event,0)).toBeNull();
 expect(invocationPoint({...point,traffic:{...point.traffic,value_kind:'measured'}},event,point.calls)).toBeNull();
});
