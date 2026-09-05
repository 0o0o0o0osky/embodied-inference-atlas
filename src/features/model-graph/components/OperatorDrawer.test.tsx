import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import pi0Document from "../../../../data/model_graphs/pi0.json";
import type { CanonicalRecord } from "../../../types/atlas";
import { adaptV1ModelGraph } from "../domain/adaptV1ModelGraph";
import { OperatorDrawer, OperatorDrawerView, type OperatorDrawerTab } from "./OperatorDrawer";

function buttonIn(tree: ReactNode, label: string): ReactElement<{ onClick: () => void }> {
  const found: ReactElement<{ onClick: () => void }>[] = [];
  function visit(node: ReactNode) {
    Children.forEach(node, (child) => {
      if (!isValidElement<{ children?: ReactNode; onClick: () => void }>(child)) return;
      if (child.type === "button" && child.props.children === label) found.push(child);
      visit(child.props.children);
    });
  }
  visit(tree);
  expect(found).toHaveLength(1);
  return found[0]!;
}

it("mounts only the selected panel and wires tab selection and close to their controls", () => {
  const graph = adaptV1ModelGraph(pi0Document.records[0] as CanonicalRecord);
  const operator = [...graph.operatorsByRef.values()].find((item) => item.visualizer === "gemm")!;
  let closed = 0;
  const props = { operator, resetKey: operator.ref, onClose: () => { closed += 1; } };
  const overview = renderToStaticMarkup(<OperatorDrawer {...props} />);
  expect(overview.match(/role="tabpanel"/g)).toHaveLength(1);
  expect(overview).toContain('data-panel="overview"');
  expect(overview.match(/aria-selected="true"/g)).toHaveLength(1);
  expect(overview).not.toContain("gemm-visualizer");
  expect(overview).toContain("<details");
  expect(overview).not.toMatch(/<details[^>]*\bopen/);

  let activeTab: OperatorDrawerTab = "overview";
  const view = () => OperatorDrawerView({ ...props, activeTab, onTabChange: (tab) => { activeTab = tab; } });
  buttonIn(view(), "计算过程").props.onClick();
  const calculation = renderToStaticMarkup(view());
  expect(calculation.match(/role="tabpanel"/g)).toHaveLength(1);
  expect(calculation).toContain('data-panel="calculation"');
  expect(calculation).toContain("gemm-visualizer");
  expect(calculation).not.toContain('data-panel="overview"');
  expect(calculation).not.toContain("<details");
  for (const label of ["Roofline", "实测 Kernel"]) {
    buttonIn(view(), label).props.onClick();
    const evidence = renderToStaticMarkup(view());
    expect(evidence.match(/role="tabpanel"/g)).toHaveLength(1);
    expect(evidence).not.toContain("gemm-visualizer");
    expect(evidence).not.toContain("<details");
  }
  buttonIn(view(), "返回完整模型").props.onClick();
  expect(closed).toBe(1);
});
