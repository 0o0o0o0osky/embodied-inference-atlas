import { expect, it } from "vitest";

import type { AtlasData, RunRecord } from "../../../types/atlas";
import { buildPi0PerformanceOverview } from "./buildPi0PerformanceOverview";

type WorkloadFixture = {
  views: number;
  prompt: number;
  chunk: number;
  denoise: number | null;
};

function run({
  runId,
  runtimeId = "flashrt",
  precisionId = "mixed-fp8-e4m3-fp16",
  evidence = "measured_local",
  hardwareId = "thor",
  inputContractId = "deterministic-observation",
  timingBoundaryId = "predict",
  taskId = "vla-action-chunk-inference",
  workload,
}: {
  runId: string;
  runtimeId?: string;
  precisionId?: string;
  evidence?: RunRecord["evidence"];
  hardwareId?: string;
  inputContractId?: string;
  timingBoundaryId?: string;
  taskId?: string;
  workload: WorkloadFixture;
}): RunRecord {
  const normalizedWorkload: RunRecord["workload"] = {
    common: {
      batch_size: 1,
      input_contract_id: inputContractId,
      output_contract_id: "action-chunk",
    },
    vla: {
      action_chunk: workload.chunk,
      action_dimension: 7,
      camera_views: workload.views,
      denoise_steps: workload.denoise,
      executed_prompt_tokens: workload.prompt,
      image_height: 224,
      image_width: 224,
      semantic_prompt_tokens: 12,
    },
  };
  const precision: RunRecord["precision"] = {
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
  };
  const timing: RunRecord["timing"] = {
    timing_boundary_id: timingBoundaryId,
    state_reuse: "cached",
    warm_policy: "steady_state",
    warmup_iterations: 3,
  };
  const operatingPoint: RunRecord["operating_point"] = {
    operating_point_id: "thor-max",
    power_mode: "max",
    clock_policy: "locked",
    throttle_status: "not_observed",
  };
  return {
    schema_version: "1.0.0",
    run_id: runId,
    configuration_id: `configuration-${runId}`,
    model_id: "pi0",
    model_artifact_id: "pi0-artifact",
    runtime_id: runtimeId,
    device_id: hardwareId,
    system_id: `${hardwareId}-system`,
    source_id: `source-${runId}`,
    evidence,
    capture_method: evidence === "analytical" ? "vla_perf" : "wall_clock",
    workload: normalizedWorkload,
    precision,
    timing,
    operating_point: operatingPoint,
    correctness: { status: "not_assessed", criterion: "not assessed" },
    comparison_context: {
      model_id: "pi0",
      model_artifact_id: "pi0-artifact",
      runtime_id: runtimeId,
      evidence,
      platform: {
        device_id: hardwareId,
        system_id: `${hardwareId}-system`,
        operating_point_id: operatingPoint.operating_point_id,
      },
      task: {
        task_id: taskId,
        input_contract_id: inputContractId,
        output_contract_id: "action-chunk",
        correctness_policy_id: "not-assessed",
      },
      workload: normalizedWorkload,
      precision,
      timing,
      runtime_overhead: "included",
    },
    missing: {},
  };
}

function measurement(run: RunRecord, value: number) {
  return {
    measurement_id: `measurement-${run.run_id}`,
    run_id: run.run_id,
    source_id: run.source_id,
    evidence: run.evidence,
    measurement_method: run.evidence === "analytical" ? "analytical" : "wall_clock",
    metric: "latency",
    statistics: [{
      statistic: run.runtime_id === "vla-cpp" ? "p50" : run.evidence === "analytical" ? "analytical_estimate" : "mean",
      value,
      unit: "ms",
    }],
    sample_count: run.evidence === "analytical" ? 0 : 20,
    percentile_method: run.runtime_id === "vla-cpp" ? "source_reported" : null,
    work_unit: "action_chunk",
    timing_boundary_id: run.timing.timing_boundary_id,
    missing_reason: null,
  };
}

it("builds exact six-cell Pi0 target grids without borrowing mismatched evidence", () => {
  const exactFlash = run({
    runId: "flash-exact",
    workload: { views: 1, prompt: 48, chunk: 20, denoise: 10 },
  });
  const wrongPrompt = run({
    runId: "flash-prompt-42",
    workload: { views: 2, prompt: 42, chunk: 20, denoise: 10 },
  });
  const wrongChunk = run({
    runId: "flash-native-chunk",
    workload: { views: 3, prompt: 48, chunk: 10, denoise: 10 },
  });
  const wrongDenoise = run({
    runId: "flash-denoise-missing",
    workload: { views: 2, prompt: 48, chunk: 50, denoise: null },
  });
  const analyticalExact = run({
    runId: "analytical-exact",
    evidence: "analytical",
    workload: { views: 2, prompt: 48, chunk: 50, denoise: 10 },
  });
  const otherHardware = run({
    runId: "a800-exact",
    hardwareId: "a800",
    workload: { views: 3, prompt: 48, chunk: 50, denoise: 10 },
  });
  const otherContract = run({
    runId: "flash-other-contract",
    inputContractId: "synthetic-observation",
    timingBoundaryId: "predict-with-preprocess",
    workload: { views: 2, prompt: 48, chunk: 50, denoise: 10 },
  });
  const otherTask = run({
    runId: "flash-other-task",
    taskId: "alternate-vla-task",
    workload: { views: 2, prompt: 48, chunk: 20, denoise: 10 },
  });
  const vlaCpp = run({
    runId: "vlacpp-exact",
    runtimeId: "vla-cpp",
    precisionId: "q8_0",
    inputContractId: "synthetic-observation",
    workload: { views: 3, prompt: 48, chunk: 50, denoise: 10 },
  });
  const runs = [
    exactFlash,
    wrongPrompt,
    wrongChunk,
    wrongDenoise,
    analyticalExact,
    otherHardware,
    otherContract,
    otherTask,
    vlaCpp,
  ];
  const data = {
    format_version: "1.0.0",
    datasets: {
      runs,
      end_to_end: runs.map((item, index) => measurement(item, 40 + index)),
      stages: [],
      models: [],
      devices: [
        { device_id: "thor", display_name: "NVIDIA Jetson AGX Thor", accelerator_architecture: "blackwell" },
        { device_id: "a800", display_name: "NVIDIA A800", accelerator_architecture: "ampere" },
      ],
      runtimes: [
        { runtime_id: "flashrt", display_name: "FlashRT", backend: "TensorRT", model_support: [] },
        { runtime_id: "vla-cpp", display_name: "vla.cpp", backend: "ggml", model_support: [] },
      ],
    },
  } as unknown as AtlasData;

  const overview = buildPi0PerformanceOverview({ data, hardwareId: "thor" });

  expect(overview.target).toEqual({
    promptTokens: 48,
    denoiseSteps: 10,
    cameraViews: [1, 2, 3],
    actionChunks: [20, 50],
  });
  expect(overview.facets).toHaveLength(4);
  expect(overview.facets.filter((facet) => facet.runtimeId === "flashrt"
    && facet.contract.inputContractId === "deterministic-observation"
    && facet.contract.timingBoundaryId === "predict")).toHaveLength(2);
  expect(overview.facets.some((facet) => facet.runtimeId === "flashrt"
    && facet.contract.inputContractId === "synthetic-observation"
    && facet.contract.timingBoundaryId === "predict-with-preprocess")).toBe(true);
  expect(overview.facets.some((facet) => facet.runtimeId === "vla-cpp"
    && facet.precisionId === "q8_0")).toBe(true);

  const primary = overview.facets.find((facet) => facet.series.some((series) => series.cells.some((cell) =>
    cell.state === "measured" && cell.selection.runId === "flash-exact")))!;
  expect(primary.observedScope).toEqual({
    promptTokens: [42, 48],
    actionChunks: [10, 20, 50],
    denoiseSteps: [10],
    hasMissingDenoise: true,
  });
  expect(primary.series.map((series) => [
    series.actionChunk,
    series.cells.map((cell) => cell.state === "measured" ? `${cell.latency.value} ${cell.latency.unit}` : "待测"),
  ])).toEqual([
    [20, ["40 ms", "待测", "待测"]],
    [50, ["待测", "待测", "待测"]],
  ]);
  const selected = primary.series[0]!.cells[0]!;
  expect(selected.state).toBe("measured");
  if (selected.state !== "measured") throw new Error("fixture must expose its exact measured point");
  expect(selected.selection).toEqual({
    facetId: primary.id,
    runtimeId: "flashrt",
    precisionId: "mixed-fp8-e4m3-fp16",
    hardwareId: "thor",
    runId: "flash-exact",
    configurationId: "configuration-flash-exact",
    workload: {
      cameraViews: 1,
      promptTokens: 48,
      actionChunk: 20,
      denoiseSteps: 10,
    },
  });
});
