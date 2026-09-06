import { expect, it } from "vitest";

import type { AtlasData, RunRecord } from "../../../types/atlas";
import type { ProfilerCapture, ProfilerEvidence, TimelineRecord } from "../../profiler/domain/types";
import { runtimeProfilerSlice, scopeRuntimeProfiler, selectRuntimeProfilerCaptures } from "./scopeRuntimeProfiler";

const PRECISION_ID = "mixed-fp8-e4m3-fp16";

function run({
  id,
  configurationId = `configuration-${id}`,
  prompt = 48,
  action = 50,
  denoise = 10,
  inputContract = "deterministic-observation",
  outputContract = "action-chunk",
  timingBoundary = "predict",
  stateReuse = "cached-prompt",
  warmupIterations = 3,
  captureMethod = "nsys",
  operatingPointId = "thor-max",
}: {
  id: string;
  configurationId?: string;
  prompt?: number | null;
  action?: number | null;
  denoise?: number | null;
  inputContract?: string;
  outputContract?: string;
  timingBoundary?: string;
  stateReuse?: string;
  warmupIterations?: number | null;
  captureMethod?: RunRecord["capture_method"];
  operatingPointId?: string;
}): RunRecord {
  const workload: RunRecord["workload"] = {
    common: { batch_size: 1, input_contract_id: inputContract, output_contract_id: outputContract },
    vla: {
      action_chunk: action,
      action_dimension: 7,
      camera_views: 2,
      denoise_steps: denoise,
      executed_prompt_tokens: prompt,
      image_height: 224,
      image_width: 224,
      semantic_prompt_tokens: prompt,
    },
  };
  const precision: RunRecord["precision"] = {
    precision_id: PRECISION_ID,
    requested: "fp8",
    weight_dtype: "fp8_e4m3",
    activation_dtype: "mixed_fp8_fp16",
    accumulation_dtype: "fp32",
    execution_dtype: "mixed_fp8_fp16",
    quant_scheme: "selective_fp8",
    granularity: "operator_path",
    scale_zero_point_bytes: null,
    dequant_strategy: "fused",
    fused: true,
  };
  const timing: RunRecord["timing"] = {
    timing_boundary_id: timingBoundary,
    state_reuse: stateReuse,
    warm_policy: "steady_state",
    warmup_iterations: warmupIterations,
  };
  return {
    schema_version: "1.0.0",
    run_id: id,
    configuration_id: configurationId,
    model_id: "pi0",
    model_artifact_id: "pi0-artifact",
    runtime_id: "flashrt",
    device_id: "thor",
    system_id: "thor-system",
    source_id: `source-${id}`,
    evidence: "measured_local",
    capture_method: captureMethod,
    workload,
    precision,
    timing,
    operating_point: {
      operating_point_id: operatingPointId,
      power_mode: operatingPointId === "unknown" ? null : "max",
      clock_policy: operatingPointId === "unknown" ? null : "locked",
      throttle_status: "not_observed",
    },
    correctness: { status: "not_assessed", criterion: "not assessed" },
    comparison_context: {
      model_id: "pi0",
      model_artifact_id: "pi0-artifact",
      runtime_id: "flashrt",
      evidence: "measured_local",
      platform: { device_id: "thor", system_id: "thor-system", operating_point_id: operatingPointId },
      task: {
        task_id: "vla-action-chunk-inference",
        input_contract_id: inputContract,
        output_contract_id: outputContract,
        correctness_policy_id: "finite-only",
      },
      workload,
      precision,
      timing,
      runtime_overhead: "included",
    },
    missing: {},
  };
}

function capture(record: RunRecord, mode: "graph" | "node" = "node"): ProfilerCapture {
  return {
    captureId: `capture-${record.run_id}`,
    runId: record.run_id,
    sourceId: record.source_id,
    evidence: "measured_local",
    tool: "nsys",
    toolVersion: "2026.1",
    collectionScope: "prediction_window",
    targetWindowLabel: "predict",
    targetWindowCount: 1,
    selectionPolicy: "single_predict_window",
    coverage: { population: "one_profiled_prediction", observedCount: 1, isCompleteForPopulation: true },
    warnings: [],
    nsys: {
      reportMode: mode,
      schedulerScope: "process_tree",
      logicalCpuCount: 8,
      cudaGraphTracePresent: true,
      graphNodeTracePresent: mode === "node",
      schedulerTracePresent: true,
      profilerOverheadTracePresent: false,
    },
    ncu: null,
    missing: {},
  };
}

function timeline(item: ProfilerCapture): TimelineRecord {
  return {
    timelineId: `timeline-${item.captureId}`,
    captureId: item.captureId,
    runId: item.runId,
    sourceId: item.sourceId,
    window: { label: "predict", startNs: 0, durationNs: 1_000 },
    timeBasis: "relative_to_target_window_start",
    lanes: [],
    events: [],
    summaries: [],
    missing: {},
  };
}

function atlas(runs: readonly RunRecord[]): AtlasData {
  return { format_version: "1.0.0", datasets: { runs } } as unknown as AtlasData;
}

function evidence(runs: readonly RunRecord[]): ProfilerEvidence {
  const captures = runs.map((item) => capture(item));
  return {
    captures,
    timelines: captures.map(timeline),
    signatures: [],
    observations: [],
    metrics: [],
    links: [],
    telemetry: [],
  };
}

it("rejects known action and denoise mismatches while retaining null workload fields as partial context", () => {
  const partial = run({ id: "partial", prompt: null, denoise: null });
  const wrongAction = run({ id: "wrong-action", action: 10, prompt: null, denoise: null });
  const wrongDenoise = run({ id: "wrong-denoise", denoise: 8 });
  const data = atlas([partial, wrongAction, wrongDenoise]);
  const slice = runtimeProfilerSlice(data, "v=2,p=48,a=50,n=10", wrongAction.comparison_context);

  const scoped = scopeRuntimeProfiler(data, evidence(data.datasets.runs), {
    modelId: "pi0",
    runtimeId: "flashrt",
    hardwareId: "thor",
    precisionId: PRECISION_ID,
    slice,
  });

  expect(slice).toMatchObject({ cameraViews: 2, promptTokens: 48, actionChunk: 50, denoiseSteps: 10 });
  expect(slice.anchorRunId).toBeNull();
  expect(scoped.evidence.captures.map((item) => item.runId)).toEqual(["partial"]);
  expect([...scoped.partialContextRunIds]).toEqual(["partial"]);
});

it("fails closed when a symbolic target has no resolved facet context", () => {
  const candidate = run({ id: "candidate", prompt: null, denoise: null });
  const data = atlas([candidate]);
  const scoped = scopeRuntimeProfiler(data, evidence([candidate]), {
    modelId: "pi0",
    runtimeId: "flashrt",
    hardwareId: "thor",
    precisionId: PRECISION_ID,
    slice: runtimeProfilerSlice(data, "v=2,p=48,a=50,n=10"),
  });

  expect(scoped.evidence.captures).toEqual([]);
  expect([...scoped.partialContextRunIds]).toEqual([]);
});

it("uses an exact configuration's contracts and timing facet when one is available", () => {
  const selected = run({ id: "selected", configurationId: "cfg-selected" });
  const partial = run({ id: "partial", prompt: null, denoise: null });
  const wrongInput = run({ id: "wrong-input", prompt: null, denoise: null, inputContract: "other-input" });
  const wrongOutput = run({ id: "wrong-output", prompt: null, denoise: null, outputContract: "other-output" });
  const wrongBoundary = run({ id: "wrong-boundary", prompt: null, denoise: null, timingBoundary: "kernel-replay" });
  const wrongReuse = run({ id: "wrong-reuse", prompt: null, denoise: null, stateReuse: "no-cache" });
  const candidates = [partial, wrongInput, wrongOutput, wrongBoundary, wrongReuse];
  const data = atlas([selected, ...candidates]);
  const slice = runtimeProfilerSlice(data, selected.configuration_id);

  const scoped = scopeRuntimeProfiler(data, evidence(candidates), {
    modelId: "pi0",
    runtimeId: "flashrt",
    hardwareId: "thor",
    precisionId: PRECISION_ID,
    slice,
  });

  expect(slice.facetContext).toMatchObject({
    task: {
      input_contract_id: "deterministic-observation",
      output_contract_id: "action-chunk",
    },
    timing: {
      timing_boundary_id: "predict",
      state_reuse: "cached-prompt",
    },
  });
  expect(slice.anchorRunId).toBe("selected");
  expect(scoped.evidence.captures.map((item) => item.runId)).toEqual(["partial"]);
});

it("marks a compatible independent run partial while the anchor run remains exact", () => {
  const anchor = run({ id: "anchor", configurationId: "cfg-anchor", captureMethod: "wall_clock" });
  const independent = run({ id: "independent" });
  const data = atlas([anchor, independent]);
  const slice = runtimeProfilerSlice(data, anchor.configuration_id);

  const scoped = scopeRuntimeProfiler(data, evidence([anchor, independent]), {
    modelId: "pi0",
    runtimeId: "flashrt",
    hardwareId: "thor",
    precisionId: PRECISION_ID,
    slice,
  });

  expect(scoped.evidence.captures.map((item) => item.runId)).toEqual(["anchor", "independent"]);
  expect([...scoped.partialContextRunIds]).toEqual(["independent"]);
});

it("retains an independently warmed capture with unknown workload context as partial", () => {
  const wallClock = run({
    id: "wall-clock",
    configurationId: "cfg-wall-clock",
    captureMethod: "wall_clock",
    warmupIterations: 3,
  });
  const independentProfiler = run({
    id: "independent-profiler",
    prompt: null,
    warmupIterations: 0,
    operatingPointId: "unknown",
  });
  const wrongAction = run({
    id: "independent-wrong-action",
    prompt: null,
    action: 20,
    warmupIterations: 0,
    operatingPointId: "unknown",
  });
  const candidates = [independentProfiler, wrongAction];
  const data = atlas([wallClock, ...candidates]);

  const scoped = scopeRuntimeProfiler(data, evidence(candidates), {
    modelId: "pi0",
    runtimeId: "flashrt",
    hardwareId: "thor",
    precisionId: PRECISION_ID,
    slice: runtimeProfilerSlice(data, wallClock.configuration_id),
  });

  expect(scoped.evidence.captures.map((item) => item.runId)).toEqual(["independent-profiler"]);
  expect([...scoped.partialContextRunIds]).toEqual(["independent-profiler"]);
});

it("keeps the default timeline and Kernel summary on the same node capture", () => {
  const graph = capture(run({ id: "graph" }), "graph");
  const node = capture(run({ id: "node" }), "node");
  const profiler: ProfilerEvidence = {
    captures: [graph, node],
    timelines: [timeline(graph), timeline(node)],
    signatures: [],
    observations: [],
    metrics: [],
    links: [],
    telemetry: [],
  };

  expect(selectRuntimeProfilerCaptures(profiler, null)).toEqual({
    timelineCaptureId: node.captureId,
    kernelCaptureId: node.captureId,
    requestedCaptureUnavailable: false,
    suppressTimelineFallback: false,
  });
  expect(selectRuntimeProfilerCaptures(profiler, graph.captureId)).toEqual({
    timelineCaptureId: graph.captureId,
    kernelCaptureId: null,
    requestedCaptureUnavailable: false,
    suppressTimelineFallback: false,
  });
});

it("keeps node evidence missing instead of falling back to an available graph capture", () => {
  const graph = capture(run({ id: "graph-only" }), "graph");
  const profiler: ProfilerEvidence = {
    captures: [graph],
    timelines: [timeline(graph)],
    signatures: [],
    observations: [],
    metrics: [],
    links: [],
    telemetry: [],
  };

  expect(selectRuntimeProfilerCaptures(profiler, null)).toEqual({
    timelineCaptureId: null,
    kernelCaptureId: null,
    requestedCaptureUnavailable: false,
    suppressTimelineFallback: true,
  });
});
