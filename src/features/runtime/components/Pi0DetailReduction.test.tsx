import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { atlasSnapshot as atlasDocument } from '../../../testSupport/atlasSnapshot';
import type { AtlasData } from "../../../types/atlas";
import { buildTimelineView } from "../../timeline/domain/buildTimelineView";
import { adaptProfilerEvidence } from "../../profiler/domain/adaptProfilerEvidence";
import { indexProfilerEvidence } from "../../profiler/domain/indexProfilerEvidence";
import { Pi0NsysSection } from "./Pi0NsysSection";

it("keeps the Pi0 profiler overview concise while retaining evidence in disclosures", () => {
  const data = atlasDocument as unknown as AtlasData;
  const evidence = adaptProfilerEvidence(data);
  const index = indexProfilerEvidence(evidence);
  const query = { modelId: "pi0", runtimeId: "flashrt", hardwareId: "nvidia-jetson-agx-thor", entity: null };
  const timeline = buildTimelineView(data, evidence, index, { ...query, captureId: "capture-pi0-flashrt-nsys-node-001" });
  const nsysMarkup = renderToStaticMarkup(<Pi0NsysSection
    view={timeline}
    onSelectEvent={() => undefined}
    onOpenDetails={() => undefined}
  />);
  expect(nsysMarkup).toContain("预测窗口");
  expect(nsysMarkup).toContain("CPU 多线程运行累计");
  expect(nsysMarkup).toContain("各线程实际运行时间之和");

});
