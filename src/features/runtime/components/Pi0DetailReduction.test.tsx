import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import atlasDocument from "../../../../site/assets/data/atlas-data.json";
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
  const timeline = buildTimelineView(data, evidence, index, { ...query, captureId: null });
  const kernels = buildKernelRows(data, evidence, index, query);
  const realization = adaptRuntimeRealization(data.datasets.runtime_realizations.find((record) =>
    record.model_id === "pi0" && record.runtime_id === "flashrt",
  )!);

  const nsysMarkup = renderToStaticMarkup(<Pi0NsysSection
    view={timeline}
    onCaptureChange={() => undefined}
    onSelectEvent={() => undefined}
    onOpenDetails={() => undefined}
  />);
  const kernelMarkup = renderToStaticMarkup(<Pi0KernelSection
    view={kernels}
    realization={realization}
    onOpenDetails={() => undefined}
    onOpenDag={() => undefined}
  />);

  const nsysDisclosure = nsysMarkup.match(/<details[\s\S]*?<\/details>/)?.[0] ?? "";
  expect(nsysMarkup.slice(0, nsysMarkup.indexOf("<details"))).toContain("预测窗口");
  expect(nsysDisclosure).toContain("展开 Nsys 摘要");
  expect(nsysDisclosure).toContain("CPU 调度核时");

  const primaryKernelTable = kernelMarkup.match(/<table[\s\S]*?<\/table>/)?.[0] ?? "";
  expect(primaryKernelTable).not.toContain("调用数");
  expect(primaryKernelTable).not.toContain("NCU 状态");
  expect(primaryKernelTable.match(/<tr/g)).toHaveLength(4);
  const kernelDisclosure = kernelMarkup.match(/<details[\s\S]*?<\/details>/)?.[0] ?? "";
  expect(kernelDisclosure).toContain("展开 Kernel 摘要");
  expect(kernelDisclosure).toContain("调用数");
  expect(kernelDisclosure).toContain("精度与量化");
  expect(kernelDisclosure).toContain("查看完整实现图");
});
