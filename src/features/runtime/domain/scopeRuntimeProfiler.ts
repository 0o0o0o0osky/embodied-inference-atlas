import type { AtlasData, ComparisonContextRecord } from "../../../types/atlas";
import type { ProfilerEvidence } from "../../profiler/domain/types";

export interface RuntimeSystemSlice {
  cameraViews: number | null;
  promptTokens: number | null;
  semanticPromptTokens: number | null;
  actionChunk: number | null;
  denoiseSteps: number | null;
  anchorRunId: string | null;
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

function combineMatches(matches: readonly ContextMatch[]): ContextMatch {
  return {
    matches: matches.every((match) => match.matches),
    partial: matches.some((match) => match.partial),
  };
}

function exactField(candidate: unknown, expected: unknown): ContextMatch {
  return { matches: Object.is(candidate, expected), partial: false };
}

function knownField(candidate: unknown, expected: unknown): ContextMatch {
  if (candidate === null || expected === null) return { matches: true, partial: true };
  return exactField(candidate, expected);
}

function operatingPointField(candidate: string, expected: string): ContextMatch {
  if (candidate === "unknown" || expected === "unknown") return { matches: true, partial: true };
  return exactField(candidate, expected);
}

function profilerCompatibility(
  run: AtlasData["datasets"]["runs"][number],
  expected: ComparisonContextRecord,
  slice: RuntimeSystemSlice,
): ContextMatch {
  const candidateVla = run.workload.vla;
  const expectedVla = expected.workload.vla;
  if (!candidateVla || !expectedVla) return { matches: false, partial: false };
  return combineMatches([
    exactField(run.model_id, expected.model_id),
    exactField(run.model_artifact_id, expected.model_artifact_id),
    exactField(run.runtime_id, expected.runtime_id),
    exactField(run.device_id, expected.platform.device_id),
    knownField(run.system_id, expected.platform.system_id),
    exactField(run.precision.precision_id, expected.precision.precision_id),
    exactField(run.comparison_context.task.task_id, expected.task.task_id),
    exactField(run.workload.common.input_contract_id, expected.task.input_contract_id),
    exactField(run.workload.common.output_contract_id, expected.task.output_contract_id),
    exactField(run.timing.timing_boundary_id, expected.timing.timing_boundary_id),
    exactField(run.timing.state_reuse, expected.timing.state_reuse),
    exactField(run.workload.common.batch_size, expected.workload.common.batch_size),
    knownField(candidateVla.camera_views, slice.cameraViews),
    knownField(candidateVla.executed_prompt_tokens, slice.promptTokens),
    knownField(candidateVla.action_chunk, slice.actionChunk),
    knownField(candidateVla.denoise_steps, slice.denoiseSteps),
    knownField(candidateVla.action_dimension, expectedVla.action_dimension),
    knownField(candidateVla.image_height, expectedVla.image_height),
    knownField(candidateVla.image_width, expectedVla.image_width),
    knownField(candidateVla.semantic_prompt_tokens, slice.semanticPromptTokens),
    operatingPointField(run.operating_point.operating_point_id, expected.platform.operating_point_id),
  ]);
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
    cameraViews: configuration ? vla?.camera_views ?? null : 2,
    promptTokens: configuration ? vla?.executed_prompt_tokens ?? null : 48,
    semanticPromptTokens: configuration ? vla?.semantic_prompt_tokens ?? null : null,
    actionChunk: configuration ? vla?.action_chunk ?? null : 50,
    denoiseSteps: configuration ? vla?.denoise_steps ?? null : 10,
    anchorRunId: configuration?.run_id ?? null,
    facetContext: configuration?.comparison_context ?? facetContext,
  };
  if (!configuration) {
    for (const part of (workload ?? "").split(",")) {
      const [name, encoded] = part.split("=", 2);
      const value = Number(encoded);
      if (!Number.isSafeInteger(value)) continue;
      if ((name?.trim() === "v" || name?.trim() === "V") && value >= 1) slice.cameraViews = value;
      if ((name?.trim() === "p" || name?.trim() === "L_PROMPT") && value >= 0) slice.promptTokens = value;
      if ((name?.trim() === "a" || name?.trim() === "T_ACTION") && value >= 1) slice.actionChunk = value;
      if ((name?.trim() === "n" || name?.trim() === "N_DENOISE") && value >= 1) slice.denoiseSteps = value;
    }
  }
  return slice;
}

/** Exact execution scope; unknown capture workload fields allow partial matching. */
export function scopeRuntimeProfiler(data: AtlasData, profiler: ProfilerEvidence, query: RuntimeProfilerScope) {
  const precisions = [...new Set(data.datasets.runs.filter((run) =>
    run.model_id === query.modelId && run.runtime_id === query.runtimeId && run.device_id === query.hardwareId
    && run.evidence === "measured_local").map((run) => run.precision.precision_id))];
  const actualPrecision = query.precisionId ?? (precisions.length === 1 ? precisions[0]! : null);
  const expectedFacetContext = query.slice.facetContext;
  // Missing selections are empty, never wildcard filters in the shared builders.
  const contextMatches = new Map<string, ContextMatch>();
  const runs = data.datasets.runs.filter((run) => {
    const vla = run.workload.vla;
    if (!query.runtimeId || !query.hardwareId || !actualPrecision
      || run.model_id !== query.modelId || run.runtime_id !== query.runtimeId || run.device_id !== query.hardwareId
      || run.precision.precision_id !== actualPrecision || !vla
      || !knownField(vla.camera_views, query.slice.cameraViews).matches
      || !knownField(vla.executed_prompt_tokens, query.slice.promptTokens).matches
      || !knownField(vla.action_chunk, query.slice.actionChunk).matches
      || !knownField(vla.denoise_steps, query.slice.denoiseSteps).matches) return false;
    if (expectedFacetContext === null) return false;
    const match = profilerCompatibility(run, expectedFacetContext, query.slice);
    if (match.matches) contextMatches.set(run.run_id, match);
    return match.matches;
  });
  const runIds = new Set(runs.map((run) => run.run_id));
  const partialContextRunIds = new Set(runs.filter((run) => {
    const vla = run.workload.vla!;
    return query.slice.anchorRunId !== null && run.run_id !== query.slice.anchorRunId
      || contextMatches.get(run.run_id)?.partial || vla.camera_views === null || vla.executed_prompt_tokens === null
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
