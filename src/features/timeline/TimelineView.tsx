import { useEffect, useMemo, useState } from "react";

import type { RoutePatch, RouteState } from "../../app/routes";
import type { AtlasData, ModelRecord } from "../../types/atlas";
import { adaptProfilerEvidence } from "../profiler/domain/adaptProfilerEvidence";
import { indexProfilerEvidence } from "../profiler/domain/indexProfilerEvidence";
import { timelineEventEntity } from "../workbench/entityKeys";
import { TimelineInspector } from "./components/TimelineInspector";
import { TimelineToolbar } from "./components/TimelineToolbar";
import { TimelineTracks } from "./components/TimelineTracks";
import { buildTimelineView } from "./domain/buildTimelineView";
import { Pi0PerformanceNavigation } from "../runtime/components/Pi0PerformanceNavigation";
import { buildPi0PerformanceOverview } from "../runtime/domain/buildPi0PerformanceOverview";
import { runtimeProfilerSlice, scopeRuntimeProfiler, selectRuntimeProfilerCaptures } from "../runtime/domain/scopeRuntimeProfiler";

interface TimelineViewProps {
  data: AtlasData;
  model: ModelRecord;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

export function TimelineView({ data, model, route, navigate }: TimelineViewProps) {
  const isPi0 = model.model_id === "pi0";
  const rawEvidence = useMemo(() => adaptProfilerEvidence(data), [data]);
  const performanceOverview = useMemo(() => isPi0
    ? buildPi0PerformanceOverview({ data, hardwareId: route.hardware })
    : null, [data, isPi0, route.hardware]);
  const selectedFacet = useMemo(() => {
    const matching = performanceOverview?.facets.filter((facet) => facet.runtimeId === route.runtime
      && facet.precisionId === route.runtimePrecision) ?? [];
    return matching.find((facet) => facet.id === route.runtimeFacet)
      ?? (route.runtimeFacet === null && matching.length === 1 ? matching[0]! : null);
  }, [performanceOverview, route.runtime, route.runtimeFacet, route.runtimePrecision]);
  const slice = useMemo(() => runtimeProfilerSlice(
    data,
    route.workload,
    selectedFacet?.comparisonContext ?? null,
  ), [data, route.workload, selectedFacet]);
  const scope = useMemo(() => isPi0 ? scopeRuntimeProfiler(data, rawEvidence, {
    modelId: model.model_id,
    runtimeId: route.runtime,
    hardwareId: route.hardware,
    precisionId: route.runtimePrecision,
    slice,
  }) : { data, evidence: rawEvidence, partialContextRunIds: new Set<string>() },
  [data, isPi0, model.model_id, rawEvidence, route.hardware, route.runtime, route.runtimePrecision, slice]);
  const evidence = scope.evidence;
  const captureSelection = useMemo(() => isPi0
    ? selectRuntimeProfilerCaptures(evidence, route.timelineCapture)
    : null, [evidence, isPi0, route.timelineCapture]);
  const timelineEvidence = useMemo(() => captureSelection?.suppressTimelineFallback
    ? { ...evidence, captures: evidence.captures.filter((capture) => capture.tool !== "nsys") }
    : evidence, [captureSelection, evidence]);
  const index = useMemo(() => indexProfilerEvidence(timelineEvidence), [timelineEvidence]);
  const view = useMemo(() => buildTimelineView(scope.data, timelineEvidence, index, {
    modelId: model.model_id,
    runtimeId: route.runtime,
    hardwareId: route.hardware,
    captureId: captureSelection?.timelineCaptureId ?? route.timelineCapture,
    entity: route.entity,
  }), [scope.data, timelineEvidence, index, model.model_id, route.entity, route.hardware, route.runtime, route.timelineCapture, captureSelection]);
  const [zoom, setZoom] = useState(1);
  const [panPercent, setPanPercent] = useState(0);
  const captureId = view.active?.capture.captureId ?? null;

  useEffect(() => {
    setZoom(1);
    setPanPercent(0);
  }, [captureId]);

  if (!view.active) {
    return (
      <>
        {isPi0 ? <Pi0PerformanceNavigation route={route} navigate={navigate} surface="timeline" /> : null}
        <section className={`timeline-empty ${isPi0 ? "is-pi0" : ""}`} aria-labelledby="timeline-empty-title">
          <p>{isPi0 ? "当前推理栈没有可用的单次采集证据" : "Single-capture evidence boundary"}</p>
          <h2 id="timeline-empty-title">{isPi0 ? "暂无 Nsys 时间线" : "Timeline unavailable"}</h2>
          <span>{view.unavailableReason}</span>
          <strong>{isPi0
            ? "不会借用其他推理栈或模型的 capture、区间或 CPU / GPU 数据。"
            : "No capture, interval, or CPU/GPU arithmetic is borrowed from another runtime or model."}</strong>
        </section>
      </>
    );
  }

  const timeline = view.active.timeline;
  const partialCaptureContext = isPi0 && scope.partialContextRunIds.has(view.active.run.run_id);
  const windowDurationNs = timeline.window.durationNs / zoom;
  const maximumStart = timeline.window.durationNs - windowDurationNs;
  const windowStartNs = timeline.window.startNs + maximumStart * (panPercent / 100);
  const tracks = (
    <TimelineTracks
      locale={isPi0 ? "zh" : "en"}
      timeline={timeline}
      windowStartNs={windowStartNs}
      windowDurationNs={windowDurationNs}
      selectedEventId={view.selectedEvent?.eventId ?? null}
      onSelect={(event) => navigate({ entity: timelineEventEntity(timeline.timelineId, event.eventId) }, true)}
    />
  );
  return (
    <section className={`timeline-workspace ${isPi0 ? "is-pi0" : ""}`} aria-labelledby="timeline-title">
      {isPi0 ? <Pi0PerformanceNavigation route={route} navigate={navigate} surface="timeline" /> : null}
      <header className={`timeline-intro ${isPi0 ? "timeline-intro--pi0" : ""}`}>
        <div>
          {!isPi0 ? <p>Sanitized Nsys evidence / exactly one capture</p> : null}
          <h2 id="timeline-title">{isPi0 ? "Nsys 时间线" : "Prediction timing instrument"}</h2>
          <span>{isPi0
            ? "同一采集窗口内对齐 CPU、CUDA 与 GPU 记录；空白表示未观测，不代表空闲。"
            : "Intervals share one relative target window. Graph traces show execution envelopes; node traces show recorded kernel/copy activity. Neither is labeled as complete GPU busy time."}</span>
        </div>
        <dl>
          <div><dt>{isPi0 ? "采集模式" : "Nsys captures"}</dt><dd>{isPi0
            ? pi0CaptureMode(view.active.capture.nsys?.reportMode, view.active.capture.nsys?.schedulerScope)
            : view.options.length}</dd></div>
          <div><dt>{isPi0 ? "窗口" : "Window"}</dt><dd>{formatDuration(timeline.window.durationNs)}</dd></div>
          <div><dt>{isPi0 ? "区间" : "Intervals"}</dt><dd>{timeline.events.length.toLocaleString()}</dd></div>
        </dl>
      </header>

      {partialCaptureContext ? (
        <p className="pi0-capture-context-status" role="status">
          <strong>独立采集 · 部分上下文</strong>
          <span>此 Nsys capture 不是当前选中的 wall-clock run；未知 workload 字段保持未知。</span>
        </p>
      ) : null}

      {view.requestedCaptureUnavailable ? (
        <p className="timeline-route-warning" role="status">{isPi0
          ? "请求的 capture 不属于当前模型、推理栈或硬件范围；现显示默认兼容 capture，地址栏保持不变。"
          : "The requested timeline capture is outside the active model/runtime/hardware scope. The default compatible capture is shown without rewriting the URL."}</p>
      ) : null}

      <TimelineToolbar
        view={view}
        locale={isPi0 ? "zh" : "en"}
        zoom={zoom}
        panPercent={panPercent}
        windowStartNs={windowStartNs}
        windowDurationNs={windowDurationNs}
        onCapture={(nextCaptureId) => navigate({ timelineCapture: nextCaptureId, entity: null })}
        onZoom={(nextZoom) => {
          setZoom(nextZoom);
          setPanPercent(nextZoom === 1 ? 0 : panPercent);
        }}
        onPan={setPanPercent}
      />

      <div className={`timeline-analysis-grid ${isPi0 ? "is-pi0" : ""}`}>
        <div className="timeline-primary-column">
          {isPi0 ? <div className="pi0-nsys-instrument timeline-detail-instrument">{tracks}</div> : tracks}
          {isPi0 ? (
            <div className="timeline-secondary-grid">
              <details className="timeline-inspector-disclosure">
                <summary>
                  <span><strong>区间与 Kernel 详情</strong><small>当前选中区间、Nsys 聚合与匹配的 NCU 重放</small></span>
                  <b>展开</b>
                </summary>
                <TimelineInspector view={view} route={route} navigate={navigate} locale="zh" />
              </details>
              <TimelineSummary view={view} locale="zh" disclosure />
            </div>
          ) : <TimelineSummary view={view} />}
        </div>
        {!isPi0 ? <TimelineInspector view={view} route={route} navigate={navigate} /> : null}
      </div>
    </section>
  );
}

function TimelineSummary({
  view,
  locale = "en",
  disclosure = false,
}: {
  view: ReturnType<typeof buildTimelineView>;
  locale?: "en" | "zh";
  disclosure?: boolean;
}) {
  const active = view.active!;
  const zh = locale === "zh";
  const summary = (name: string) => view.summariesByName.get(name) ?? null;
  const node = active.capture.nsys?.reportMode === "node";
  const records = node ? [
    [zh ? "已记录 Kernel + copy 并集" : "Recorded kernel + copy union", summary("recorded_gpu_activity_union"), zh ? "仅代表已记录活动，不等于完整 GPU 忙碌" : "represented activity; not all GPU busy"],
    [zh ? "目标线程调度核时重叠" : "Target scheduled core-time overlap", summary("target_scheduled_core_time_overlapping_recorded_gpu_activity"), zh ? "逐线程调度时长，可能大于墙钟重叠" : "per-thread scheduled time; may exceed wall overlap"],
    [zh ? "目标线程墙钟重叠" : "Target wall overlap", summary("target_wall_overlap_with_recorded_gpu_activity"), zh ? "目标线程墙钟并集与已记录活动相交" : "wall union intersected with represented activity"],
    [zh ? "窗口内目标线程调度核时" : "Target scheduled core-time / window", summary("target_scheduled_core_time_over_full_window"), zh ? "调度运行证据，不等于有效工作或空闲" : "scheduler-running evidence; not useful-work or idle proof"],
  ] as const : [
    [zh ? "CUDA Graph 执行跨度" : "CUDA Graph execution span", summary("cuda_graph_span_union"), zh ? "执行包络，不等于 GPU 忙碌" : "execution envelope; not GPU busy"],
    [zh ? "Graph 包络内目标线程调度核时" : "Target scheduled core-time overlap", summary("target_scheduled_core_time_overlapping_graph_spans"), zh ? "Graph 包络内的调度运行时长" : "scheduler-running time during graph envelopes"],
    [zh ? "已记录 copy 活动并集" : "Recorded copy activity union", summary("recorded_copy_activity_union"), zh ? "仅含 copy 区间，此模式没有 Kernel 并集" : "copy intervals only; no kernel union at this trace mode"],
    [zh ? "Graph 包络外" : "Outside graph envelopes", summary("outside_graph_span_union"), zh ? "未观测 / 未知，不代表空闲" : "unobserved / unknown; not idle"],
  ] as const;
  const systemWide = active.capture.nsys?.schedulerScope === "system_wide";
  const ledger = (
    <>
      <dl>
        {records.map(([label, item, note]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{item ? formatSummary(item.value, item.unit, locale) : zh ? "未记录" : "Not available"}</dd>
            <small>{note}</small>
          </div>
        ))}
        {systemWide ? <>
          <div><dt>{zh ? "非 Profiler 等效调度核数" : "Non-profiler scheduled cores"}</dt><dd>{formatOptionalSummary(summary("non_profiler_equivalent_scheduled_cores_during_graph_spans"), "cores", locale)}</dd><small>{zh ? "Graph 包络内的等效调度核数，不代表可用余量" : "equivalent scheduled cores during graph spans; not headroom"}</small></div>
          <div><dt>{zh ? "已观测调度容量占比" : "Observed scheduled capacity share"}</dt><dd>{formatOptionalSummary(summary("non_profiler_scheduled_capacity_share_during_graph_spans"), "percent", locale)}</dd><small>{zh ? "Graph 包络内相对 14 核容量" : "of 14-core capacity during graph spans"}</small></div>
        </> : null}
      </dl>
      {view.kernelCoverage ? (
        <p className="timeline-coverage-note">
          <strong>{view.kernelCoverage.classifiedLaunches.toLocaleString()} / {view.kernelCoverage.totalLaunches.toLocaleString()} {zh ? "次 Kernel launch 已分类" : "kernel launches classified"}</strong>
          <span>{zh
            ? `已分类 ${formatDuration(view.kernelCoverage.classifiedDurationNs)}（时长占比 ${((view.kernelCoverage.classifiedDurationNs / view.kernelCoverage.totalDurationNs) * 100).toFixed(2)}%）；仍有 ${view.kernelCoverage.unclassifiedLaunches.toLocaleString()} 次 / ${formatDuration(view.kernelCoverage.unclassifiedDurationNs)} 未分类。`
            : `${formatDuration(view.kernelCoverage.classifiedDurationNs)} classified (${((view.kernelCoverage.classifiedDurationNs / view.kernelCoverage.totalDurationNs) * 100).toFixed(2)}% duration); ${view.kernelCoverage.unclassifiedLaunches.toLocaleString()} launches / ${formatDuration(view.kernelCoverage.unclassifiedDurationNs)} remain unclassified.`}</span>
        </p>
      ) : null}
    </>
  );

  if (disclosure) {
    return (
      <details className="timeline-summary timeline-summary--disclosure">
        <summary>
          <span><strong>采集内重叠摘要</strong><small>只汇总当前 capture，不跨采集计算</small></span>
          <b>展开</b>
        </summary>
        {ledger}
      </details>
    );
  }

  return (
    <section className="timeline-summary" aria-labelledby="timeline-summary-title">
      <header><div><p>Same-capture interval summaries</p><h3 id="timeline-summary-title">Overlap ledger</h3></div><span>No cross-capture arithmetic</span></header>
      {ledger}
    </section>
  );
}

function formatOptionalSummary(item: { value: number; unit: string } | null, fallbackUnit: string, locale: "en" | "zh" = "en") {
  return item ? formatSummary(item.value, item.unit || fallbackUnit, locale) : locale === "zh" ? "未记录" : "Not available";
}

function formatSummary(value: number, unit: string, locale: "en" | "zh" = "en") {
  if (unit === "ns") return formatDuration(value);
  if (unit === "percent") return `${value.toFixed(2)}%`;
  if (unit === "cores") return `${value.toFixed(3)} ${locale === "zh" ? "核" : "cores"}`;
  return `${value}`;
}

function pi0CaptureMode(mode: "graph" | "node" | undefined, schedulerScope: string | undefined) {
  if (schedulerScope === "system_wide") return "全系统调度";
  return mode === "node" ? "节点级 trace" : "Graph 包络";
}

function formatDuration(valueNs: number) {
  if (valueNs >= 1e6) return `${(valueNs / 1e6).toFixed(3)} ms`;
  if (valueNs >= 1e3) return `${(valueNs / 1e3).toFixed(3)} µs`;
  return `${valueNs.toFixed(0)} ns`;
}
