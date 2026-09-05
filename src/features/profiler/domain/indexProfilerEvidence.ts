import type {
  KernelObservation,
  KernelSignature,
  OperatorKernelLink,
  ProfilerCapture,
  ProfilerEvidence,
  ProfilerMetric,
  TelemetryRecord,
  TimelineRecord,
} from "./types";

export interface ProfilerEvidenceIndex {
  captureById: ReadonlyMap<string, ProfilerCapture>;
  timelineById: ReadonlyMap<string, TimelineRecord>;
  timelinesByCaptureId: ReadonlyMap<string, readonly TimelineRecord[]>;
  signatureById: ReadonlyMap<string, KernelSignature>;
  observationById: ReadonlyMap<string, KernelObservation>;
  observationsByCaptureId: ReadonlyMap<string, readonly KernelObservation[]>;
  observationsBySignatureId: ReadonlyMap<string, readonly KernelObservation[]>;
  metricsBySubjectId: ReadonlyMap<string, readonly ProfilerMetric[]>;
  linksByObservationId: ReadonlyMap<string, readonly OperatorKernelLink[]>;
  telemetryByCaptureId: ReadonlyMap<string, readonly TelemetryRecord[]>;
}

function append<T>(target: Map<string, T[]>, key: string, value: T) {
  const values = target.get(key) ?? [];
  values.push(value);
  target.set(key, values);
}

export function indexProfilerEvidence(evidence: ProfilerEvidence): ProfilerEvidenceIndex {
  const timelinesByCaptureId = new Map<string, TimelineRecord[]>();
  const observationsByCaptureId = new Map<string, KernelObservation[]>();
  const observationsBySignatureId = new Map<string, KernelObservation[]>();
  const metricsBySubjectId = new Map<string, ProfilerMetric[]>();
  const linksByObservationId = new Map<string, OperatorKernelLink[]>();
  const telemetryByCaptureId = new Map<string, TelemetryRecord[]>();

  evidence.timelines.forEach((timeline) => append(timelinesByCaptureId, timeline.captureId, timeline));
  evidence.observations.forEach((observation) => {
    append(observationsByCaptureId, observation.captureId, observation);
    append(observationsBySignatureId, observation.kernelSignatureId, observation);
  });
  evidence.metrics.forEach((metric) => append(metricsBySubjectId, `${metric.subject.kind}:${metric.subject.id}`, metric));
  evidence.links.forEach((link) => append(linksByObservationId, link.observationId, link));
  evidence.telemetry.forEach((item) => append(telemetryByCaptureId, item.captureId, item));

  return {
    captureById: new Map(evidence.captures.map((capture) => [capture.captureId, capture])),
    timelineById: new Map(evidence.timelines.map((timeline) => [timeline.timelineId, timeline])),
    timelinesByCaptureId,
    signatureById: new Map(evidence.signatures.map((signature) => [signature.kernelSignatureId, signature])),
    observationById: new Map(evidence.observations.map((observation) => [observation.observationId, observation])),
    observationsByCaptureId,
    observationsBySignatureId,
    metricsBySubjectId,
    linksByObservationId,
    telemetryByCaptureId,
  };
}
