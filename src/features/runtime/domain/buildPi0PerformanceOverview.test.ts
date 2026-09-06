import { expect, it } from "vitest";

import type { AtlasData, RunRecord } from "../../../types/atlas";
import { buildPi0PerformanceOverview } from "./buildPi0PerformanceOverview";
import type { RuntimeRealizationRecord } from "./types";

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
    warmup_iterations: 5,
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
    sample_count: run.evidence === "analytical" ? 0 : 10,
    percentile_method: run.runtime_id === "vla-cpp" ? "source_reported" : null,
    work_unit: "action_chunk",
    timing_boundary_id: run.timing.timing_boundary_id,
    missing_reason: null,
  };
}

function realization({
  id,
  runtimeId,
  precisionId,
  actionHorizon,
  denoiseSteps = 10,
  availability = "source_audited",
  evidenceKind = "source_code",
}: {
  id: string;
  runtimeId: string;
  precisionId: string;
  actionHorizon: number | null;
  denoiseSteps?: number | null;
  availability?: RuntimeRealizationRecord["availability"];
  evidenceKind?: RuntimeRealizationRecord["evidence"][number]["kind"];
}): RuntimeRealizationRecord {
  return {
    realizationId: id,
    modelId: "pi0",
    modelGraphId: "pi0-logical-v1",
    runtimeId,
    runtimeRevision: "source-audited-revision",
    availability,
    availabilityReasonCode: "source_audited_workload_contract",
    mappingLevel: "custom_runtime",
    mappingCoverage: "partial",
    modelArtifactIds: ["pi0-artifact"],
    configurationIds: [],
    deviceIds: ["thor"],
    launch: {
      submissionMode: "eager_dispatch",
      cudaGraphState: "unknown",
      captureScope: "whole_prediction",
      evidenceIds: [`evidence-${id}`],
    },
    workloadApplicability: {
      runtimeActionHorizon: actionHorizon,
      runtimeInternalActionDimension: 32,
      publicActionHorizon: actionHorizon,
      publicActionDimension: 7,
      denoiseSteps,
      missingReasonCode: actionHorizon === null ? "not_established_by_source" : null,
      evidenceIds: [`evidence-${id}`],
    },
    precisionPaths: [{
      precisionPathId: precisionId,
      label: precisionId,
      weightDtype: "fp16",
      activationDtype: "fp16",
      accumulationDtype: "fp32",
      outputDtype: "fp16",
      quantScheme: "none",
      missingFields: [],
      missingReasonCode: null,
      evidenceIds: [`evidence-${id}`],
    }],
    evidence: [{
      evidenceId: `evidence-${id}`,
      kind: evidenceKind,
      sourceId: `source-${id}`,
      revision: "source-audited-revision",
      locator: "runtime/source#predict",
      runIds: [],
      observationIds: [],
    }],
    executionGroups: [],
    mappings: [],
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
    workload: { views: 3, prompt: 46, chunk: 10, denoise: 10 },
  });
  const wrongDenoise = run({
    runId: "flash-denoise-missing",
    workload: { views: 2, prompt: 47, chunk: 50, denoise: null },
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
  const vlaCppBf16 = run({
    runId: "vlacpp-bf16-exact",
    runtimeId: "vla-cpp",
    precisionId: "mixed-bf16-fp32",
    inputContractId: "synthetic-observation",
    workload: { views: 1, prompt: 48, chunk: 50, denoise: 10 },
  });
  const vlaCppQ8 = run({
    runId: "vlacpp-q8-exact",
    runtimeId: "vla-cpp",
    precisionId: "q8_0-weight-only",
    inputContractId: "synthetic-observation",
    workload: { views: 1, prompt: 48, chunk: 50, denoise: 10 },
  });
  const duplicateTargetOne = run({
    runId: "duplicate-target-one",
    runtimeId: "duplicate-target",
    precisionId: "fp16",
    workload: { views: 2, prompt: 48, chunk: 20, denoise: 10 },
  });
  const duplicateTargetTwo = run({
    runId: "duplicate-target-two",
    runtimeId: "duplicate-target",
    precisionId: "fp16",
    workload: { views: 2, prompt: 48, chunk: 20, denoise: 10 },
  });
  const duplicateNative = run({
    runId: "duplicate-native",
    runtimeId: "duplicate-target",
    precisionId: "fp16",
    workload: { views: 2, prompt: 47, chunk: 10, denoise: 10 },
  });
  const oldWarmup = run({runId: "old-three-warmups", workload: {views: 1, prompt: 48, chunk: 20, denoise: 10}});
  oldWarmup.timing.warmup_iterations = 3;
  oldWarmup.comparison_context.timing.warmup_iterations = 3;
  const runs = [
    exactFlash,
    wrongPrompt,
    wrongChunk,
    wrongDenoise,
    analyticalExact,
    otherHardware,
    otherContract,
    otherTask,
    vlaCppBf16,
    vlaCppQ8,
    duplicateTargetOne,
    duplicateTargetTwo,
    duplicateNative,
    oldWarmup,
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
        { runtime_id: "duplicate-target", display_name: "Duplicate target", backend: "custom", model_support: [] },
      ],
    },
  } as unknown as AtlasData;

  const overview = buildPi0PerformanceOverview({ data, hardwareId: "thor" });

  expect(overview.target).toEqual({
    promptTokens: 48,
    denoiseSteps: 10,
    cameraViews: [1, 2, 3],
    actionChunks: [20, 50],
    warmupIterations: 5,
    sampleCount: 10,
  });
  expect(overview.facets).toHaveLength(6);
  expect(overview.facets.filter((facet) => facet.runtimeId === "flashrt"
    && facet.contract.inputContractId === "deterministic-observation"
    && facet.contract.timingBoundaryId === "predict")).toHaveLength(2);
  expect(overview.facets.some((facet) => facet.runtimeId === "flashrt"
    && facet.contract.inputContractId === "synthetic-observation"
    && facet.contract.timingBoundaryId === "predict-with-preprocess")).toBe(true);
  expect(overview.defaultCoordinate).toEqual({
    cameraViews: 1,
    actionChunk: 50,
    measuredGroupCount: 2,
  });
  expect(overview.groups.map((group) => [
    group.runtimeId,
    group.precisionId,
    group.facets.length,
    group.comparison.state,
  ])).toEqual([
    ["duplicate-target", "fp16", 1, "unavailable"],
    ["flashrt", "mixed-fp8-e4m3-fp16", 3, "unavailable"],
    ["vla-cpp", "mixed-bf16-fp32", 1, "measured"],
    ["vla-cpp", "q8_0-weight-only", 1, "measured"],
  ]);
  expect(new Set(overview.groups.map((group) => `${group.runtimeId}/${group.precisionId}`)).size)
    .toBe(overview.groups.length);
  for (const [precisionId, runId] of [
    ["mixed-bf16-fp32", "vlacpp-bf16-exact"],
    ["q8_0-weight-only", "vlacpp-q8-exact"],
  ] as const) {
    const facet = overview.facets.find((candidate) => candidate.runtimeId === "vla-cpp"
      && candidate.precisionId === precisionId)!;
    const targetCell = facet.series.find((series) => series.actionChunk === 50)!.cells[0]!;
    expect(targetCell.state).toBe("measured");
    if (targetCell.state !== "measured") throw new Error("target cell must be measured");
    expect(targetCell.selection.runId).toBe(runId);
  }

  const primary = overview.facets.find((facet) => facet.series.some((series) => series.cells.some((cell) =>
    cell.state === "measured" && cell.selection.runId === "flash-exact")))!;
  expect(primary.observedScope).toEqual({
    promptTokens: [42, 46, 47, 48],
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
  expect(primary.nativeEvidenceSelection).toMatchObject({
    runId: "flash-denoise-missing",
    configurationId: "configuration-flash-denoise-missing",
    workload: {
      cameraViews: 2,
      promptTokens: 47,
      actionChunk: 50,
      denoiseSteps: null,
    },
    workloadStatus: "partial",
  });
  expect(primary.series[1]!.cells[1]!.state).toBe("pending_supported");
  expect(overview.facets.find((facet) => facet.runtimeId === "duplicate-target")?.nativeEvidenceSelection?.runId).toBe("duplicate-native");
});

it("uses source-audited action horizons to distinguish unsupported targets from pending measurements", () => {
  const horizon10Native = run({
    runId: "horizon-10-native",
    runtimeId: "fixed-10",
    precisionId: "fp16",
    workload: { views: 2, prompt: 42, chunk: 10, denoise: 10 },
  });
  const horizon10CloserPrompt = run({
    runId: "horizon-10-closer-prompt",
    runtimeId: "fixed-10",
    precisionId: "fp16",
    workload: { views: 1, prompt: 47, chunk: 10, denoise: 10 },
  });
  const horizon10PreferredView = run({
    runId: "horizon-10-preferred-view",
    runtimeId: "fixed-10",
    precisionId: "fp16",
    workload: { views: 2, prompt: 49, chunk: 10, denoise: 10 },
  });
  const horizon50Native = run({
    runId: "horizon-50-native",
    runtimeId: "fixed-50",
    precisionId: "bf16",
    workload: { views: 2, prompt: 42, chunk: 50, denoise: 10 },
  });
  const unknownNative = run({
    runId: "unknown-native",
    runtimeId: "no-realization",
    precisionId: "fp16",
    workload: { views: 2, prompt: 42, chunk: 10, denoise: 10 },
  });
  const unmeasuredNative = run({
    runId: "unmeasured-native",
    runtimeId: "unmeasured-declaration",
    precisionId: "fp16",
    workload: { views: 2, prompt: 42, chunk: 10, denoise: 10 },
  });
  const runOnlyNative = run({
    runId: "run-only-native",
    runtimeId: "run-only-declaration",
    precisionId: "fp16",
    workload: { views: 2, prompt: 42, chunk: 10, denoise: 10 },
  });
  const runs = [
    horizon10Native,
    horizon10CloserPrompt,
    horizon10PreferredView,
    horizon50Native,
    unknownNative,
    unmeasuredNative,
    runOnlyNative,
  ];
  const data = {
    format_version: "1.0.0",
    datasets: {
      runs,
      end_to_end: runs.map((item, index) => measurement(item, 60 + index)),
      stages: [],
      models: [],
      devices: [{ device_id: "thor", display_name: "NVIDIA Jetson AGX Thor", accelerator_architecture: "blackwell" }],
      runtimes: [
        { runtime_id: "fixed-10", display_name: "Fixed 10", backend: "custom", model_support: [] },
        { runtime_id: "fixed-50", display_name: "Fixed 50", backend: "custom", model_support: [] },
        { runtime_id: "no-realization", display_name: "Unknown", backend: "custom", model_support: [] },
        { runtime_id: "unmeasured-declaration", display_name: "Unmeasured", backend: "custom", model_support: [] },
        { runtime_id: "run-only-declaration", display_name: "Run only", backend: "custom", model_support: [] },
      ],
    },
  } as unknown as AtlasData;
  const realizations = [
    realization({
      id: "fixed-10",
      runtimeId: "fixed-10",
      precisionId: "fp16",
      actionHorizon: 10,
      availability: "measured",
    }),
    realization({ id: "fixed-50", runtimeId: "fixed-50", precisionId: "bf16", actionHorizon: 50 }),
    realization({
      id: "unmeasured-declaration",
      runtimeId: "unmeasured-declaration",
      precisionId: "fp16",
      actionHorizon: 10,
      availability: "unmeasured",
    }),
    realization({
      id: "run-only-declaration",
      runtimeId: "run-only-declaration",
      precisionId: "fp16",
      actionHorizon: 10,
      availability: "measured",
      evidenceKind: "canonical_run",
    }),
  ];

  const overview = buildPi0PerformanceOverview({ data, hardwareId: "thor", realizations });
  const fixed10 = overview.facets.find((facet) => facet.runtimeId === "fixed-10")!;
  const fixed50 = overview.facets.find((facet) => facet.runtimeId === "fixed-50")!;
  const unknown = overview.facets.find((facet) => facet.runtimeId === "no-realization")!;
  const unmeasured = overview.facets.find((facet) => facet.runtimeId === "unmeasured-declaration")!;
  const runOnly = overview.facets.find((facet) => facet.runtimeId === "run-only-declaration")!;

  expect(fixed10.series.map((series) => [series.actionChunk, series.cells.map((cell) => cell.state)])).toEqual([
    [20, ["unsupported", "unsupported", "unsupported"]],
    [50, ["unsupported", "unsupported", "unsupported"]],
  ]);
  expect(fixed50.series.map((series) => [series.actionChunk, series.cells.map((cell) => cell.state)])).toEqual([
    [20, ["unsupported", "unsupported", "unsupported"]],
    [50, ["pending_supported", "pending_supported", "pending_supported"]],
  ]);
  expect(unknown.series.flatMap((series) => series.cells.map((cell) => cell.state))).toEqual([
    "pending_supported", "pending_supported", "pending_supported",
    "pending_supported", "pending_supported", "pending_supported",
  ]);
  expect(unmeasured.series.flatMap((series) => series.cells.map((cell) => cell.state))).toEqual([
    "pending_supported", "pending_supported", "pending_supported",
    "pending_supported", "pending_supported", "pending_supported",
  ]);
  expect(runOnly.series.flatMap((series) => series.cells.map((cell) => cell.state))).toEqual([
    "pending_supported", "pending_supported", "pending_supported",
    "pending_supported", "pending_supported", "pending_supported",
  ]);
  expect(fixed10.nativeEvidenceSelection).toMatchObject({
    runId: "horizon-10-preferred-view",
    configurationId: "configuration-horizon-10-preferred-view",
    workload: { cameraViews: 2, promptTokens: 49, actionChunk: 10, denoiseSteps: 10 },
  });
  expect(fixed10.series.flatMap((series) => series.cells).some((cell) => cell.state === "measured")).toBe(false);
});
