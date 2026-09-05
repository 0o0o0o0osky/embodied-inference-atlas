import type { AtlasData } from "../../../types/atlas";
import type { ProfilerEvidence } from "../../profiler/domain/types";
import type { RuntimeSystemSlice } from "./buildRuntimeSystemSummary";

interface RuntimeProfilerScope {
  modelId: string;
  runtimeId: string | null;
  hardwareId: string | null;
  precisionId: string | null;
  slice: RuntimeSystemSlice;
}

export function runtimeProfilerSlice(data: AtlasData, workload: string | null): RuntimeSystemSlice {
  const configuration = data.datasets.runs.find((run) => run.configuration_id === workload);
  const vla = configuration?.workload.vla;
  const slice = { cameraViews: vla?.camera_views ?? 2, promptTokens: vla?.executed_prompt_tokens ?? 22 };
  for (const part of (workload ?? "").split(",")) {
    const [name, encoded] = part.split("=", 2);
    const value = Number(encoded);
    if (!Number.isSafeInteger(value)) continue;
    if ((name?.trim() === "v" || name?.trim() === "V") && value >= 1) slice.cameraViews = value;
    if ((name?.trim() === "p" || name?.trim() === "L_PROMPT") && value >= 0) slice.promptTokens = value;
  }
  return slice;
}

/** Exact execution scope; unknown capture workload fields allow partial matching. */
export function scopeRuntimeProfiler(data: AtlasData, profiler: ProfilerEvidence, query: RuntimeProfilerScope) {
  const precisions = [...new Set(data.datasets.runs.filter((run) =>
    run.model_id === query.modelId && run.runtime_id === query.runtimeId && run.device_id === query.hardwareId
    && run.evidence === "measured_local").map((run) => run.precision.precision_id))];
  const actualPrecision = query.precisionId ?? (precisions.length === 1 ? precisions[0]! : null);
  // Missing selections are empty, never wildcard filters in the shared builders.
  const runs = data.datasets.runs.filter((run) => Boolean(query.runtimeId && query.hardwareId && actualPrecision)
    && run.model_id === query.modelId && run.runtime_id === query.runtimeId && run.device_id === query.hardwareId
    && run.precision.precision_id === actualPrecision
    && (run.workload.vla?.camera_views == null || run.workload.vla.camera_views === query.slice.cameraViews)
    && (run.workload.vla?.executed_prompt_tokens == null || run.workload.vla.executed_prompt_tokens === query.slice.promptTokens));
  const runIds = new Set(runs.map((run) => run.run_id));
  const captures = profiler.captures.filter((capture) => runIds.has(capture.runId));
  const captureIds = new Set(captures.map((capture) => capture.captureId));
  return {
    actualPrecision,
    data: { ...data, datasets: { ...data.datasets, runs } },
    evidence: { ...profiler, captures,
      timelines: profiler.timelines.filter((timeline) => captureIds.has(timeline.captureId)),
      observations: profiler.observations.filter((item) => runIds.has(item.runId) && captureIds.has(item.captureId)),
      metrics: profiler.metrics.filter((item) => runIds.has(item.runId)),
      links: profiler.links.filter((item) => runIds.has(item.runId)),
      telemetry: profiler.telemetry.filter((item) => captureIds.has(item.captureId)),
    },
  };
}
