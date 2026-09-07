import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { TimelineEvent, TimelineLane, TimelineRecord } from '../../profiler/domain/types';
import { eventTitle, laneTitle } from './timelineLabels';
import { TimelineTracks } from './TimelineTracks';
import { TimelineEventDetails } from './TimelineEventDetails';

const main={laneId:'main',kind:'cpu_thread',role:'target-main',ordinal:0,coverage:'complete'} as TimelineLane;
const eventLane={laneId:'events',kind:'osrt',role:'cuda-event-handler',ordinal:8,coverage:'complete'} as TimelineLane;
const poll={eventId:'poll',laneId:'events',eventKind:'osrt',apiName:'poll',label:'osrt-call',startNs:0,durationNs:42000000,count:1,kernelSignatureId:null,bytes:null,copyDirection:null,evidenceSemantics:'exact_interval'} as TimelineEvent;
const timeline={timelineId:'one',window:{startNs:0,durationNs:42000000},lanes:[main,eventLane],events:[poll]} as unknown as TimelineRecord;

it('labels the observed thread role and explains a poll interval in the selected window',()=>{
 expect(laneTitle(eventLane)).toBe('CUDA 事件处理线程');
 expect(laneTitle(eventLane)).not.toContain('8');
 expect(eventTitle(poll)).toContain('等待 I/O 事件');
 const markup=renderToStaticMarkup(<TimelineEventDetails timeline={timeline} event={poll} onFocus={()=>undefined}/>);
 expect(markup).toContain('窗口内等待时间');expect(markup).toContain('42.000 ms');
 expect(markup).toContain('事件到达或超时后');
});
it('omits empty scheduler tracks while retaining recorded waits',()=>{
 const markup=renderToStaticMarkup(<TimelineTracks timeline={timeline} windowStartNs={0} windowDurationNs={42000000} selectedEventId={null} onSelect={()=>undefined}/>);
 expect(markup).not.toContain('data-lane-id="main"');
 expect(markup).toContain('data-lane-id="events"');expect(markup).toContain('poll：等待 I/O 事件');
 expect(markup).not.toContain('线程 8');
});
it('folds profiler scheduler intervals separately from application CPU work',()=>{
 const profiler={...main,laneId:'profiler',kind:'cpu_aggregate',role:'profiler-excluded'} as TimelineLane;
 const {apiName: _apiName,...interval}=poll;
 const sample={...interval,eventId:'profiler-run',laneId:'profiler',eventKind:'scheduler'} as TimelineEvent;
 const markup=renderToStaticMarkup(<TimelineTracks timeline={{...timeline,lanes:[...timeline.lanes,profiler],events:[poll,sample]}} windowStartNs={0} windowDurationNs={42000000} selectedEventId={null} onSelect={()=>undefined}/>);
 expect(markup).not.toContain('<strong>CPU 实际运行</strong>');
 expect(markup).toContain('<details class="timeline-track-group"><summary><strong>采集器 · 已排除</strong>');
 expect(markup).toContain('Nsys 采集线程');
});
