import { expect, it } from "vitest";
import pi0 from "../../../../data/model_graphs/pi0.json";
import pi05 from "../../../../data/model_graphs/pi05.json";
import smolvla from "../../../../data/model_graphs/smolvla.json";
import type { CanonicalRecord } from "../../../types/atlas";
import { adaptV1ModelGraph } from "../domain/adaptV1ModelGraph";
import { slicePresentation } from "./slicePresentation";

const graphs = [pi0, pi05, smolvla].map(document =>
  adaptV1ModelGraph(document.records[0] as unknown as CanonicalRecord));

it("explains each declared slice with its actual axis and range", () => {
  const expected = [
    ["X[0, :, :, :, :]", "X[1, :, :, :, :]", "X[:, 1:51, :]"],
    ["X[:, 0:1024]", "X[:, 1024:2048]", "X[:, 2048:3072]",
      "X[:, 0:1024]", "X[:, 1024:2048]", "X[:, 2048:3072]",
      "X[:, 0:1024]", "X[:, 1024:2048]", "X[:, :, 0:32]"],
    ["X[0, :, :, :, :]", "X[0, :, :, :, :]", "X[1, :, :, :, :]", "X[1, :, :, :, :]", "X[:, :, 0:6]"],
  ];
  graphs.forEach((graph, index) => {
    const slices = [...graph.operatorsByRef.values()].filter(operator => operator.definitionId === "slice");
    expect(slices).toHaveLength(expected[index]!.length);
    slices.forEach((operator, sliceIndex) => {
      const result = slicePresentation(operator)!;
      expect(result.formula, operator.ref).toContain(expected[index]![sliceIndex]);
      expect(result.explanation).not.toContain("范围待补充");
    });
  });
  const head = graphs[1]!.operatorsByRef.get("action-flow-decoder/velocity-projection/final-shift-slice")!;
  expect(slicePresentation(head)!.explanation).toContain("长度为 3 × D 的条件向量");
});

it("does not infer a slice offset from a coincident shape or unknown operator name", () => {
  const known = graphs[0]!.operatorsByRef.get("action-flow-decoder/velocity-euler-update/select-action-rows")!;
  expect(slicePresentation({ ...known, ref: "new-model/component/select-action-rows", operatorId: "new-id" })!.formula).toBe(slicePresentation(known)!.formula);
  expect(slicePresentation({ ...known, slice: undefined })!.explanation).toContain("范围待补充");
  expect(slicePresentation({ ...known, definitionId: "reshape" })).toBeNull();
  const changed = graphs[1]!.operatorsByRef.get("action-flow-decoder/action-expert-blocks/attention-adarms/scale-slice")!;
  expect(slicePresentation({ ...changed, scopeBindings: { ...changed.scopeBindings, D: 512 } })!.explanation)
    .toContain("范围待补充");
});

it("validates generic step and leading-index slices independently of model identity", () => {
  const base=graphs[0]!.operatorsByRef.get("action-flow-decoder/velocity-euler-update/select-action-rows")!;
  const input={...base.inputs[0]!,tensor:{...base.inputs[0]!.tensor!,shape:[1,6,4]}};
  const output={...base.outputs[0]!,tensor:{...base.outputs[0]!.tensor!,shape:[1,3,4]}};
  const generic={...base,ref:"new/slice",inputs:[input],outputs:[output],slice:{axis:1,start:0,stop:6,step:2,drop_axis:false,output_symbol:"Y",explanation:"每隔一个元素读取。"}};
  expect(slicePresentation(generic)?.formula).toBe("Y = X[:, 0:6:2, :]");
  expect(slicePresentation({...generic,slice:{...generic.slice,step:0}})?.axis).toBeNull();
  expect(slicePresentation({...generic,slice:{...generic.slice,stop:7}})?.axis).toBeNull();
  expect(slicePresentation({...generic,outputs:[{...output,tensor:{...output.tensor,shape:[1,2,4]}}]})?.axis).toBeNull();
});
