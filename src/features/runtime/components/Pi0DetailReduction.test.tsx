import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { atlasSnapshot as atlasDocument } from '../../../testSupport/atlasSnapshot';
import type { AtlasData } from "../../../types/atlas";
import { buildKernelRows } from "../../performance/domain/buildKernelRows";
import { buildTimelineView } from "../../timeline/domain/buildTimelineView";
import { adaptProfilerEvidence } from "../../profiler/domain/adaptProfilerEvidence";
import { indexProfilerEvidence } from "../../profiler/domain/indexProfilerEvidence";
import { adaptRuntimeRealization } from "../domain/adaptRuntimeRealization";
import { Pi0KernelSection } from "./Pi0KernelSection";
import { Pi0NsysSection } from "./Pi0NsysSection";

it("keeps the Pi0 profiler overview concise while retaining evidence in disclosures", () => {
  const data = atlasDocument as unknown as AtlasData;
  const evidence = adaptProfilerEvidence(data);
  const index = indexProfilerEvidence(evidence);
  const query = { modelId: "pi0", runtimeId: "flashrt", hardwareId: "nvidia-jetson-agx-thor", entity: null };
  const timeline = buildTimelineView(data, evidence, index, { ...query, captureId: "capture-pi0-flashrt-nsys-node-001" });
  const kernels = buildKernelRows(data, evidence, index, query);
  const realization = adaptRuntimeRealization(data.datasets.runtime_realizations.find((record) =>
    record.model_id === "pi0" && record.runtime_id === "flashrt",
  )!);

  const nsysMarkup = renderToStaticMarkup(<Pi0NsysSection
    view={timeline}
    onSelectEvent={() => undefined}
    onOpenDetails={() => undefined}
  />);
  const kernelMarkup = renderToStaticMarkup(<Pi0KernelSection
    view={kernels}
    realization={realization}
    onOpenDetails={() => undefined}
    onOpenDag={() => undefined}
  />);

  expect(nsysMarkup).toContain("预测窗口");
  expect(nsysMarkup).toContain("CPU 多线程运行累计");
  expect(nsysMarkup).toContain("各线程实际运行时间之和");

  const primary = kernelMarkup.slice(0, kernelMarkup.indexOf("<details"));
  expect(primary).not.toContain("<table");
  expect(primary).toContain("查看融合实现图");
  const kernelDisclosure = kernelMarkup.slice(kernelMarkup.indexOf("<details"));
  expect(kernelDisclosure).toContain("历史侵入式节点采集");
  expect(kernelDisclosure).toContain("调用数");
  expect(kernelDisclosure).toContain("精度与量化");
});
