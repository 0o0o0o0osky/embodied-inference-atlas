import { expect, it } from "vitest";

import type { AtlasData, RunRecord } from "../../../types/atlas";
import type { ProfilerEvidence } from "../../profiler/domain/types";
import type { RuntimeStackSummary } from "./resolveRuntimeRealization";
import { buildRuntimeSystemSummary } from "./buildRuntimeSystemSummary";

function run(
  runId: string,
  runtimeId: string,
  precisionId: string,
  evidence: RunRecord["evidence"],
  cameraViews: number,
  promptTokens: number,
  actionShape: readonly [number, number],
  inputContractId: string,
  stateReuse: string,
  timingBoundaryId: string,
  operatingPointId: string,
): RunRecord {
  return {
    schema_version: "1.0.0",
    run_id: runId,
    configuration_id: `configuration-${runId}`,
    model_id: "pi0",
    model_artifact_id: "pi0-artifact",
    runtime_id: runtimeId,
    device_id: "thor",
    system_id: "thor-system",
    source_id: "source-local",
    evidence,
    capture_method: "wall_clock",
    workload: {
      common: { batch_size: 1, input_contract_id: inputContractId, output_contract_id: "action-chunk" },
      vla: {
        action_chunk: actionShape[0],
        action_dimension: actionShape[1],
        camera_views: cameraViews,
        denoise_steps: 10,
        executed_prompt_tokens: promptTokens,
        image_height: 224,
        image_width: 224,
        semantic_prompt_tokens: promptTokens,
      },
    },
    precision: {
      precision_id: precisionId,
      requested: precisionId,
      weight_dtype: "fp16",
      activation_dtype: "fp16",
      accumulation_dtype: "fp32",
      execution_dtype: "fp16",
      quant_scheme: "none",
      granularity: "none",
      scale_zero_point_bytes: null,
      dequant_strategy: "none",
      fused: false,
    },
    timing: { timing_boundary_id: timingBoundaryId, state_reuse: stateReuse, warm_policy: "warm", warmup_iterations: 3 },
    operating_point: { operating_point_id: operatingPointId, power_mode: null, clock_policy: null, throttle_status: null },
    correctness: { status: "not_assessed", criterion: "not assessed" },
    comparison_context: {} as RunRecord["comparison_context"],
    missing: {},
  };
}

function measurement(runId: string, evidence: RunRecord["evidence"], statistics: readonly Record<string, unknown>[]) {
  return {
    measurement_id: `measurement-${runId}`,
    run_id: runId,
    source_id: "source-local",
    evidence,
    measurement_method: "wall_clock",
    metric: "latency",
    statistics,
    sample_count: 100,
    percentile_method: "source_reported",
    work_unit: "action_chunk",
    timing_boundary_id: "predict",
    missing_reason: null,
  };
}

it("keeps the selected measured slice in isolated contracts and profiler scopes", () => {
  const flashrt = run("flashrt-e2e", "flashrt", "mixed-fp8", "measured_local", 2, 22, [50, 32], "images-and-prompt", "cached", "predict", "thor-120w");
  const vlaCpp = run("vla-cpp-e2e", "vla-cpp", "q8_0", "measured_local", 2, 22, [10, 32], "images-and-prompt", "cold", "predict", "thor-120w");
  const analytical = run("vla-perf-e2e", "vla-perf", "fp16", "analytical", 2, 22, [50, 32], "images-and-prompt", "cached", "predict", "thor-120w");
  const flashrtProfiler = run("flashrt-profile", "flashrt", "mixed-fp8", "measured_local", 2, 22, [50, 32], "images-and-prompt", "cached", "predict", "thor-120w");
  const data = {
    format_version: "1.0.0",
    datasets: {
      runs: [flashrt, vlaCpp, analytical, flashrtProfiler],
      end_to_end: [
        measurement("flashrt-e2e", "measured_local", [
          { statistic: "mean", value: 40, unit: "ms" },
          { statistic: "p95", value: 45, unit: "ms" },
        ]),
        measurement("vla-cpp-e2e", "measured_local", [
          { statistic: "p50", value: 60, unit: "ms" },
          { statistic: "p95", value: null, unit: "ms" },
        ]),
        measurement("vla-perf-e2e", "analytical", [
          { statistic: "analytical_estimate", value: 30, unit: "ms" },
        ]),
      ],
      models: [],
      devices: [{ device_id: "thor", display_name: "Thor", accelerator_architecture: "blackwell" }],
      stages: [],
      runtimes: [
        { runtime_id: "flashrt", display_name: "FlashRT", backend: "TensorRT", model_support: [] },
        { runtime_id: "vla-cpp", display_name: "vla.cpp", backend: "ggml", model_support: [] },
        { runtime_id: "vla-perf", display_name: "VLA-Perf", backend: "analysis", model_support: [] },
      ],
    },
  } as unknown as AtlasData;
  const profiler = {
    captures: [{
      captureId: "capture-flashrt",
      runId: "flashrt-profile",
      sourceId: "source-local",
      evidence: "measured_local",
      tool: "nsys",
      toolVersion: "fixture",
      collectionScope: "prediction_window",
      targetWindowLabel: "predict",
      targetWindowCount: 1,
      selectionPolicy: "explicit_invocation",
      coverage: { population: "one_profiled_prediction", observedCount: 1, isCompleteForPopulation: true },
      warnings: [],
      nsys: null,
      ncu: null,
      missing: {},
    }],
    timelines: [], signatures: [], observations: [], metrics: [], links: [], telemetry: [],
  } satisfies ProfilerEvidence;
  const summaries: readonly RuntimeStackSummary[] = [
    { runtimeId: "flashrt", displayName: "FlashRT", backend: "TensorRT", state: "有实测配置", actualPrecisions: [{ id: "mixed-fp8", label: "Mixed FP8" }], mappingLevels: [], variantCount: 1, candidates: [] },
    { runtimeId: "vla-cpp", displayName: "vla.cpp", backend: "ggml", state: "有实测配置", actualPrecisions: [{ id: "q8_0", label: "Q8_0" }], mappingLevels: [], variantCount: 1, candidates: [] },
    { runtimeId: "blocked", displayName: "Blocked", backend: "none", state: "未实测·受阻", actualPrecisions: [], mappingLevels: [], variantCount: 0, candidates: [] },
  ];

  const model = buildRuntimeSystemSummary({
    data,
    profiler,
    summaries,
    modelId: "pi0",
    hardwareId: "thor",
    slice: { cameraViews: 2, promptTokens: 22 },
  });

  expect(model.sliceOptions).toEqual({ cameraViews: [2], promptTokens: [22] });
  expect(model.contractGroups).toHaveLength(2);
  expect(model.contractGroups.map((group) => group.rows.map((row) => ({
    runtimeId: row.runtimeId,
    precisionId: row.precisionId,
    latency: row.latency,
    p95: row.p95,
    profiler: row.profiler,
  })))).toEqual([
    [{
      runtimeId: "flashrt",
      precisionId: "mixed-fp8",
      latency: { statistic: "mean", value: 40, unit: "ms" },
      p95: { statistic: "p95", value: 45, unit: "ms" },
      profiler: { state: "available", captureCount: 1 },
    }],
    [{
      runtimeId: "vla-cpp",
      precisionId: "q8_0",
      latency: { statistic: "p50", value: 60, unit: "ms" },
      p95: { statistic: "p95", value: null, unit: "ms" },
      profiler: { state: "missing", captureCount: 0 },
    }],
  ]);
  expect(model.unavailable).toEqual([{ runtimeId: "blocked", displayName: "Blocked", state: "未实测·受阻" }]);
});
