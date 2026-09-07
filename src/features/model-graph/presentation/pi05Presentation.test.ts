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
  expect(layout.height).toBeLessThan(2000);
});
