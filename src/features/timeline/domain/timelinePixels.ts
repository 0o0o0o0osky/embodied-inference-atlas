import type { TimelineEvent } from '../../profiler/domain/types';

/** Rendering-only bins. Original events are retained for drilldown and export. */
export function timelinePixels(events:readonly TimelineEvent[],startNs:number,durationNs:number,width:number,selectedId:string|null) {
  const bins=new Map<number,TimelineEvent[]>();
  const result:{x:number;width:number;events:readonly TimelineEvent[]}[]=[];
  for(const event of events){
    const start=Math.max(startNs,event.startNs),end=Math.min(startNs+durationNs,event.startNs+event.durationNs);
    if(end<=start)continue;
    const x=(start-startNs)/durationNs*width,w=(end-start)/durationNs*width;
    if(w>=1 || event.eventId===selectedId) result.push({x,width:Math.max(w,1),events:[event]});
    else {const pixel=Math.floor(x);const list=bins.get(pixel)??[];list.push(event);bins.set(pixel,list);}
  }
  for(const [x,items] of bins)result.push({x,width:1,events:items});
  return result.sort((a,b)=>a.x-b.x || Number(a.events[0]?.eventId===selectedId)-Number(b.events[0]?.eventId===selectedId));
}
