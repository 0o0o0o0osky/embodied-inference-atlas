import { describe, expect, it, vi, afterEach } from "vitest";
import type { TimelineRecord } from "../../profiler/domain/types";
import { timelineToChromeTrace, perfettoRangeMessage } from "./traceExport";
import { connectPerfetto } from "./bridge";

const timeline: TimelineRecord = {
  timelineId: "timeline-a", captureId: "capture-a", runId: "run-a", sourceId: "source-a",
  window: { label: "predict", startNs: 8000000000, durationNs: 10000 },
  timeBasis: "relative_to_target_window_start",
  lanes: [{ laneId: "stream-a", kind: "gpu_kernel", role: "kernel-stream", ordinal: 1, coverage: "partial" }],
  events: [{ eventId: "event-a", laneId: "stream-a", eventKind: "kernel", label: "GEMM", startNs: 1250, durationNs: 2375, count: 2, kernelSignatureId: "gemm-a", bytes: null, copyDirection: null, evidenceSemantics: "aggregated_interval" }],
  summaries: [], missing: {},
};

describe("canonical Perfetto export", () => {
  it("preserves relative nanosecond intervals as Chrome microseconds and evidence identity", () => {
    const trace = timelineToChromeTrace(timeline);
    const event = trace.traceEvents.find(item => item.ph === "X");
    expect(event).toMatchObject({ ts: 1.25, dur: 2.375, cat: "kernel", args: { event_id: "event-a", capture_id: "capture-a", lane_id: "stream-a", coverage: "partial", evidence_semantics: "aggregated_interval", count: 2, bytes: null } });
    expect(trace.metadata).toMatchObject({ time_basis: "relative_to_target_window_start", source_window_start_ns: 8000000000 });
    expect(trace.traceEvents.every(item => ["X", "M"].includes(item.ph))).toBe(true);
    expect(event).not.toHaveProperty("sf");
    expect(event).not.toHaveProperty("cpu");
  });
  it("keeps overlapping intervals on separate display rows without inventing extra source streams", () => {
    const first = timeline.events[0]!;
    const trace = timelineToChromeTrace({ ...timeline, events: [first, { ...first, eventId: "event-b", startNs: 2000, durationNs: 3000 }] });
    const events = trace.traceEvents.filter(item => item.ph === "X");
    expect(events[0]!.tid).not.toEqual(events[1]!.tid);
    expect(events.every(item => item.args.lane_id === "stream-a")).toBe(true);
    expect(events.map(item => item.args.event_id)).toEqual(["event-a", "event-b"]);
    expect(events.map(item => item.dur)).toEqual([2.375, 3]);
  });
  it("uses seconds for range messages without adding the original capture offset", () => {
    expect(perfettoRangeMessage({ startNs: 1250, endNs: 3625 })).toEqual({ perfetto: { timeStart: 0.00000125, timeEnd: 0.000003625, viewPercentage: 1 } });
  });
});

afterEach(() => vi.useRealTimers());

it("waits for the trusted iframe PONG, sends latest capture and keeps API open for switching", () => {
  vi.useFakeTimers();
  const host = new EventTarget();
  const sent: unknown[] = [];
  const frame = { postMessage: (message: unknown) => sent.push(message) };
  const connection = connectPerfetto({ host, target: frame, origin: "http://localhost:4186", onReady: () => {} });
  connection.open(timeline);
  expect(sent).toEqual(["PING"]);
  host.dispatchEvent(new MessageEvent("message", { data: "PONG", origin: "https://wrong.test" }));
  expect(sent).toEqual(["PING"]);
  connection.open({ ...timeline, captureId: "capture-pending" });
  const pong = new MessageEvent("message", { data: "PONG", origin: "http://localhost:4186" });
  Object.defineProperty(pong, "source", { value: frame });
  host.dispatchEvent(pong);
  expect(sent[1]).toMatchObject({ perfetto: { title: "capture-pending", keepApiOpen: true, localOnly: true } });
  connection.open({ ...timeline, captureId: "capture-b" }, { startNs: 1250, endNs: 3625 });
  expect(sent[2]).toMatchObject({ perfetto: { title: "capture-b" } });
  expect(sent[3]).toEqual(perfettoRangeMessage({ startNs: 1250, endNs: 3625 }));
  connection.dispose();
  vi.advanceTimersByTime(1000);
  expect(sent).toHaveLength(4);
});
