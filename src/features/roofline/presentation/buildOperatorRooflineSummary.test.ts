import { describe, expect, it } from "vitest";

import basisDocument from "../../../../data/analysis/roofline_bases.json";
import ceilingDocument from "../../../../data/analysis/roofline_ceilings.json";
import scenarioDocument from "../../../../data/analysis/roofline_scenarios.json";
import graphDocument from "../../../../data/model_graphs/pi0.json";
import type { AtlasData, CanonicalRecord } from "../../../types/atlas";
import {
  buildOperatorRooflineSummary,
  materializeCurrentPi0Roofline,
} from "./buildOperatorRooflineSummary";

const data = {
  format_version: "1.0.0",
  datasets: {
    model_graphs: graphDocument.records as unknown as CanonicalRecord[],
    roofline_bases: basisDocument.records as unknown as CanonicalRecord[],
    roofline_ceilings: ceilingDocument.records as unknown as CanonicalRecord[],
    roofline_scenarios: scenarioDocument.records as unknown as CanonicalRecord[],
    roofline_points: [],
    runtime_realizations: [],
    runs: [],
  },
} as unknown as AtlasData;

describe("Pi0 analytical Roofline presentation", () => {
  it("keeps one exact basis context and every attention component", () => {
    const result = materializeCurrentPi0Roofline({
      data,
      workloadBinding: null,
      precisionPathId: "bf16_dense",
      hardwareId: "nvidia-jetson-agx-thor",
    });
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error(result.reason);

    const slice = result.value;
    expect(slice.scenario.scenario_id).toBe(
      "scenario-pi0-bf16_dense-default-interactive-v3-p48-a50-n10",
    );
    expect(slice.scenario.workload).toMatchObject({
      executed_camera_views: 3,
      executed_prompt_tokens: 48,
      action_horizon: 50,
      denoise_steps: 10,
    });
    expect(slice.atomicBasis).toMatchObject({
      basis_id: "basis-pi0-bf16_dense-atomic-interactive-v3-p48-a50-n10",
      precision_path_id: "bf16_dense",
      device_id: "nvidia-jetson-agx-thor",
      time_basis: "analytical_roof",
      traffic_basis: "atomic_materialized",
      work_basis: "logical_formula",
    });
    expect(slice.stageBasis).toMatchObject({
      basis_id: "basis-pi0-bf16_dense-stage-interactive-v3-p48-a50-n10",
      precision_path_id: "bf16_dense",
      device_id: "nvidia-jetson-agx-thor",
      time_basis: "analytical_roof",
      traffic_basis: "atomic_materialized",
      work_basis: "logical_formula",
    });

    const gemm = buildOperatorRooflineSummary(
      slice,
      "action-flow-decoder/action-expert-blocks/feed-forward/gate-projection",
    );
    expect(gemm?.rows).toHaveLength(1);

    const attention = buildOperatorRooflineSummary(
      slice,
      "action-flow-decoder/action-expert-blocks/self-attention/attention",
    );
    expect(attention?.rows.map((row) => row.point.entity.entity_id)).toEqual([
      "action-flow-decoder/action-expert-blocks/self-attention/attention#score",
      "action-flow-decoder/action-expert-blocks/self-attention/attention#softmax",
      "action-flow-decoder/action-expert-blocks/self-attention/attention#value",
      "action-flow-decoder/action-expert-blocks/self-attention/attention#composite",
    ]);
    expect(attention?.rows.map((row) => row.point.derived.status)).toEqual([
      "complete",
      "unavailable",
      "complete",
      "unavailable",
    ]);

    for (const row of [...(gemm?.rows ?? []), ...(attention?.rows ?? [])]) {
      expect(row.point.basis_id).toBe(slice.atomicBasis.basis_id);
      expect(row.point.timing).toMatchObject({
        observed_second: null,
        statistic: "analytical",
        timing_boundary_id: "interactive-analytical-envelope-all-calls",
      });
      expect(row.bandwidthCeiling.bandwidth_ceiling_id).toBe(
        "bw-thor-120w-conditional-273gbps",
      );
      expect(row.hardwareId).toBe("nvidia-jetson-agx-thor");
      expect(row.precisionPathId).toBe("bf16_dense");
      expect(row.workload).toEqual({
        executedCameraViews: 3,
        executedPromptTokens: 48,
        actionHorizon: 50,
        denoiseSteps: 10,
      });
      expect(row.timingBasis).toBe("analytical_roof");
    }

    expect(materializeCurrentPi0Roofline({
      data,
      workloadBinding: null,
      precisionPathId: "unknown-explicit-precision",
      hardwareId: "nvidia-jetson-agx-thor",
    })).toMatchObject({ status: "unavailable" });
  });
});
