import {kernelEntity} from "../../workbench/entityKeys";
import { expect, it } from "vitest";

import captureDocument from "../../../../data/profiler/profiler_captures.json";
import metricDocument from "../../../../data/profiler/profiler_metrics.json";
import observationDocument from "../../../../data/profiler/kernel_observations.json";
import signatureDocument from "../../../../data/profiler/kernel_signatures.json";
import { readFileSync } from "node:fs";
import runDocument from "../../../../data/measurements/runs.json";
import type { RouteState } from "../../../app/routes";
import type { AtlasData, AtlasDatasets, CanonicalRecord } from "../../../types/atlas";
import type { KernelRow, KernelRowsModel } from "../../performance/domain/buildKernelRows";
import { buildTimelineView } from "../../timeline/domain/buildTimelineView";
import { adaptProfilerEvidence } from "./adaptProfilerEvidence";
import { indexProfilerEvidence } from "./indexProfilerEvidence";

// Read the full canonical document as data; transforming its 100+ MB JSON into JS
// exceeds the bundler string limit and is unrelated to adapter behavior.
const timelineDocument = JSON.parse(readFileSync(new URL("../../../../data/profiler/timelines.json", import.meta.url), "utf8")) as { records: CanonicalRecord[] };

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

const route: RouteState = {
  model: "pi0", tab: "logical", runtime: "flashrt", hardware: "nvidia-jetson-agx-thor",
  workload: null, precision: null, runtimePrecision: null, runtimeFacet: null, entity: null,
  timelineCapture: null, rooflineLevel: "overview", basis: null,
};

it("adapts and renders locked Task 7 NCU evidence while retaining legacy capture compatibility", () => {
  const legacyCapture = captureDocument.records.find((record) =>
    record.capture_id === "capture-pi0-flashrt-ncu-encoder-large-gemm-001",
  )!;
  const schedulerObservation = structuredClone(observationDocument.records.find((record) =>
    record.capture_id === legacyCapture.capture_id,
  )!);
  schedulerObservation.duration.value_ns = 111_000;
  const signature = signatureDocument.records.find((record) =>
    record.kernel_signature_id === schedulerObservation.kernel_signature_id,
  )!;
  const schedulerRun = runDocument.records.find((record) => record.run_id === legacyCapture.run_id)!;
  const warpRun = { ...structuredClone(schedulerRun), run_id: "run-task7-warp" };
  const warpObservation = {
    ...structuredClone(schedulerObservation),
    observation_id: "kernel-observation-task7-warp",
    capture_id: "capture-task7-warp",
    run_id: warpRun.run_id,
    duration: { ...structuredClone(schedulerObservation.duration), value_ns: 222_000 },
  };
  const nsysObservation = observationDocument.records.find((record) =>
    record.kernel_signature_id === signature.kernel_signature_id
    && record.observation_kind === "nsys_window_aggregate",
  )!;
  const nsysCapture = captureDocument.records.find((record) =>
    record.capture_id === nsysObservation.capture_id,
  )!;
  const nsysTimeline = timelineDocument.records.find((record) =>
    record.capture_id === nsysCapture.capture_id,
  )!;
  const nsysRun = runDocument.records.find((record) => record.run_id === nsysCapture.run_id)!;
  const templateMetric = metricDocument.records.find((record) =>
    record.capture_id === legacyCapture.capture_id,
  )!;
  const origins = structuredClone(legacyCapture.ncu!.origins) as Record<string, string>;
  delete origins.gpu_frequency_not_fixed;
  Object.assign(origins, {
    disable_extra_suffixes: "session_command",
    external_clock_control: "collection_wrapper_observed",
  });
  const schedulerCapture = {
    ...structuredClone(legacyCapture),
    warnings: [],
    ncu: {
      ...structuredClone(legacyCapture.ncu),
      clock_control_request: "none",
      disable_extra_suffixes: true,
      section_mode: "scheduler_stats_with_sysmem_sectors",
      sections: ["SpeedOfLight", "ComputeWorkloadAnalysis", "MemoryWorkloadAnalysis", "LaunchStats", "Occupancy", "SchedulerStats"],
      explicit_metrics: [
        "lts__d_sectors_fill_sysmem.sum",
        "lts__t_sectors_aperture_sysmem_op_write.sum",
        "lts__t_sectors_srcunit_tex_aperture_sysmem_lookup_miss.sum",
      ],
      external_clock_control: { controller: "jetson_clocks", state: "locked" },
      origins,
    },
  };
  const warpCapture = {
    ...structuredClone(schedulerCapture),
    capture_id: warpObservation.capture_id,
    run_id: warpRun.run_id,
    ncu: {
      ...structuredClone(schedulerCapture.ncu),
      section_mode: "warp_state_stats",
      sections: ["SpeedOfLight", "ComputeWorkloadAnalysis", "MemoryWorkloadAnalysis", "LaunchStats", "Occupancy", "WarpStateStats"],
      explicit_metrics: [],
      warp_trigger: {
        scheduler_capture_id: schedulerCapture.capture_id,
        scheduler_observation_id: schedulerObservation.observation_id,
        origin: "reviewed_scheduler_evidence",
        criteria: [
          { metric_name: "scheduler_issue_active_per_active_cycle", operator: "lt", threshold: 0.6, observed_value: 0.55 },
          { metric_name: "scheduler_active_warps_per_active_cycle", operator: "gte", threshold: 1, observed_value: 8 },
          { metric_name: "scheduler_eligible_warps_per_active_cycle", operator: "lt", threshold: 1, observed_value: 0.5 },
        ],
        launch_occupancy_review: {
          conclusion: "launch_and_occupancy_do_not_explain_issue_gap",
          basis: "manual_review_of_same_capture_evidence",
          evidence_fields: ["kernel_observation.launch", "theoretical_occupancy_percent", "achieved_occupancy_percent"],
        },
      },
    },
  };
  const metricFixtures = [
    ["tensor_cycles_active_pct_of_peak_sustained_active", "percent", 72],
    ["scheduler_issue_active_per_active_cycle", "warp_per_cycle", 0.55],
    ["scheduler_issue_active_pct_of_peak_sustained_active", "percent", 55],
    ["scheduler_issue_inst0_percent", "percent", 45],
    ["scheduler_active_warps_per_active_cycle", "warp", 8],
    ["scheduler_eligible_warps_per_active_cycle", "warp", 0.5],
    ["scheduler_maximum_warps_per_active_cycle", "warp", 12],
    ["scheduler_warps_active_peak_sustained", "warp", 16],
    ["l2_sysmem_fill_sectors", "sector", 1000],
    ["l2_sysmem_write_sectors", "sector", 250],
    ["l2_sysmem_lookup_miss_sectors", "sector", 75],
    ["average_warp_latency_cycles_per_issued_instruction", "cycles_per_instruction", 20],
    ["long_scoreboard_cycles_per_issued_instruction", "cycles_per_instruction", 8],
    ["short_scoreboard_cycles_per_issued_instruction", "cycles_per_instruction", null],
  ] as const;
  const metrics = metricFixtures.map(([metricName, unit, value], index) => {
    const isWarpMetric = metricName.includes("scoreboard") || metricName.startsWith("average_warp_latency");
    const targetCapture = isWarpMetric ? warpCapture : schedulerCapture;
    const targetObservation = isWarpMetric ? warpObservation : schedulerObservation;
    const targetRun = isWarpMetric ? warpRun : schedulerRun;
    return {
      ...structuredClone(templateMetric),
      metric_id: `metric-task7-${index}`,
      capture_id: targetCapture.capture_id,
      run_id: targetRun.run_id,
      subject: { kind: "kernel_observation", id: targetObservation.observation_id },
      metric_name: metricName,
      raw_counter_name: `raw-${index}`,
      section_name: metricName === "tensor_cycles_active_pct_of_peak_sustained_active"
        ? "ComputeWorkloadAnalysis"
        : isWarpMetric
          ? "WarpStateStats"
          : metricName.startsWith("l2_sysmem_")
            ? "explicit_sysmem_sector_metrics"
            : "SchedulerStats",
      value,
      unit,
      missing_reason: value === null ? "counter_absent_from_report" : null,
    };
  });
  const telemetry = [
    {
      telemetry_id: "telemetry-task7-gpu",
      run_id: schedulerRun.run_id,
      capture_id: schedulerCapture.capture_id,
      source_id: schedulerCapture.source_id,
      operating_point_id: schedulerRun.operating_point.operating_point_id,
      record_kind: "sampled_summary",
      alignment: "same_run_unaligned",
      window: null,
      metric_name: "observed_gpu_frequency",
      measurement_source: "ncu_gpc_cycle_rate",
      samples: [],
      summary: { statistic: "mean", value: 1386, unit: "MHz", sample_count: 1 },
      evidence_semantics: "observed_samples",
      missing_reason: null,
    },
    {
      telemetry_id: "telemetry-task7-emc",
      run_id: schedulerRun.run_id,
      capture_id: schedulerCapture.capture_id,
      source_id: schedulerCapture.source_id,
      operating_point_id: schedulerRun.operating_point.operating_point_id,
      record_kind: "sampled_series",
      alignment: "same_run_unaligned",
      window: null,
      metric_name: "observed_emc_frequency",
      measurement_source: "jetson_clocks_show_current_freq",
      samples: [], summary: null,
      evidence_semantics: "observed_samples",
      missing_reason: "unavailable_from_tool",
    },
    {
      telemetry_id: "telemetry-task7-throttle",
      run_id: schedulerRun.run_id,
      capture_id: schedulerCapture.capture_id,
      source_id: schedulerCapture.source_id,
      operating_point_id: schedulerRun.operating_point.operating_point_id,
      record_kind: "sampled_series",
      alignment: "same_run_unaligned",
      window: null,
      metric_name: "throttle_status",
      samples: [], summary: null,
      evidence_semantics: "observed_samples",
      missing_reason: "not_collected",
    },
  ];
  const data = atlas({
    profiler_captures: [nsysCapture, schedulerCapture, warpCapture] as unknown as CanonicalRecord[],
    timelines: [nsysTimeline] as unknown as CanonicalRecord[],
    kernel_observations: [nsysObservation, schedulerObservation, warpObservation] as unknown as CanonicalRecord[],
    kernel_signatures: [signature] as unknown as CanonicalRecord[],
    profiler_metrics: metrics as unknown as CanonicalRecord[],
    telemetry: telemetry as unknown as CanonicalRecord[],
    runs: [nsysRun, schedulerRun, warpRun] as unknown as AtlasDatasets["runs"],
  });
  const evidence = adaptProfilerEvidence(data);
  const legacy = adaptProfilerEvidence(atlas({
    profiler_captures: [legacyCapture] as unknown as CanonicalRecord[],
  })).captures[0]!;
  expect(legacy.ncu).toMatchObject({ sectionMode: null, sections: null, explicitMetrics: null, warpTrigger: null });
  expect(legacy.ncu?.origins.gpuFrequencyNotFixed).toBe("collection_log_manual_audit");
  const adaptedSchedulerCapture = evidence.captures.find((item) => item.captureId === schedulerCapture.capture_id)!;
  const adaptedWarpCapture = evidence.captures.find((item) => item.captureId === warpCapture.capture_id)!;
  const adaptedSchedulerObservation = evidence.observations.find((item) => item.observationId === schedulerObservation.observation_id)!;
  const adaptedWarpObservation = evidence.observations.find((item) => item.observationId === warpObservation.observation_id)!;
  expect(adaptedSchedulerCapture.ncu).toMatchObject({
    clockControlRequest: "none",
    sectionMode: "scheduler_stats_with_sysmem_sectors",
    warpTrigger: null,
    origins: { gpuFrequencyNotFixed: null },
  });
  expect(adaptedWarpCapture.ncu).toMatchObject({
    clockControlRequest: "none",
    sectionMode: "warp_state_stats",
    sections: ["SpeedOfLight", "ComputeWorkloadAnalysis", "MemoryWorkloadAnalysis", "LaunchStats", "Occupancy", "WarpStateStats"],
    externalClockControl: { controller: "jetson_clocks", state: "locked" },
    warpTrigger: {
      schedulerCaptureId: schedulerCapture.capture_id,
      schedulerObservationId: schedulerObservation.observation_id,
      origin: "reviewed_scheduler_evidence",
      criteria: [
        { metricName: "scheduler_issue_active_per_active_cycle", operator: "lt", threshold: 0.6, observedValue: 0.55 },
        { metricName: "scheduler_active_warps_per_active_cycle", operator: "gte", threshold: 1, observedValue: 8 },
        { metricName: "scheduler_eligible_warps_per_active_cycle", operator: "lt", threshold: 1, observedValue: 0.5 },
      ],
      launchOccupancyReview: {
        conclusion: "launch_and_occupancy_do_not_explain_issue_gap",
        basis: "manual_review_of_same_capture_evidence",
        evidenceFields: ["kernel_observation.launch", "theoretical_occupancy_percent", "achieved_occupancy_percent"],
      },
    },
    origins: { gpuFrequencyNotFixed: null },
  });
  expect(evidence.telemetry.map((item) => item.measurementSource)).toEqual([
    "ncu_gpc_cycle_rate",
    "jetson_clocks_show_current_freq",
    null,
  ]);

  const timelineView = buildTimelineView(data, evidence, indexProfilerEvidence(evidence), {
    modelId: "pi0",
    runtimeId: "flashrt",
    hardwareId: "nvidia-jetson-agx-thor",
    captureId: nsysCapture.capture_id,
    entity: kernelEntity(nsysCapture.capture_id, nsysObservation.observation_id),
  });
  const unselected = buildTimelineView(data, evidence, indexProfilerEvidence(evidence), {
    modelId: "pi0", runtimeId: "flashrt", hardwareId: "nvidia-jetson-agx-thor",
    captureId: nsysCapture.capture_id, entity: null,
  });
  expect(unselected.separateReplay).toBeNull();
  expect(timelineView.separateReplay?.observationId).toBe(schedulerObservation.observation_id);
  expect(timelineView.separateReplay?.duration.valueNs).toBe(111_000);
  expect(timelineView.replayMetrics.map((item) => item.metricName)).toContain("scheduler_issue_active_per_active_cycle");
  expect(timelineView.warpSupplement?.observation.observationId).toBe(warpObservation.observation_id);
  expect(timelineView.warpSupplement?.observation.duration.valueNs).toBe(222_000);
  expect(timelineView.warpSupplement?.metrics.map((item) => item.metricName)).toContain("long_scoreboard_cycles_per_issued_instruction");
});
