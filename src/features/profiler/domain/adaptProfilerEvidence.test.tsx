import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import captureDocument from "../../../../data/profiler/profiler_captures.json";
import metricDocument from "../../../../data/profiler/profiler_metrics.json";
import observationDocument from "../../../../data/profiler/kernel_observations.json";
import signatureDocument from "../../../../data/profiler/kernel_signatures.json";
import runDocument from "../../../../data/measurements/runs.json";
import type { RouteState } from "../../../app/routes";
import type { AtlasData, AtlasDatasets, CanonicalRecord } from "../../../types/atlas";
import { KernelInspector } from "../../performance/components/KernelInspector";
import type { KernelRowsModel } from "../../performance/domain/buildKernelRows";
import { TimelineInspector } from "../../timeline/components/TimelineInspector";
import type { TimelineViewModel } from "../../timeline/domain/buildTimelineView";
import { adaptProfilerEvidence } from "./adaptProfilerEvidence";

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
  model: "pi0", tab: "roofline-kernels", runtime: "flashrt", hardware: "nvidia-jetson-agx-thor",
  workload: null, precision: null, runtimePrecision: null, entity: null,
  timelineCapture: null, rooflineLevel: "overview", basis: null,
};

it("adapts and renders locked Task 7 NCU evidence while retaining legacy capture compatibility", () => {
  const legacyCapture = captureDocument.records.find((record) =>
    record.capture_id === "capture-pi0-flashrt-ncu-encoder-large-gemm-001",
  )!;
  const observation = observationDocument.records.find((record) =>
    record.capture_id === legacyCapture.capture_id,
  )!;
  const signature = signatureDocument.records.find((record) =>
    record.kernel_signature_id === observation.kernel_signature_id,
  )!;
  const run = runDocument.records.find((record) => record.run_id === legacyCapture.run_id)!;
  const templateMetric = metricDocument.records.find((record) =>
    record.capture_id === legacyCapture.capture_id,
  )!;
  const origins = structuredClone(legacyCapture.ncu!.origins) as Record<string, string>;
  delete origins.gpu_frequency_not_fixed;
  Object.assign(origins, {
    disable_extra_suffixes: "session_command",
    external_clock_control: "collection_wrapper_observed",
  });
  const capture = {
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
  const metrics = metricFixtures.map(([metricName, unit, value], index) => ({
    ...structuredClone(templateMetric),
    metric_id: `metric-task7-${index}`,
    metric_name: metricName,
    raw_counter_name: `raw-${index}`,
    section_name: metricName === "tensor_cycles_active_pct_of_peak_sustained_active"
      ? "ComputeWorkloadAnalysis"
      : metricName.includes("scoreboard") || metricName.startsWith("average_warp_latency")
        ? "WarpStateStats"
        : metricName.startsWith("l2_sysmem_")
          ? "explicit_sysmem_sector_metrics"
          : "SchedulerStats",
    value,
    unit,
    missing_reason: value === null ? "counter_absent_from_report" : null,
  }));
  const telemetry = [
    {
      telemetry_id: "telemetry-task7-gpu",
      run_id: run.run_id,
      capture_id: capture.capture_id,
      source_id: capture.source_id,
      operating_point_id: run.operating_point.operating_point_id,
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
      run_id: run.run_id,
      capture_id: capture.capture_id,
      source_id: capture.source_id,
      operating_point_id: run.operating_point.operating_point_id,
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
      run_id: run.run_id,
      capture_id: capture.capture_id,
      source_id: capture.source_id,
      operating_point_id: run.operating_point.operating_point_id,
      record_kind: "sampled_series",
      alignment: "same_run_unaligned",
      window: null,
      metric_name: "throttle_status",
      samples: [], summary: null,
      evidence_semantics: "observed_samples",
      missing_reason: "not_collected",
    },
  ];
  const evidence = adaptProfilerEvidence(atlas({
    profiler_captures: [capture] as unknown as CanonicalRecord[],
    kernel_observations: [observation] as unknown as CanonicalRecord[],
    kernel_signatures: [signature] as unknown as CanonicalRecord[],
    profiler_metrics: metrics as unknown as CanonicalRecord[],
    telemetry: telemetry as unknown as CanonicalRecord[],
  }));
  const legacy = adaptProfilerEvidence(atlas({
    profiler_captures: [legacyCapture] as unknown as CanonicalRecord[],
  })).captures[0]!;
  expect(legacy.ncu).toMatchObject({ sectionMode: null, sections: null, explicitMetrics: null });
  expect(legacy.ncu?.origins.gpuFrequencyNotFixed).toBe("collection_log_manual_audit");
  expect(evidence.captures[0]?.ncu).toMatchObject({
    clockControlRequest: "none",
    sectionMode: "scheduler_stats_with_sysmem_sectors",
    sections: ["SpeedOfLight", "ComputeWorkloadAnalysis", "MemoryWorkloadAnalysis", "LaunchStats", "Occupancy", "SchedulerStats"],
    externalClockControl: { controller: "jetson_clocks", state: "locked" },
    origins: { gpuFrequencyNotFixed: null },
  });
  expect(evidence.telemetry.map((item) => item.measurementSource)).toEqual([
    "ncu_gpc_cycle_rate",
    "jetson_clocks_show_current_freq",
    null,
  ]);

  const row = {
    observation: evidence.observations[0]!, signature: evidence.signatures[0]!, capture: evidence.captures[0]!, run,
    metrics: new Map(evidence.metrics.map((item) => [item.metricName, item])), links: [], telemetry: evidence.telemetry,
  };
  const kernelMarkup = renderToStaticMarkup(<KernelInspector
    model={{ selectedRow: row, relatedNsys: null, relatedNcu: null } as unknown as KernelRowsModel}
    route={route}
    navigate={() => undefined}
  />);
  const timelineMarkup = renderToStaticMarkup(<TimelineInspector
    view={{
      active: { capture: evidence.captures[0]!, run }, selectedEvent: null, selectedObservation: null,
      selectedSignature: evidence.signatures[0]!, separateReplay: evidence.observations[0]!,
      separateReplayCapture: evidence.captures[0]!, separateReplayRun: run,
      separateReplayDeviceLabel: "Thor", replayMetrics: evidence.metrics, replayTelemetry: evidence.telemetry,
    } as unknown as TimelineViewModel}
    route={route}
    navigate={() => undefined}
  />);
  [kernelMarkup, timelineMarkup].forEach((markup) => {
    expect(markup).toContain("scheduler stats with sysmem sectors");
    expect(markup).toContain("Issued warps / scheduler active cycle");
    expect(markup).toContain("One or more eligible");
    expect(markup).toContain("No eligible");
    expect(markup).toContain("Tensor active");
    expect(markup).toContain("Active warps / active cycle");
    expect(markup).toContain("Eligible warps / active cycle");
    expect(markup).toContain("Maximum warps / active cycle");
    expect(markup).toContain("Active warps / peak sustained");
    expect(markup).toContain("L2 sysmem fill sectors");
    expect(markup).toContain("L2 sysmem write sectors");
    expect(markup).toContain("L2 sysmem lookup-miss sectors");
    expect(markup).toContain("Do not add; not LPDDR traffic or utilization");
    expect(markup).toContain("Long scoreboard cycles / issued instruction");
    expect(markup).toContain("Average warp latency / issued instruction");
    expect(markup).toContain("Short scoreboard cycles / issued instruction");
    expect(markup).toContain("ncu gpc cycle rate");
    expect(markup).toContain("jetson clocks show current freq");
    expect(markup).toContain("unknown source");
  });
});
