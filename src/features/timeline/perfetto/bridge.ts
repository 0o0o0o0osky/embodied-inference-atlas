import type { TimelineRecord } from "../../profiler/domain/types";
import { perfettoRangeMessage, timelineToChromeTrace, type PerfettoWindow } from "./traceExport";

interface BridgeOptions {
  host: EventTarget;
  target: Pick<Window, "postMessage">;
  origin: string;
  onReady: () => void;
}

/** A single persistent iframe session. Only the matching origin AND window may complete the handshake. */
export function connectPerfetto({ host, target, origin, onReady }: BridgeOptions) {
  let ready = false;
  let disposed = false;
  let pending: { timeline: TimelineRecord; window?: PerfettoWindow } | undefined;
  const post = (message: unknown) => target.postMessage(message, origin);
  const sendPending = () => {
    if (!ready || disposed || !pending) return;
    const { timeline, window } = pending;
    const buffer = new TextEncoder().encode(JSON.stringify(timelineToChromeTrace(timeline))).buffer;
    post({ perfetto: { buffer, title: timeline.captureId, fileName: `${timeline.timelineId}.json`, keepApiOpen: true, localOnly: true } });
    if (window) post(perfettoRangeMessage(window));
    pending = undefined;
  };
  const onMessage = (raw: Event) => {
    const event = raw as MessageEvent;
    if (event.source !== target || event.origin !== origin || event.data !== "PONG" || ready) return;
    ready = true;
    clearInterval(timer);
    onReady();
    sendPending();
  };
  host.addEventListener("message", onMessage);
  const timer = setInterval(() => post("PING"), 150);
  post("PING");
  return {
    open(timeline: TimelineRecord, window?: PerfettoWindow) {
      pending = { timeline, ...(window ? { window } : {}) };
      sendPending();
    },
    locate(window: PerfettoWindow) {
      if (pending) pending.window = window;
      else if (ready && !disposed) post(perfettoRangeMessage(window));
    },
    dispose() {
      disposed = true;
      pending = undefined;
      clearInterval(timer);
      host.removeEventListener("message", onMessage);
    },
  };
}
