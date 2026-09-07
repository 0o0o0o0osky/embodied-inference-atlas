import { expect, it } from "vitest";

import type { RunRecord, RuntimeRecord } from "../../../types/atlas";
import { pi0NoExecutionGroupPresentation } from "../components/runtimePresentation";
import type { RuntimeRealizationRecord } from "./types";
import * as runtimeSelection from "./resolveRuntimeRealization";

type SummaryBuilder = (input: {
  modelId: string;
  modelGraphId: string;
  hardwareId: string | null;
  workload: string | null;
  runtimes: readonly RuntimeRecord[];
  realizations: readonly RuntimeRealizationRecord[];
  runs: readonly RunRecord[];
  canonicalConfigurationIds: ReadonlySet<string>;
}) => readonly {
  runtimeId: string;
  state: string;
  actualPrecisions: readonly { id: string; label: string }[];
  mappingLevels: readonly string[];
  variantCount: number;
}[];

const buildRuntimeStackSummaries = (
  runtimeSelection as unknown as { buildRuntimeStackSummaries?: SummaryBuilder }
).buildRuntimeStackSummaries;

function runtime(
  runtimeId: string,
  status: string,
  evidence: "measured_local" | "analytical" = "measured_local",
): RuntimeRecord {
  return {
    runtime_id: runtimeId,
    display_name: runtimeId,
    backend: `${runtimeId}-backend`,
    model_support: [{
      model_id: "pi0",
      status,
      evidence,
      reason_code: `${status}_fixture`,
      has_canonical_measurement: status === "measured" || status === "analytical",
    }],
  };
}

function realization(
  realizationId: string,
  runtimeId: string,
  deviceId: string,
  configurationId: string,
  precisionPathId: string,
  precisionLabel: string,
  mappingLevel: RuntimeRealizationRecord["mappingLevel"],
): RuntimeRealizationRecord {
  return {
    realizationId,
    modelId: "pi0",
    modelGraphId: "graph-pi0-v1",
    runtimeId,
    runtimeRevision: "fixture",
    availability: "measured",
    availabilityReasonCode: "measured_configuration_source_mapping_not_profiler_correlated",
    mappingLevel,
    mappingCoverage: "partial",
    modelArtifactIds: ["artifact-pi0"],
    configurationIds: [configurationId],
    deviceIds: [deviceId],
    launch: {
      submissionMode: "backend_graph_compute",
      cudaGraphState: "unknown",
      captureScope: "backend_managed",
      evidenceIds: [],
    },
    workloadApplicability: {
      runtimeActionHorizon: null,
      runtimeInternalActionDimension: null,
      publicActionHorizon: null,
      publicActionDimension: null,
      denoiseSteps: null,
      missingReasonCode: "not_needed_for_fixture",
      evidenceIds: [],
    },
    precisionPaths: [{
      precisionPathId,
      label: precisionLabel,
      weightDtype: null,
      activationDtype: null,
      accumulationDtype: null,
      outputDtype: null,
      quantScheme: "none",
      missingFields: [],
      missingReasonCode: null,
      evidenceIds: [],
    }],
    evidence: [],
    executionGroups: [],
    mappings: [],
  };
}

function measuredRun(
  runtimeId: string,
  deviceId: string,
  configurationId: string,
  precisionId: string,
): RunRecord {
  return {
    model_id: "pi0",
    runtime_id: runtimeId,
    device_id: deviceId,
    configuration_id: configurationId,
    evidence: "measured_local",
    precision: { precision_id: precisionId },
    workload: {},
  } as unknown as RunRecord;
}

it("builds the executable runtime inventory for the selected hardware", () => {
  expect(buildRuntimeStackSummaries).toBeTypeOf("function");
  if (!buildRuntimeStackSummaries) return;

  const runtimes = [
    runtime("vllm-omni", "blocked"),
    runtime("flashrt", "measured"),
    runtime("vla-perf", "analytical", "analytical"),
    runtime("vla-cpp", "measured"),
    runtime("unsupported-stack", "not_supported"),
    runtime("catalog-only", "measured"),
  ];
  const realizations = [
    realization("rr-flashrt", "flashrt", "thor", "cfg-flashrt", "mixed-fp8-e4m3-fp16", "Selective FP8 E4M3 / FP16", "custom_runtime"),
    realization("rr-vla-bf16", "vla-cpp", "thor", "cfg-vla-bf16", "mixed-bf16-fp32", "BF16 weights / mixed BF16-FP32", "ggml_graph"),
    realization("rr-vla-q8", "vla-cpp", "thor", "cfg-vla-q8", "q8_0-weight-only", "Q8_0 weights / FP16 execution", "ggml_graph"),
    realization("rr-catalog-only", "catalog-only", "other-device", "cfg-other", "uniform-fp16", "FP16", "pytorch_eager"),
  ];
  const runs = [
    measuredRun("flashrt", "thor", "cfg-flashrt", "mixed-fp8-e4m3-fp16"),
    measuredRun("vla-cpp", "thor", "cfg-vla-bf16", "mixed-bf16-fp32"),
    measuredRun("vla-cpp", "thor", "cfg-vla-q8", "q8_0-weight-only"),
    measuredRun("catalog-only", "other-device", "cfg-other", "uniform-fp16"),
  ];

  const summaries = buildRuntimeStackSummaries({
    modelId: "pi0",
    modelGraphId: "graph-pi0-v1",
    hardwareId: "thor",
    workload: null,
    runtimes,
    realizations,
    runs,
    canonicalConfigurationIds: new Set(realizations.flatMap((item) => item.configurationIds)),
  });

  expect(summaries.map(({ runtimeId, state, actualPrecisions, mappingLevels, variantCount }) => ({
    runtimeId,
    state,
    actualPrecisions,
    mappingLevels,
    variantCount,
  }))).toEqual([
    {
      runtimeId: "flashrt",
      state: "有实测配置",
      actualPrecisions: [{ id: "mixed-fp8-e4m3-fp16", label: "Selective FP8 E4M3 / FP16" }],
      mappingLevels: ["custom_runtime"],
      variantCount: 1,
    },
    {
      runtimeId: "vla-cpp",
      state: "有实测配置",
      actualPrecisions: [
        { id: "mixed-bf16-fp32", label: "BF16 weights / mixed BF16-FP32" },
        { id: "q8_0-weight-only", label: "Q8_0 weights / FP16 execution" },
      ],
      mappingLevels: ["ggml_graph"],
      variantCount: 2,
    },
    {
      runtimeId: "catalog-only",
      state: "尚未实测",
      actualPrecisions: [],
      mappingLevels: [],
      variantCount: 0,
    },
    {
      runtimeId: "vllm-omni",
      state: "未实测·受阻",
      actualPrecisions: [],
      mappingLevels: [],
      variantCount: 0,
    },
    {
      runtimeId: "unsupported-stack",
      state: "不支持",
      actualPrecisions: [],
      mappingLevels: [],
      variantCount: 0,
    },
  ]);
});

it("describes an eliminated mapping without inventing an execution group", () => {
  expect(pi0NoExecutionGroupPresentation(["eliminated"])).toEqual({
    mappingSummary: "已由运行时消除，无独立计算",
    implementation: "无独立实现（运行时消除）",
    precision: "不适用",
    repeatAndKernel: "无独立计算；Kernel 不适用",
  });
});

it("does not infer absent computation from a missing mapping", () => {
  expect(pi0NoExecutionGroupPresentation([]).repeatAndKernel).toBe("实际计算未关联；Kernel 未关联");
});
