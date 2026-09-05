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
import pi05RealizationDocument from "../../../data/runtime_realizations/pi05.json";
import type { RouteState } from "../../app/routes";
import type { AtlasData, AtlasDatasets, CanonicalRecord, ModelRecord } from "../../types/atlas";
import { modelSwitchPatch } from "../model-graph/domain/modelSwitch";
import { RooflineView } from "../roofline/components/RooflineView";
import { materializeInteractiveRoofline } from "../roofline/data/materialize";
import type { RooflineCeilingRecord, RooflineScenarioRecord } from "../roofline/domain/types";
import { legacyComponentEntity, logicalEntity } from "./entityKeys";

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
  const switchData = atlas({
    models: modelDocument.records as unknown as ModelRecord[],
    model_graphs: [
      pi0GraphDocument.records[0],
      pi05GraphDocument.records[0],
    ] as unknown as CanonicalRecord[],
    runtimes: runtimeDocument.records as unknown as AtlasDatasets["runtimes"],
    runs: runDocument.records as unknown as AtlasDatasets["runs"],
    runtime_realizations: pi05RealizationDocument.records as unknown as CanonicalRecord[],
    roofline_scenarios: scenarioDocument.records as unknown as CanonicalRecord[],
    roofline_bases: basisDocument.records as unknown as CanonicalRecord[],
    roofline_points: [{
      point_id: "point-pi05-ordinary-atomic",
      basis_id: "basis-pi05-bf16_dense-atomic-default",
      entity: { kind: "atomic_operator" },
    }],
  });
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
    entity: legacyComponentEntity("point-pi05-ordinary-atomic"),
  }).entity).toBeNull();

  const pi0Data = atlas({
    models: modelDocument.records as unknown as ModelRecord[],
    model_graphs: [pi0GraphDocument.records[0]] as unknown as CanonicalRecord[],
    runtimes: runtimeDocument.records as unknown as AtlasDatasets["runtimes"],
    runs: runDocument.records as unknown as AtlasDatasets["runs"],
    profiler_captures: captureDocument.records as unknown as CanonicalRecord[],
    roofline_scenarios: scenarioDocument.records as unknown as CanonicalRecord[],
    roofline_bases: basisDocument.records as unknown as CanonicalRecord[],
  });
  expect(modelSwitchPatch(pi0Data, "pi0", route({
    model: "pi0",
    timelineCapture: "capture-pi0-flashrt-ncu-encoder-large-gemm-001",
  })).timelineCapture).toBeNull();
  expect(modelSwitchPatch(pi0Data, "pi0", route({
    model: "pi0",
    workload: "config-pi0-flashrt-nsys-node-001",
  })).workload).toBe("config-pi0-flashrt-nsys-node-001");

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
});
