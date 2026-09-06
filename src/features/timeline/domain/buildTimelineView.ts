import type { AtlasData, RunRecord } from "../../../types/atlas";
import type { ProfilerEvidenceIndex } from "../../profiler/domain/indexProfilerEvidence";
import type {
  KernelObservation,
  KernelSignature,
  ProfilerCapture,
  ProfilerEvidence,
  ProfilerMetric,
  TimelineEvent,
  TimelineRecord,
  TimelineSummary,
  TelemetryRecord,
} from "../../profiler/domain/types";
import { parseEntityKey } from "../../workbench/entityKeys";

export interface TimelineCaptureOption {
  capture: ProfilerCapture;
  timeline: TimelineRecord;
  run: RunRecord;
  label: string;
  basisLabel: string;
  timelineRecordCount: number;
}

export interface TimelineWarpSupplement {
  observation: KernelObservation;
  capture: ProfilerCapture;
  run: RunRecord;
  deviceLabel: string;
  metrics: readonly ProfilerMetric[];
  telemetry: readonly TelemetryRecord[];
}

export interface TimelineViewModel {
  options: readonly TimelineCaptureOption[];
  active: TimelineCaptureOption | null;
  selectedEvent: TimelineEvent | null;
  selectedSignature: KernelSignature | null;
  selectedObservation: KernelObservation | null;
  separateReplay: KernelObservation | null;
  separateReplayCapture: ProfilerCapture | null;
  separateReplayRun: RunRecord | null;
  separateReplayDeviceLabel: string | null;
  replayMetrics: readonly ProfilerMetric[];
  replayTelemetry: readonly TelemetryRecord[];
  warpSupplement: TimelineWarpSupplement | null;
  summariesByName: ReadonlyMap<string, TimelineSummary>;
  requestedCaptureUnavailable: boolean;
  unavailableReason: string;
  kernelCoverage: {
    totalLaunches: number;
    classifiedLaunches: number;
    unclassifiedLaunches: number;
    totalDurationNs: number;
    classifiedDurationNs: number;
    unclassifiedDurationNs: number;
  } | null;
}


function captureLabel(capture: ProfilerCapture): string {
  if (capture.nsys?.reportMode === "node") return "Intrusive node trace";
  if (capture.nsys?.schedulerScope === "system_wide") return "System-wide scheduler trace";
  return "Graph-envelope trace";
}

function basisLabel(capture: ProfilerCapture, timeline: TimelineRecord): string {
  if (capture.nsys?.reportMode === "node") {
    return `${timeline.timeBasis.replaceAll("_", " ")} · exact kernel and copy intervals`;
  }
  return `${timeline.timeBasis.replaceAll("_", " ")} · CUDA Graph execution envelopes`;
}

function timelinesForCapture(index: ProfilerEvidenceIndex, captureId: string): readonly TimelineRecord[] {
  return [...(index.timelinesByCaptureId.get(captureId) ?? [])]
    .sort((left, right) => left.timelineId.localeCompare(right.timelineId));
}

function firstEventForSignature(timeline: TimelineRecord, signatureId: string): TimelineEvent | null {
  return timeline.events
    .filter((event) => event.kernelSignatureId === signatureId)
    .sort((left, right) => left.startNs - right.startNs || left.eventId.localeCompare(right.eventId))[0] ?? null;
}

function kernelCoverage(timeline: TimelineRecord): TimelineViewModel["kernelCoverage"] {
  const kernels = timeline.events.filter((event) => event.eventKind === "kernel");
  if (!kernels.length) return null;
  const classified = kernels.filter((event) => event.kernelSignatureId !== null);
  const totalDurationNs = kernels.reduce((sum, event) => sum + event.durationNs, 0);
  const classifiedDurationNs = classified.reduce((sum, event) => sum + event.durationNs, 0);
  return {
    totalLaunches: kernels.length,
    classifiedLaunches: classified.length,
    unclassifiedLaunches: kernels.length - classified.length,
    totalDurationNs,
    classifiedDurationNs,
    unclassifiedDurationNs: totalDurationNs - classifiedDurationNs,
  };
}

export function buildTimelineView(
  data: AtlasData,
  evidence: ProfilerEvidence,
  index: ProfilerEvidenceIndex,
  query: {
    modelId: string;
    runtimeId: string | null;
    hardwareId: string | null;
    captureId: string | null;
    entity: string | null;
  },
): TimelineViewModel {
  const runById = new Map(data.datasets.runs.map((run) => [run.run_id, run]));
  const options = evidence.captures.flatMap((capture): TimelineCaptureOption[] => {
    if (capture.tool !== "nsys") return [];
    const timelines = timelinesForCapture(index, capture.captureId);
    const timeline = timelines[0] ?? null;
    const run = runById.get(capture.runId);
    if (!timeline || !run || run.model_id !== query.modelId) return [];
    if (query.runtimeId && run.runtime_id !== query.runtimeId) return [];
    if (query.hardwareId && run.device_id !== query.hardwareId) return [];
    return [{
      capture,
      timeline,
      run,
      label: captureLabel(capture),
      basisLabel: basisLabel(capture, timeline),
      timelineRecordCount: timelines.length,
    }];
  }).sort((left, right) => {
    const rank = (item: TimelineCaptureOption) => item.capture.nsys?.reportMode === "node"
      ? 2
      : item.capture.nsys?.schedulerScope === "system_wide" ? 1 : 0;
    return rank(left) - rank(right) || left.capture.captureId.localeCompare(right.capture.captureId);
  });
  const requested = query.captureId
    ? options.find((option) => option.capture.captureId === query.captureId) ?? null
    : null;
  const active = requested ?? options.find((option) => option.capture.nsys?.reportMode === "graph") ?? null;
  if (!active) {
    const filters = [query.runtimeId ? `runtime ${query.runtimeId}` : null, query.hardwareId ? `hardware ${query.hardwareId}` : null]
      .filter((value): value is string => value !== null)
      .join(" / ");
    return {
      options,
      active: null,
      selectedEvent: null,
      selectedSignature: null,
      selectedObservation: null,
      separateReplay: null,
      separateReplayCapture: null,
      separateReplayRun: null,
      separateReplayDeviceLabel: null,
      replayMetrics: [],
      replayTelemetry: [],
      warpSupplement: null,
      summariesByName: new Map(),
      requestedCaptureUnavailable: query.captureId !== null,
      unavailableReason: filters
        ? `No sanitized Nsys timeline matches ${query.modelId} / ${filters}.`
        : `${query.modelId} has no sanitized Nsys timeline in this snapshot.`,
      kernelCoverage: null,
    };
  }

  const timeline = active.timeline;
  const parsed = parseEntityKey(query.entity);
  const localEventsById = new Map(timeline.events.map((event) => [`${timeline.timelineId}/${event.eventId}`, event]));
  let selectedEvent: TimelineEvent | null = null;
  let selectedObservation: KernelObservation | null = null;
  if (parsed?.kind === "timeline-event" && parsed.timelineId === timeline.timelineId) {
    selectedEvent = localEventsById.get(`${parsed.timelineId}/${parsed.eventId}`) ?? null;
  } else if (parsed?.kind === "kernel" && parsed.captureId === active.capture.captureId) {
    const observation = index.observationById.get(parsed.kernelObservationId) ?? null;
    if (observation?.captureId === active.capture.captureId) {
      selectedObservation = observation;
      selectedEvent = firstEventForSignature(timeline, observation.kernelSignatureId);
    }
  }
  const signatureId = selectedObservation?.kernelSignatureId ?? selectedEvent?.kernelSignatureId ?? null;
  const selectedSignature = signatureId ? index.signatureById.get(signatureId) ?? null : null;
  if (!selectedObservation && signatureId) {
    selectedObservation = (index.observationsBySignatureId.get(signatureId) ?? []).find((observation) =>
      observation.captureId === active.capture.captureId
      && observation.observationKind.startsWith("nsys_"),
    ) ?? null;
  }
  const replayCandidates = signatureId
    ? (index.observationsBySignatureId.get(signatureId) ?? []).flatMap((observation) => {
      if (observation.observationKind !== "ncu_replayed_launch") return [];
      const capture = index.captureById.get(observation.captureId);
      const run = runById.get(observation.runId);
      if (
        !capture
        || capture.tool !== "ncu"
        || !run
        || capture.runId !== run.run_id
        || run.model_id !== active.run.model_id
        || run.runtime_id !== active.run.runtime_id
        || run.device_id !== active.run.device_id
      ) return [];
      return [{ observation, capture, run }];
    }).sort((left, right) => left.observation.observationId.localeCompare(right.observation.observationId))
    : [];
  const schedulerWarpPair = replayCandidates.flatMap((warp) => {
    const trigger = warp.capture.ncu?.sectionMode === "warp_state_stats"
      ? warp.capture.ncu.warpTrigger
      : null;
    if (!trigger) return [];
    const scheduler = replayCandidates.find((candidate) =>
      candidate.capture.ncu?.sectionMode === "scheduler_stats_with_sysmem_sectors"
      && candidate.capture.captureId === trigger.schedulerCaptureId
      && candidate.observation.observationId === trigger.schedulerObservationId,
    );
    return scheduler ? [{ scheduler, warp }] : [];
  })[0] ?? null;
  const replayCandidate = schedulerWarpPair?.scheduler
    ?? replayCandidates.find((candidate) => candidate.capture.ncu?.sectionMode !== "warp_state_stats")
    ?? replayCandidates[0]
    ?? null;
  const warpSupplementCandidate = schedulerWarpPair?.warp ?? null;
  const separateReplay = replayCandidate?.observation ?? null;
  const separateReplayCapture = replayCandidate?.capture ?? null;
  const separateReplayRun = replayCandidate?.run ?? null;
  const separateReplayDeviceLabel = separateReplayRun
    ? data.datasets.devices.find((device) => device.device_id === separateReplayRun.device_id)?.display_name ?? separateReplayRun.device_id
    : null;

  return {
    options,
    active,
    selectedEvent,
    selectedSignature,
    selectedObservation,
    separateReplay,
    separateReplayCapture,
    separateReplayRun,
    separateReplayDeviceLabel,
    replayMetrics: separateReplay
      ? index.metricsBySubjectId.get(`kernel_observation:${separateReplay.observationId}`) ?? []
      : [],
    replayTelemetry: separateReplayCapture
      ? evidence.telemetry.filter((item) => item.captureId === separateReplayCapture.captureId)
      : [],
    warpSupplement: warpSupplementCandidate ? {
      observation: warpSupplementCandidate.observation,
      capture: warpSupplementCandidate.capture,
      run: warpSupplementCandidate.run,
      deviceLabel: data.datasets.devices.find((device) => device.device_id === warpSupplementCandidate.run.device_id)?.display_name
        ?? warpSupplementCandidate.run.device_id,
      metrics: index.metricsBySubjectId.get(`kernel_observation:${warpSupplementCandidate.observation.observationId}`) ?? [],
      telemetry: evidence.telemetry.filter((item) => item.captureId === warpSupplementCandidate.capture.captureId),
    } : null,
    summariesByName: new Map(timeline.summaries.map((summary) => [summary.metricName, summary])),
    requestedCaptureUnavailable: query.captureId !== null && requested === null,
    unavailableReason: "",
    kernelCoverage: kernelCoverage(timeline),
  };
}
