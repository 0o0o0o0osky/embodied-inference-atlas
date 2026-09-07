import { expect, it } from "vitest";
import document from "../../../../data/model_graphs/pi05.json";
import type { CanonicalRecord } from "../../../types/atlas";
import { adaptV1ModelGraph } from "../domain/adaptV1ModelGraph";
import { adaptLogicalDag } from "../domain/adaptLogicalDag";
import { layoutLogicalDag } from "../layout/paperLayout";
import { resolvePresentationProfile } from "./registry";

it("keeps Pi0.5 Q/K/V lanes and a vertical AdaRMS activation path beside the condition branch", () => {
  const graph = adaptV1ModelGraph(document.records[0] as unknown as CanonicalRecord);
  const dag = adaptLogicalDag(graph);
  const layout = layoutLogicalDag(dag, resolvePresentationProfile(graph, dag).presentation);
  const center = (ref: string) => { const box = layout.nodeBoxes.get(ref)!; return box.x + box.width / 2; };
  for (const scope of ["prefix-encoder/prefix-blocks/self-attention", "action-flow-decoder/action-expert-blocks/self-attention"]) {
    expect(center(`${scope}/query-projection`)).toBeCloseTo(center(`${scope}/query-rope`));
    expect(center(`${scope}/key-projection`)).toBeCloseTo(center(`${scope}/key-rope`));
    expect(center(`${scope}/query-projection`)).toBeLessThan(center(`${scope}/key-projection`));
    expect(center(`${scope}/key-projection`)).toBeLessThan(center(`${scope}/value-projection`));
  }
  for (const module of ["attention-adarms", "mlp-adarms"]) {
    const scope = `action-flow-decoder/action-expert-blocks/${module}`;
    const activation = ["rms-norm", "scale-product", "scale-offset", "shift-add"];
    expect(new Set(activation.map(id => center(`${scope}/${id}`))).size).toBe(1);
    expect(center(`${scope}/condition-projection`)).toBeGreaterThan(center(`${scope}/rms-norm`));
    for (const id of ["scale-slice", "shift-slice", "gate-slice"]) {
      expect(center(`${scope}/${id}`)).toBeGreaterThan(center(`${scope}/scale-product`));
    }
  }
  expect(layout.nodeBoxes.size).toBe(dag.nodes.size);
  const expert = "action-flow-decoder/action-expert-blocks";
  const main = center(`${expert}/attention-adarms/rms-norm`);
  for (const ref of [
    `${expert}/self-attention/attention`, `${expert}/self-attention/output-projection`,
    `${expert}/attention-gated-residual/residual-gate`, `${expert}/attention-gated-residual/residual-add`,
    `${expert}/mlp-adarms/rms-norm`, `${expert}/feed-forward/down-projection`,
    `${expert}/mlp-gated-residual/residual-gate`, `${expert}/mlp-gated-residual/residual-add`,
    "action-flow-decoder/velocity-projection/final-rms-norm", "action-flow-decoder/velocity-projection/velocity-projection",
  ]) expect(center(ref)).toBeCloseTo(main);
  for (const module of ['attention', 'mlp']) {
    const slice = layout.nodeBoxes.get(`${expert}/${module}-adarms/gate-slice`)!;
    const consumer = layout.nodeBoxes.get(`${expert}/${module}-gated-residual/residual-gate`)!;
    expect(slice.row).toBe(consumer.row);
  }
  for (const [scope, prefix] of [
    [`${expert}/attention-adarms`, ""],
    [`${expert}/mlp-adarms`, ""],
    ["action-flow-decoder/velocity-projection", "final-"],
  ]) {
    const boxes = ["rms-norm", "scale-product", "scale-offset", "shift-add"]
      .map(id => layout.nodeBoxes.get(`${scope}/${prefix}${id}`)!);
    // Each adaptive norm stays a compact unit, with room for downward arrows.
    expect(boxes.at(-1)!.y + boxes.at(-1)!.height - boxes[0]!.y).toBeLessThan(140);
    boxes.slice(1).forEach((box, index) => {
      const above = boxes[index]!;
      expect(box.y - above.y - above.height).toBeGreaterThanOrEqual(10);
      expect(box.x + box.width / 2).toBeCloseTo(main);
    });
  }
  expect(layout.rowLabels?.map(item => item.label)).toEqual(['动作与时间输入', '注意力子层', '前馈子层', '动作输出']);
});
