import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import pi0 from "../../../../data/model_graphs/pi0.json";
import pi05 from "../../../../data/model_graphs/pi05.json";
import smolvla from "../../../../data/model_graphs/smolvla.json";
import type { CanonicalRecord } from "../../../types/atlas";
import { adaptV1ModelGraph } from "../domain/adaptV1ModelGraph";
import { OperatorDrawerView } from "../components/OperatorDrawer";
import { modelDisplayText } from "./ModelDisplay";
import { operatorTitle } from "./operatorTitle";

const graphs = [pi0, pi05, smolvla].map(document => adaptV1ModelGraph(document.records[0] as CanonicalRecord));

it("names matching roles consistently across models and keeps time-only projection distinct", () => {
  for (const graph of graphs) {
    const title = (ref: string) => operatorTitle(graph.operatorsByRef.get(ref)!, text => modelDisplayText(graph.modelId, text));
    const attention = "prefix-encoder/prefix-blocks/self-attention";
    expect(title(`${attention}/query-projection`)).toBe("Q projection");
    expect(title(`${attention}/attention-norm`)).toBe("Attention RMSNorm");
    expect(title(`${attention}/output-projection`)).toBe("Attention output projection");
    expect(title("vision-encoder/vision-blocks/feed-forward/mlp-up-projection"))
      .toBe(title("prefix-encoder/prefix-blocks/feed-forward/up-projection"));
    expect(title("action-flow-decoder/action-suffix-builder/time-mlp-in"))
      .toBe(`${graph.modelId === "pi05" ? "Time" : "Action/time"} MLP input projection`);
    if (graph.modelId === "pi05") {
      expect(title("action-flow-decoder/action-expert-blocks/attention-adarms/scale-product"))
        .toBe("RMSNorm × scale");
      expect(title("action-flow-decoder/action-expert-blocks/attention-adarms/scale-offset"))
        .toBe("RMSNorm residual addition");
    }
  }
});

it("renders actual slice formulas in both detail panels instead of the generic source definition", () => {
  for (const [index, ref, title, formula] of [
    [1, "action-flow-decoder/action-expert-blocks/attention-adarms/shift-slice", "Select shift", "shift = X[:, 1024:2048]"],
    [2, "public-output/public-action-slice/public-action-slice", "Public action selection", "Y = X[:, :, 0:6]"],
  ] as const) {
    const operator = graphs[index]!.operatorsByRef.get(ref)!;
    for (const activeTab of ["overview", "calculation"] as const) {
      const html = renderToStaticMarkup(<OperatorDrawerView operator={operator} resetKey={ref}
        onClose={() => {}} activeTab={activeTab} onTabChange={() => {}} />);
      expect(html).toContain(`id="operator-title">${title}</h2>`);
      expect(html).toContain(formula);
      expect(html).not.toContain("select a declared range");
    }
  }
});
