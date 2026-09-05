import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import basisDocument from "../../../data/analysis/roofline_bases.json";
import ceilingDocument from "../../../data/analysis/roofline_ceilings.json";
import scenarioDocument from "../../../data/analysis/roofline_scenarios.json";
import modelDocument from "../../../data/catalog/models.json";
import runtimeDocument from "../../../data/catalog/runtimes.json";
import runDocument from "../../../data/measurements/runs.json";
import pi0GraphDocument from "../../../data/model_graphs/pi0.json";
import pi05GraphDocument from "../../../data/model_graphs/pi05.json";
import captureDocument from "../../../data/profiler/profiler_captures.json";
import pi0RealizationDocument from "../../../data/runtime_realizations/pi0.json";
import pi05RealizationDocument from "../../../data/runtime_realizations/pi05.json";
import type { RouteState } from "../../app/routes";
import type { AtlasData, AtlasDatasets, CanonicalRecord, ModelRecord } from "../../types/atlas";
import { modelSwitchPatch } from "../model-graph/domain/modelSwitch";
import { adaptRuntimeRealization } from "../runtime/domain/adaptRuntimeRealization";
import { resolveRuntimeCandidates } from "../runtime/domain/resolveRuntimeRealization";
import { RooflineView } from "../roofline/components/RooflineView";
import {
  interactiveSourceBasisIsLossless,
  materializeInteractiveRoofline,
  runtimeResolutionWorkload,
} from "../roofline/data/materialize";
import type { RooflineBasisRecord, RooflineCeilingRecord, RooflineScenarioRecord } from "../roofline/domain/types";
import {
  legacyComponentEntity,
  logicalEntity,
  runtimeGroupEntity,
  timelineEventEntity,
} from "./entityKeys";
import { createModelCapabilityRegistry } from "./modelCapabilities";

function atlas(overrides: Partial<AtlasDatasets>): AtlasData {
  return {
    format_version: "1.0.0",
    datasets: {
      architectures: [], devices: [], end_to_end: [], kernel_observations: [],
      kernel_signatures: [], models: [], model_graphs: [], operator_kernel_links: [],
      operators: [], profiler_captures: [], profiler_metrics: [], rooflines: [],
      roofline_bases: [], roofline_ceilings: [], roofline_points: [],
      roofline_scenarios: [], runtime_realizations: [], runs: [], runtimes: [],
      sources: [], stages: [], systems: [], telemetry: [], timelines: [],
      ...overrides,
    },
  };
}

function route(overrides: Partial<RouteState> = {}): RouteState {
  return {
    model: "pi0", tab: "roofline-kernels", runtime: null, hardware: null,
    workload: null, precision: null, runtimePrecision: null, entity: null,
    timelineCapture: null, rooflineLevel: "overview", basis: null,
    ...overrides,
  };
}

it("retains only target-model-compatible selections and discovers roofline support from canonical capabilities", () => {
  const sharedRef = "vision-encoder/vision-blocks/self-attention/query-projection";
  const currentRoute = route({
    runtime: "vla-cpp",
    hardware: "nvidia-jetson-agx-thor",
    workload: "V=3,L_PROMPT=0,T_ACTION=50,N_DENOISE=10",
    precision: "bf16_dense",
    runtimePrecision: "q8_0-weight-only",
    entity: logicalEntity(sharedRef),
    timelineCapture: "capture-pi0-flashrt-nsys-node-001",
    rooflineLevel: "stage",
    basis: "basis-pi0-bf16_dense-stage-default",
  });
  const assignmentShapedConfiguration = "V=3,L_PROMPT=180,T_ACTION=10,N_DENOISE=10";
  const foreignAssignmentShapedConfiguration = "V=2,L_PROMPT=160,T_ACTION=10,N_DENOISE=10";
  const vlaPerfRun = runDocument.records.find((record) =>
    record.model_id === "pi05" && record.runtime_id === "vla-perf",
  )!;
  const foreignRun = runDocument.records.find((record) =>
    record.model_id === "pi0" && record.runtime_id === "vla-perf",
  )!;
  const switchData = atlas({
    models: modelDocument.records as unknown as ModelRecord[],
    model_graphs: [
      pi0GraphDocument.records[0],
      pi05GraphDocument.records[0],
    ] as unknown as CanonicalRecord[],
    runtimes: runtimeDocument.records as unknown as AtlasDatasets["runtimes"],
    runs: [
      ...runDocument.records,
      { ...structuredClone(vlaPerfRun), run_id: "run-assignment-config-fixture", configuration_id: assignmentShapedConfiguration },
      { ...structuredClone(foreignRun), run_id: "run-foreign-assignment-config-fixture", configuration_id: foreignAssignmentShapedConfiguration },
    ] as unknown as AtlasDatasets["runs"],
    runtime_realizations: [
      ...pi05RealizationDocument.records,
      {
        ...structuredClone(pi05RealizationDocument.records[0]!),
        realization_id: "rr-pi05-not-supported-fixture",
        availability: "not_supported",
      },
    ] as unknown as CanonicalRecord[],
    roofline_scenarios: scenarioDocument.records as unknown as CanonicalRecord[],
    roofline_bases: basisDocument.records as unknown as CanonicalRecord[],
    roofline_points: [{
      point_id: "point-pi05-ordinary-atomic",
      basis_id: "basis-pi05-bf16_dense-atomic-default",
      entity: { kind: "atomic_operator" },
    }],
  });
  const registry = createModelCapabilityRegistry(switchData);
  const pi05Capabilities = registry.get("pi05")!;
  expect(pi05Capabilities.canonicalConfigurationIds.has(foreignAssignmentShapedConfiguration)).toBe(true);
  expect(pi05Capabilities.configurationIds.has(foreignAssignmentShapedConfiguration)).toBe(false);
  expect(modelSwitchPatch(switchData, "pi05", currentRoute)).toEqual({
    model: "pi05",
    runtime: null,
    hardware: "nvidia-jetson-agx-thor",
    workload: null,
    precision: "bf16_dense",
    runtimePrecision: null,
    entity: logicalEntity(sharedRef),
    timelineCapture: null,
    basis: null,
  });
  expect(modelSwitchPatch(switchData, "pi05", {
    ...currentRoute,
    runtime: "flashrt",
    workload: "V=3,L_PROMPT=48,T_ACTION=50,N_DENOISE=10",
    precision: "fp8_w8a8",
    runtimePrecision: "mixed-fp8-e4m3-fp16",
    basis: "basis-pi05-bf16_dense-stage-default",
  })).toMatchObject({
    runtime: "flashrt",
    hardware: "nvidia-jetson-agx-thor",
    workload: null,
    precision: "fp8_w8a8",
    runtimePrecision: "mixed-fp8-e4m3-fp16",
    basis: null,
  });
  expect(modelSwitchPatch(switchData, "pi05", {
    ...currentRoute,
    runtime: null,
    workload: null,
    precision: "runtime_mixed",
    runtimePrecision: null,
    basis: "basis-pi05-runtime_mixed-stage-default",
  }).basis).toBeNull();
  expect(modelSwitchPatch(switchData, "pi05", {
    ...currentRoute,
    runtime: "flashrt",
    hardware: "nvidia-jetson-agx-thor",
    workload: "cfg-flashrt-pi05-matrix-008",
    precision: "runtime_mixed",
    runtimePrecision: "mixed-fp8-e4m3-fp16",
    basis: "basis-pi05-runtime_mixed-stage-default",
  }).basis).toBe("basis-pi05-runtime_mixed-stage-default");
  const mixedBasisContext = pi05Capabilities.rooflineBasisContexts.get("basis-pi05-runtime_mixed-stage-default")!;
  expect([...mixedBasisContext.configurationIds]).toEqual(["cfg-flashrt-pi05-matrix-008"]);
  expect(Object.fromEntries(mixedBasisContext.workloadBindings!)).toMatchObject({
    V: 3, L_PROMPT: 160, T_ACTION: 10, N_DENOISE: 10,
  });
  const unsupportedGroupId = pi05RealizationDocument.records[0]!.execution_groups[0]!.execution_group_id;
  expect(modelSwitchPatch(switchData, "pi05", {
    ...currentRoute,
    runtime: "flashrt",
    workload: null,
    runtimePrecision: "mixed-fp8-e4m3-fp16",
    entity: runtimeGroupEntity("rr-pi05-not-supported-fixture", unsupportedGroupId),
  }).entity).toBeNull();
  [
    {
      name: "analytical-only runtime",
      current: { runtime: "vla-perf", workload: "cfg-flashrt-pi05-matrix-001", runtimePrecision: "uniform-fp16" },
      expected: { runtime: "vla-perf", hardware: null, workload: null, runtimePrecision: null },
    },
    {
      name: "group from a different resolved realization",
      current: {
        runtime: "flashrt",
        workload: "cfg-flashrt-pi05-matrix-010",
        runtimePrecision: null,
        entity: runtimeGroupEntity(pi05RealizationDocument.records[0]!.realization_id, unsupportedGroupId),
      },
      expected: { workload: "cfg-flashrt-pi05-matrix-010", entity: null },
    },
    {
      name: "assignment-shaped configuration owned by another runtime",
      current: {
        runtime: "flashrt",
        workload: assignmentShapedConfiguration,
        runtimePrecision: "mixed-fp8-e4m3-fp16",
      },
      expected: { workload: null },
    },
    {
      name: "assignment-shaped configuration owned by another model",
      current: {
        runtime: "flashrt",
        workload: foreignAssignmentShapedConfiguration,
        runtimePrecision: "mixed-fp8-e4m3-fp16",
      },
      expected: { workload: null },
    },
  ].forEach((testCase) => {
    expect(
      modelSwitchPatch(switchData, "pi05", { ...currentRoute, ...testCase.current }),
      testCase.name,
    ).toMatchObject(testCase.expected);
  });
  expect(modelSwitchPatch(switchData, "pi05", {
    ...currentRoute,
    entity: legacyComponentEntity("point-pi05-ordinary-atomic"),
  }).entity).toBeNull();

  const pi0Data = atlas({
    models: modelDocument.records as unknown as ModelRecord[],
    model_graphs: [pi0GraphDocument.records[0]] as unknown as CanonicalRecord[],
    runtimes: runtimeDocument.records as unknown as AtlasDatasets["runtimes"],
    runs: runDocument.records as unknown as AtlasDatasets["runs"],
    profiler_captures: captureDocument.records as unknown as CanonicalRecord[],
    runtime_realizations: pi0RealizationDocument.records as unknown as CanonicalRecord[],
    timelines: [
      {
        timeline_id: "timeline-graph-fixture",
        capture_id: "capture-pi0-flashrt-nsys-graph-001",
        events: [{ event_id: "event-graph" }],
      },
      {
        timeline_id: "timeline-node-fixture",
        capture_id: "capture-pi0-flashrt-nsys-node-001",
        events: [{ event_id: "event-node" }],
      },
    ],
    roofline_scenarios: scenarioDocument.records as unknown as CanonicalRecord[],
    roofline_bases: basisDocument.records as unknown as CanonicalRecord[],
  });
  const pi0Capabilities = createModelCapabilityRegistry(pi0Data).get("pi0")!;
  expect(pi0Capabilities.captureContexts.get("capture-pi0-flashrt-nsys-graph-001")?.realizationIds.size).toBe(0);
  expect(modelSwitchPatch(pi0Data, "pi0", route({
    model: "pi0",
    timelineCapture: "capture-pi0-flashrt-ncu-encoder-large-gemm-001",
  })).timelineCapture).toBeNull();
  expect(modelSwitchPatch(pi0Data, "pi0", route({
    model: "pi0",
    workload: "config-pi0-flashrt-nsys-node-001",
  })).workload).toBe("config-pi0-flashrt-nsys-node-001");
  expect(modelSwitchPatch(pi0Data, "pi0", route({
    model: "pi0",
    runtime: "flashrt",
    hardware: "nvidia-jetson-agx-thor",
    timelineCapture: "capture-pi0-flashrt-nsys-graph-001",
    entity: timelineEventEntity("timeline-node-fixture", "event-node"),
  }))).toMatchObject({
    timelineCapture: null,
    entity: null,
  });
  expect(modelSwitchPatch(pi0Data, "pi0", route({
    model: "pi0",
    runtime: "flashrt",
    hardware: "nvidia-jetson-agx-thor",
    workload: "cfg-flashrt-pi0-matrix-001",
    runtimePrecision: "mixed-fp8-e4m3-fp16",
    timelineCapture: "capture-pi0-flashrt-nsys-graph-001",
  })).timelineCapture).toBeNull();

  const sourceModel = modelDocument.records.find((item) => item.model_id === "pi0")!;
  const sourceScenario = scenarioDocument.records.find((item) =>
    item.scenario_id === "scenario-pi0-bf16_dense-default",
  )!;
  const sourceBasis = basisDocument.records.find((item) =>
    item.basis_id === "basis-pi0-bf16_dense-stage-default",
  )!;
  const futureModel = {
    ...sourceModel,
    model_id: "future-wam",
    display_name: "Future WAM",
    model_type: "world_action_model",
  } as ModelRecord;
  const futureScenario = {
    ...structuredClone(sourceScenario),
    scenario_id: "scenario-future-wam-bf16-default",
    model_id: futureModel.model_id,
    model_graph_id: "future-wam-logical-v1",
  } as unknown as CanonicalRecord;
  const futureData = atlas({
    models: [futureModel],
    model_graphs: [{
      ...structuredClone(pi0GraphDocument.records[0]),
      model_graph_id: "future-wam-logical-v1",
      model_id: futureModel.model_id,
    }] as unknown as CanonicalRecord[],
    roofline_scenarios: [futureScenario],
    roofline_bases: [{
      ...structuredClone(sourceBasis),
      basis_id: "basis-future-wam-bf16-stage-default",
      scenario_id: "scenario-future-wam-bf16-default",
    }] as unknown as CanonicalRecord[],
    roofline_ceilings: ceilingDocument.records as unknown as CanonicalRecord[],
  });
  const markup = renderToStaticMarkup(
    <RooflineView
      data={futureData}
      model={futureModel}
      route={route({ model: futureModel.model_id })}
      navigate={() => undefined}
    />,
  );
  expect(markup).toContain("Roofline &amp; kernels");

  const sourceCeiling = ceilingDocument.records.find((item) =>
    item.ceiling_id === "thor-t5000-120w-1386mhz",
  )!;
  const selectedBandwidthId = "bw-future-selected";
  const multiBandwidthCeiling = {
    ...structuredClone(sourceCeiling),
    bandwidth: [
      { ...structuredClone(sourceCeiling.bandwidth[0]!), bandwidth_ceiling_id: "bw-decoy", byte_per_second: 1 },
      { ...structuredClone(sourceCeiling.bandwidth[0]!), bandwidth_ceiling_id: selectedBandwidthId, byte_per_second: 273e9 },
    ],
  } as unknown as RooflineCeilingRecord;
  const interactive = materializeInteractiveRoofline(
    futureData.datasets.model_graphs[0]!,
    futureScenario as unknown as RooflineScenarioRecord,
    multiBandwidthCeiling,
    { executedCameraViews: 3, executedPromptTokens: 48, actionHorizon: 50, denoiseSteps: 10 },
    null,
    selectedBandwidthId,
  );
  expect(interactive.bases.map((basis) => basis.bandwidth_ceiling_id)).toEqual([
    selectedBandwidthId,
    selectedBandwidthId,
  ]);
  const uniformSourceBasis = sourceBasis as unknown as RooflineBasisRecord;
  expect(interactiveSourceBasisIsLossless(
    uniformSourceBasis,
    sourceScenario as unknown as RooflineScenarioRecord,
    null,
  )).toBe(true);
  [
    { time_basis: "wall_clock" },
    { traffic_basis: "l2_measured" },
    { runtime_overhead: "included" },
    { runtime_id: "flashrt", realization_id: "rr-unexpected" },
  ].forEach((mismatch) => {
    expect(interactiveSourceBasisIsLossless(
      { ...uniformSourceBasis, ...mismatch } as RooflineBasisRecord,
      sourceScenario as unknown as RooflineScenarioRecord,
      null,
    )).toBe(false);
  });
  expect(runtimeResolutionWorkload(
    assignmentShapedConfiguration,
    { executedCameraViews: 3, executedPromptTokens: 48, actionHorizon: 50, denoiseSteps: 10 },
    [assignmentShapedConfiguration],
  )).toBe(assignmentShapedConfiguration);
  expect(runtimeResolutionWorkload(
    foreignAssignmentShapedConfiguration,
    { executedCameraViews: 3, executedPromptTokens: 48, actionHorizon: 50, denoiseSteps: 10 },
    [...pi05Capabilities.canonicalConfigurationIds],
  )).toBe(foreignAssignmentShapedConfiguration);

  const measuredRealization = adaptRuntimeRealization({
    ...structuredClone(pi05RealizationDocument.records[0]!),
    device_ids: ["nvidia-jetson-agx-thor", "not-the-measured-device"],
  });
  const unsupportedRealization = adaptRuntimeRealization({
    ...structuredClone(pi05RealizationDocument.records[0]!),
    realization_id: "rr-pi05-not-supported-resolver-fixture",
    availability: "not_supported",
    precision_paths: [structuredClone(pi05RealizationDocument.records[0]!.precision_paths[0]!)],
  });
  expect(resolveRuntimeCandidates([unsupportedRealization], switchData.datasets.runs, {
    modelId: "pi05",
    modelGraphId: "pi05-droid-logical-v1",
    runtimeId: "flashrt",
    hardwareId: "nvidia-jetson-agx-thor",
    workload: "cfg-flashrt-pi05-matrix-008",
    precisionId: "mixed-fp8-e4m3-fp16",
    canonicalConfigurationIds: pi05Capabilities.canonicalConfigurationIds,
  })).toEqual([]);
  expect(resolveRuntimeCandidates([measuredRealization], switchData.datasets.runs, {
    modelId: "pi05",
    modelGraphId: "pi05-droid-logical-v1",
    runtimeId: "flashrt",
    hardwareId: "not-the-measured-device",
    workload: "cfg-flashrt-pi05-matrix-008",
    precisionId: "mixed-fp8-e4m3-fp16",
    canonicalConfigurationIds: pi05Capabilities.canonicalConfigurationIds,
  })).toEqual([]);
});
