import type { TimelineRecord } from "../../profiler/domain/types";
import { laneTitle } from "../components/timelineLabels";

export interface PerfettoWindow { startNs: number; endNs: number }
interface ChromeTraceEvent {
  ph: "M" | "X" | "i";
  s?: "t";
  name: string;
  pid: number;
  tid?: number;
  cat?: string;
  ts?: number;
  dur?: number;
  args: Record<string, unknown>;
}

/** Chrome Trace JSON uses microseconds; canonical event times already start at the target window. */
export function timelineToChromeTrace(timeline: TimelineRecord) {
  const lanes = new Map(timeline.lanes.map((lane, index) => [lane.laneId, { lane, tid: index + 1 }]));
  const traceEvents: ChromeTraceEvent[] = [{ ph: "M", name: "process_name", pid: 1000000, args: { name: `逻辑轨道 / ${timeline.captureId}` } }];
  for (const { lane, tid } of lanes.values()) {
    traceEvents.push({ ph: "M", name: "thread_name", pid: 1000000, tid, args: { name: `${laneTitle(lane)} · ${lane.laneId} (${lane.coverage})` } });
    traceEvents.push({ ph: "M", name: "thread_sort_index", pid: 1000000, tid, args: { sort_index: tid * 1000 } });
  }
  // JSON complete slices must nest or be disjoint on a thread. Canonical GPU
  // lanes can contain overlapping intervals without a known stream distinction.
  // Partition only the display rows; never invent source stream or stack identity.
  const eventRows = new Map<string, { tid: number; row: number }>();
  let nextTid = timeline.lanes.length + 1;
  for (const { lane, tid } of lanes.values()) {
    const rows: { tid: number; endNs: number }[] = [{ tid, endNs: -Infinity }];
    const events = timeline.events.filter(event => event.laneId === lane.laneId)
      .sort((a, b) => a.startNs - b.startNs || b.durationNs - a.durationNs || a.eventId.localeCompare(b.eventId));
    for (const event of events) {
      let rowIndex = rows.findIndex(row => row.endNs <= event.startNs);
      if (rowIndex < 0) {
        rowIndex = rows.length;
        const extraTid = nextTid++;
        rows.push({ tid: extraTid, endNs: -Infinity });
        traceEvents.push({ ph: "M", name: "thread_name", pid: 1000000, tid: extraTid,
          args: { name: `${laneTitle(lane)} · ${lane.laneId} · 交叠显示行 ${rowIndex + 1}（非新增 stream）` } });
        traceEvents.push({ ph: "M", name: "thread_sort_index", pid: 1000000, tid: extraTid, args: { sort_index: tid * 1000 + rowIndex } });
      }
      const row = rows[rowIndex]!;
      row.endNs = event.startNs + event.durationNs;
      eventRows.set(event.eventId, { tid: row.tid, row: rowIndex + 1 });
    }
  }
  for (const event of timeline.events) {
    const track = lanes.get(event.laneId);
    if (!track) throw new Error(`Timeline event ${event.eventId} has no canonical lane`);
    traceEvents.push({
      ph: "X", name: event.label, cat: event.eventKind, pid: 1000000, tid: eventRows.get(event.eventId)!.tid,
      ts: event.startNs / 1000, dur: event.durationNs / 1000,
      args: {
        event_id: event.eventId, timeline_id: timeline.timelineId, capture_id: timeline.captureId,
        run_id: timeline.runId, source_id: timeline.sourceId, lane_id: event.laneId,
        display_row: eventRows.get(event.eventId)!.row, lane_kind: track.lane.kind, lane_role: track.lane.role, coverage: track.lane.coverage,
        evidence_semantics: event.evidenceSemantics, count: event.count,
        kernel_signature_id: event.kernelSignatureId, bytes: event.bytes, copy_direction: event.copyDirection,
        ...(event.launch?{launch:event.launch}:{}),...(event.apiName?{api_name:event.apiName}:{}),
      },
    });
  }
  for(const sample of timeline.cpuSamples??[]){
    const track=lanes.get(sample.laneId);
    if(!track)throw new Error(`CPU sample ${sample.sampleId} has no canonical lane`);
    traceEvents.push({ph:'i',s:'t',name:'CPU 函数采样',pid:1000000,tid:track.tid,cat:'cpu_sample',ts:sample.timeNs/1000,
      args:{sample_id:sample.sampleId,weight:sample.weight,frames:sample.frames,evidence_semantics:'sample_at_timestamp_not_duration'}});
  }
  return {
    traceEvents, displayTimeUnit: "ns",
    metadata: {
      exporter: "atlas-canonical-chrome-trace-v1", timeline_id: timeline.timelineId,
      capture_id: timeline.captureId, run_id: timeline.runId, source_id: timeline.sourceId,
      time_basis: timeline.timeBasis, source_window_start_ns: timeline.window.startNs,
      window_duration_ns: timeline.window.durationNs, missing: timeline.missing,
      track_identity: "pid and tid are export-local logical track identifiers, not source OS identifiers",
      interval_semantics: "See each event's evidence_semantics; aggregate spans do not imply continuous execution",
    },
  };
}

/** Perfetto's embedding range API uses absolute trace seconds (this exported trace has origin zero). */
export function perfettoRangeMessage(window: PerfettoWindow) {
  return { perfetto: { timeStart: window.startNs / 1e9, timeEnd: window.endNs / 1e9, viewPercentage: 1 } };
}
