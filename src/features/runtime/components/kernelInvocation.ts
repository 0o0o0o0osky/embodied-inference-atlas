import type { TimelineEvent } from '../../profiler/domain/types';
import type { RooflinePointRecord } from '../../roofline/domain/types';

export function invocationSelection(events: readonly TimelineEvent[], selectedId?: string) {
  const exact = events.filter(event=>event.count === 1 && event.evidenceSemantics === 'exact_interval').sort((a,b)=>a.startNs-b.startNs || a.eventId.localeCompare(b.eventId));
  const durations = exact.map(event=>event.durationNs).sort((a,b)=>a-b);
  const middle = Math.floor(durations.length/2);
  const medianNs = durations.length ? (durations[middle]! + durations[Math.floor((durations.length-1)/2)]!)/2 : null;
  const representative = medianNs === null ? null : exact.reduce((best,event)=>Math.abs(event.durationNs-medianNs)<Math.abs(best.durationNs-medianNs)?event:best,exact[0]!);
  return {events:exact, selected:exact.find(event=>event.eventId===selectedId) ?? representative,medianNs,minNs:durations[0] ?? null,maxNs:durations.at(-1) ?? null};
}

/** UI projection: a confirmed same-shape modeled population supplies per-launch work, never replay timing. */
export function invocationPoint(point: RooflinePointRecord,event:TimelineEvent,population:number):RooflinePointRecord|null {
  if (!Number.isInteger(point.calls) || point.calls <= 0 || point.calls !== population || event.count !== 1 || event.evidenceSemantics !== 'exact_interval'
    || !/M\s*=\s*\d+.*N\s*=\s*\d+.*K\s*=\s*\d+/.test(point.entity.shape_or_coverage)
    || !point.entity.coverage_key.includes('same-window-shape') || point.traffic.value_kind !== 'modeled') return null;
  const divide=(value:number|null)=>value===null?null:value/point.calls;
  const seconds=event.durationNs/1e9;
  return {...point,point_id:`${point.point_id}:${event.eventId}`,calls:1,
    entity:{...point.entity,shape_or_coverage:`${point.entity.shape_or_coverage.split(';')[0]}; 当前 trace 单次调用 ${event.eventId}`,coverage_key:`${point.entity.coverage_key}:${event.eventId}`},
    work:{total_flop:point.work.total_flop/point.calls,components:point.work.components.map(c=>({...c,flop:c.flop/point.calls,comparison_ops:c.comparison_ops/point.calls,transcendental_ops:c.transcendental_ops/point.calls,integer_ops:c.integer_ops/point.calls}))},
    traffic:{...point.traffic,total_byte:point.traffic.total_byte/point.calls,components:point.traffic.components.map(c=>({...c,byte:c.byte/point.calls})),excluded_internal:point.traffic.excluded_internal.map(c=>({...c,byte_avoided:c.byte_avoided/point.calls}))},
    timing:{...point.timing,observed_second:seconds,statistic:'single_observation',sample_count:1,timing_boundary_id:event.eventId},
    aggregation:{...point.aggregation,dependency_lower_bound_second:divide(point.aggregation.dependency_lower_bound_second),resource_compute_lower_bound_second:divide(point.aggregation.resource_compute_lower_bound_second),resource_memory_lower_bound_second:divide(point.aggregation.resource_memory_lower_bound_second)},
    derived:{...point.derived,compute_second:divide(point.derived.compute_second),memory_second:divide(point.derived.memory_second),roof_second:divide(point.derived.roof_second),achieved_flop_per_second:seconds>0?point.work.total_flop/point.calls/seconds:null,efficiency:null,gap:null},
  };
}
