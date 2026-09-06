import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { atlasSnapshot as atlasDocument } from '../../testSupport/atlasSnapshot';
import type { RouteState } from "../../app/routes";
import type { AtlasData } from "../../types/atlas";
import { PerformanceView } from "./PerformanceView";

it("keeps the full Pi0 profiler register behind the Kernel summary", () => {
  const data = atlasDocument as unknown as AtlasData;
  const model = data.datasets.models.find((candidate) => candidate.model_id === "pi0")!;
  const route: RouteState = {
    model: "pi0",
    tab: "roofline-kernels",
    runtime: "flashrt",
    hardware: "nvidia-jetson-agx-thor",
    workload: "config-pi0-flashrt-nsys-node-001",
    precision: "bf16_dense",
    runtimePrecision: "mixed-fp8-e4m3-fp16",
    runtimeFacet: null,
    entity: null,
    timelineCapture: null,
    rooflineLevel: "overview",
    basis: null,
  };

  const markup = renderToStaticMarkup(
    <PerformanceView data={data} model={model} route={route} navigate={() => undefined} />,
  );
  const disclosureAt = markup.indexOf('<details class="pi0-profiler-evidence-disclosure ');
  expect(disclosureAt).toBeGreaterThan(0);

  const summary = markup.slice(0, disclosureAt);
  const disclosure = markup.slice(disclosureAt);
  expect(summary.slice(0, summary.indexOf("<details"))).toContain("NCU · Kernel 性能");
  expect(summary.slice(0, summary.indexOf("<details"))).not.toContain("Kernel 热点 Top 3");
  expect(summary.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr/g)).toHaveLength(3);
  expect(summary).not.toContain("SM throughput");
  expect(disclosure).toContain("SM throughput");
  expect(disclosure).toContain("完整 Profiler 证据");
});
