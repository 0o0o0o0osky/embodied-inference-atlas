import { expect,it } from 'vitest';
import type { TimelineEvent } from '../../profiler/domain/types';
import { timelinePixels } from './timelinePixels';
it('bins only subpixel intervals, preserving selected identity and all source events',()=>{
  const events=Array.from({length:20},(_,i)=>({eventId:`e${i}`,startNs:i,durationNs:1}) as TimelineEvent);
  const bins=timelinePixels(events,0,1000,10,'e3');
  expect(bins).toHaveLength(2);
  expect(bins.find(b=>b.events[0]?.eventId==='e3')?.events).toHaveLength(1);
  expect(bins.flatMap(b=>b.events)).toHaveLength(20);
  expect(events).toHaveLength(20);
  expect(timelinePixels(events,0,20,100,null)).toHaveLength(20);
});
