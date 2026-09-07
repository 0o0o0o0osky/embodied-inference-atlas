import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import pi0Document from "../../../../data/model_graphs/pi0.json";
import type { CanonicalRecord } from "../../../types/atlas";
import { adaptV1ModelGraph } from "../domain/adaptV1ModelGraph";
import { OperatorDrawer, OperatorDrawerView, type OperatorDrawerTab } from "./OperatorDrawer";

it("renders only the controlled active panel with matching accessible tab controls", () => {
  const graph = adaptV1ModelGraph(pi0Document.records[0] as CanonicalRecord);
  const operator = [...graph.operatorsByRef.values()].find((item) => item.visualizer === "gemm")!;
  let closed = 0;
  const props = { operator, resetKey: operator.ref, onClose: () => { closed += 1; } };
  const overview = renderToStaticMarkup(<OperatorDrawer {...props} />);
  expect(overview.match(/role="tabpanel"/g)).toHaveLength(1);
  expect(overview).toContain('data-panel="overview"');
  expect(overview.match(/aria-selected="true"/g)).toHaveLength(1);
  expect(overview).not.toContain("gemm-computation");
  expect(overview).toContain("<details");
  expect(overview).not.toMatch(/<details[^>]*\bopen/);

  expect(overview).not.toContain("实测 Kernel");
  expect(overview.match(/role="tab"/g)).toHaveLength(3);
  expect(overview).not.toContain(operator.ref);
  expect(overview).not.toContain("符号、定义来源与分析");
  for (const activeTab of ["calculation", "roofline"] as OperatorDrawerTab[]) {
    const markup = renderToStaticMarkup(<OperatorDrawerView {...props} activeTab={activeTab} onTabChange={() => undefined} />);
    expect(markup.match(/role="tabpanel"/g)).toHaveLength(1);
    expect(markup).toContain(`data-panel="${activeTab}"`);
    expect(markup).toContain(`aria-labelledby="operator-tab-${activeTab}"`);
    expect(markup.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(markup).not.toContain('data-panel="overview"');
    expect(markup.includes("gemm-computation")).toBe(activeTab === "calculation");
    expect(markup).not.toContain('class="operator-overview"');
    expect(markup).toContain('class="operator-inspector-close"');
  }
  expect(closed).toBe(0); // Server rendering never invokes event callbacks.
});
