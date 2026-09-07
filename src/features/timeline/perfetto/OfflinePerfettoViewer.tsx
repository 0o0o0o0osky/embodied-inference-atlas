import { useEffect, useRef, useState } from "react";
import type { TimelineRecord } from "../../profiler/domain/types";
import { connectPerfetto } from "./bridge";
import type { PerfettoWindow } from "./traceExport";
import "./perfetto.css";

export interface OfflinePerfettoViewerProps {
  timeline: TimelineRecord;
  selectedWindow?: PerfettoWindow;
}

export function OfflinePerfettoViewer({ timeline, selectedWindow }: OfflinePerfettoViewerProps) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<ReturnType<typeof connectPerfetto> | null>(null);
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const target = iframe.current?.contentWindow;
    if (!target) return;
    const connection = connectPerfetto({ host: window, target, origin: window.location.origin, onReady: () => setReady(true) });
    bridge.current = connection;
    const timer = setTimeout(() => setSlow(true), 20000);
    return () => { clearTimeout(timer); connection.dispose(); bridge.current = null; };
  }, []);
  useEffect(() => { bridge.current?.open(timeline, selectedWindow); }, [timeline]);
  useEffect(() => { if (selectedWindow) bridge.current?.locate(selectedWindow); }, [selectedWindow?.startNs, selectedWindow?.endNs]);
  return <section className="offline-perfetto" aria-label="离线深度时间线">
    <div className="offline-perfetto__heading">
      <h3>深度时间线 · Perfetto v58.2</h3>
      <button type="button" disabled={!ready} onClick={() => bridge.current?.locate(selectedWindow ?? { startNs: 0, endNs: timeline.window.durationNs })}>
        {selectedWindow ? "定位所选范围" : "显示完整采集"}
      </button>
    </div>
    <p role="status">{ready ? `已向本地查看器发送采集 ${timeline.captureId}；解析进度见下方。` : slow ? "本地查看器尚未就绪，请检查 HTTP 服务和 Perfetto 资源是否完整。" : "正在加载本地查看器…"}</p>
    <p className="offline-perfetto__note">缩放或选择区间查看细节；聚合项可包含多个时间片。工具菜单使用英文。</p>
    <iframe ref={iframe} title="离线 Perfetto 时间线" src="./perfetto/index.html#!/?mode=embedded" />
  </section>;
}
