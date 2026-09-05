import type { AtlasData, ComparisonContextRecord } from "../../../types/atlas";
import type { ProfilerEvidence } from "../../profiler/domain/types";
import { pi0PerformanceFacetContext } from "./buildPi0PerformanceOverview";

export interface RuntimeSystemSlice {
  cameraViews: number;
  promptTokens: number;
  actionChunk: number;
  denoiseSteps: number;
  facetContext: ComparisonContextRecord | null;
}

interface RuntimeProfilerScope {
  modelId: string;
  runtimeId: string | null;
  hardwareId: string | null;
  precisionId: string | null;
  slice: RuntimeSystemSlice;
}

interface ContextMatch {
  matches: boolean;
  partial: boolean;
}

function matchKnownContext(candidate: unknown, expected: unknown): ContextMatch {
  if (candidate === null) return { matches: true, partial: expected !== null };
  if (Array.isArray(candidate) || Array.isArray(expected)) {
    if (!Array.isArray(candidate) || !Array.isArray(expected) || candidate.length !== expected.length) {
      return { matches: false, partial: false };
    }
    return candidate.reduce<ContextMatch>((result, item, index) => {
      if (!result.matches) return result;
      const nested = matchKnownContext(item, expected[index]);
      return { matches: nested.matches, partial: result.partial || nested.partial };
    }, { matches: true, partial: false });
  }
  if (typeof candidate === "object" || typeof expected === "object") {
    if (typeof candidate !== "object" || typeof expected !== "object" || expected === null) {
      return { matches: false, partial: false };
    }
    const candidateRecord = candidate as Record<string, unknown>;
    return Object.entries(expected as Record<string, unknown>).reduce<ContextMatch>((result, [key, item]) => {
      if (!result.matches || !(key in candidateRecord)) return { matches: false, partial: result.partial };
      const nested = matchKnownContext(candidateRecord[key], item);
      return { matches: nested.matches, partial: result.partial || nested.partial };
    }, { matches: true, partial: false });
  }
  return { matches: Object.is(candidate, expected), partial: false };
}

export function selectRuntimeProfilerCaptures(profiler: ProfilerEvidence, requestedCaptureId: string | null) {
  const timelineCaptureIds = new Set(profiler.timelines.map((timeline) => timeline.captureId));
  const captures = profiler.captures.filter((capture) =>
    capture.tool === "nsys" && timelineCaptureIds.has(capture.captureId));
  const requested = captures.find((capture) => capture.captureId === requestedCaptureId) ?? null;
  const node = captures.find((capture) => capture.nsys?.reportMode === "node") ?? null;
  const timeline = requested ?? node;
  return {
    timelineCaptureId: timeline?.captureId ?? null,
    kernelCaptureId: timeline?.nsys?.reportMode === "node" ? timeline.captureId : null,
    requestedCaptureUnavailable: requestedCaptureId !== null && requested === null,
    suppressTimelineFallback: timeline === null,
  };
}

export function runtimeProfilerSlice(
  data: AtlasData,
  workload: string | null,
  facetContext: ComparisonContextRecord | null = null,
): RuntimeSystemSlice {
  const configuration = data.datasets.runs.find((run) => run.configuration_id === workload);
  const vla = configuration?.workload.vla;
  const slice: RuntimeSystemSlice = {
    cameraViews: vla?.camera_views ?? 2,
    promptTokens: vla?.executed_prompt_tokens ?? 48,
    actionChunk: vla?.action_chunk ?? 50,
    denoiseSteps: vla?.denoise_steps ?? 10,
    facetContext: configuration?.comparison_context ?? facetContext,
  };
  for (const part of (workload ?? "").split(",")) {
    const [name, encoded] = part.split("=", 2);
    const value = Number(encoded);
    if (!Number.isSafeInteger(value)) continue;
    if ((name?.trim() === "v" || name?.trim() === "V") && value >= 1) slice.cameraViews = value;
    if ((name?.trim() === "p" || name?.trim() === "L_PROMPT") && value >= 0) slice.promptTokens = value;
    if ((name?.trim() === "a" || name?.trim() === "T_ACTION") && value >= 1) slice.actionChunk = value;
    if ((name?.trim() === "n" || name?.trim() === "N_DENOISE") && value >= 1) slice.denoiseSteps = value;
  }
  return slice;
}

/** Exact execution scope; unknown capture workload fields allow partial matching. */
export function scopeRuntimeProfiler(data: AtlasData, profiler: ProfilerEvidence, query: RuntimeProfilerScope) {
  const precisions = [...new Set(data.datasets.runs.filter((run) =>
    run.model_id === query.modelId && run.runtime_id === query.runtimeId && run.device_id === query.hardwareId
    && run.evidence === "measured_local").map((run) => run.precision.precision_id))];
  const actualPrecision = query.precisionId ?? (precisions.length === 1 ? precisions[0]! : null);
  const expectedFacetContext = query.slice.facetContext
    ? pi0PerformanceFacetContext(query.slice.facetContext)
    : null;
  // Missing selections are empty, never wildcard filters in the shared builders.
  const contextMatches = new Map<string, ContextMatch>();
  const runs = data.datasets.runs.filter((run) => {
    const vla = run.workload.vla;
    if (!query.runtimeId || !query.hardwareId || !actualPrecision
      || run.model_id !== query.modelId || run.runtime_id !== query.runtimeId || run.device_id !== query.hardwareId
      || run.precision.precision_id !== actualPrecision || !vla
      || vla.camera_views !== null && vla.camera_views !== query.slice.cameraViews
      || vla.executed_prompt_tokens !== null && vla.executed_prompt_tokens !== query.slice.promptTokens
      || vla.action_chunk !== null && vla.action_chunk !== query.slice.actionChunk
      || vla.denoise_steps !== null && vla.denoise_steps !== query.slice.denoiseSteps) return false;
    if (expectedFacetContext === null) return false;
    const match = matchKnownContext(pi0PerformanceFacetContext(run.comparison_context), expectedFacetContext);
    if (match.matches) contextMatches.set(run.run_id, match);
    return match.matches;
  });
  const runIds = new Set(runs.map((run) => run.run_id));
  const partialContextRunIds = new Set(runs.filter((run) => {
    const vla = run.workload.vla!;
    return contextMatches.get(run.run_id)?.partial || vla.camera_views === null || vla.executed_prompt_tokens === null
      || vla.action_chunk === null || vla.denoise_steps === null;
  }).map((run) => run.run_id));
  const captures = profiler.captures.filter((capture) => runIds.has(capture.runId));
  const captureIds = new Set(captures.map((capture) => capture.captureId));
  return {
    actualPrecision,
    partialContextRunIds,
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
