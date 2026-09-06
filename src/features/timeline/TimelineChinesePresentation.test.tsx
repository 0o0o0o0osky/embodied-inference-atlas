import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { atlasSnapshot as atlasDocument } from '../../testSupport/atlasSnapshot';
import type { RouteState } from "../../app/routes";
import type { AtlasData } from "../../types/atlas";
import { TimelineView } from "./TimelineView";

it("keeps the Pi0 Nsys detail focused on a localized timeline and folds evidence ledgers", () => {
  const data = atlasDocument as unknown as AtlasData;
  const model = data.datasets.models.find((item) => item.model_id === "pi0")!;
  const route: RouteState = {
    model: "pi0",
    tab: "timeline",
    runtime: "flashrt",
    hardware: "nvidia-jetson-agx-thor",
    workload: "config-pi0-flashrt-nsys-node-001",
    precision: "bf16_dense",
    runtimePrecision: "mixed-fp8-e4m3-fp16",
    runtimeFacet: null,
    entity: null,
    timelineCapture: "capture-pi0-flashrt-nsys-node-001",
    rooflineLevel: "overview",
    basis: null,
  };

  const markup = renderToStaticMarkup(
    <TimelineView data={data} model={model} route={route} navigate={() => undefined} />,
  );

  expect(markup).toContain("Nsys 时间线");
  expect(markup).toContain("已记录时间线");
  expect(markup).toContain("空白为未观测区间，不代表空闲。");
  expect(markup).not.toContain("Prediction timing instrument");
  expect(markup).toContain('<details class="timeline-capture-archive">');
  expect(markup).not.toContain('type="range"');
  expect(markup).not.toContain('timeline-replay');
  expect(markup).toContain('<details class="timeline-summary timeline-summary--disclosure">');
});
