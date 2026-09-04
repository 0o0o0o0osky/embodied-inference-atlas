import { describe, expect, it } from "vitest";

import type { GraphPresentation, LogicalDag, LogicalNode } from "../domain/types";
import { transformerAttentionRows } from "../presentation/templates";
import { layoutLogicalDag } from "./paperLayout";

const stageId = "generic-transformer";
const scope = `${stageId}/block/attention`;

function operator(operatorId: string, label: string): LogicalNode {
  return {
    ref: `${scope}/${operatorId}`,
    kind: "operator",
    stageId,
    moduleId: "block",
    componentId: "attention",
    operatorId,
    definitionId: operatorId === "attention" ? "attention-core" : "linear",
    label,
    visual: "box",
    detail: null,
  };
}

describe("paper transformer layout", () => {
  it("keeps Q/K/V parallel and the attention path downstream in a deterministic layout", () => {
    const nodes = [
      operator("query-projection", "Query projection"),
      operator("key-projection", "Key projection"),
      operator("value-projection", "Value projection"),
      operator("attention", "Attention"),
      operator("output-projection", "Output projection"),
      {
        ...operator("attention-residual", "Residual add"),
        definitionId: "residual-add",
        visual: "inline" as const,
      },
    ];
    const dag: LogicalDag = {
      nodes: new Map(nodes.map((node) => [node.ref, node])),
      edges: [],
      scopes: [],
      stages: [{ id: stageId, label: "Generic Transformer", description: "" }],
      stageOrder: [stageId],
      diagnostics: [],
    };
    const presentation: GraphPresentation = {
      rowsByStage: {
        [stageId]: transformerAttentionRows(scope, { includeNorm: false }),
      },
      boundaryLanes: {},
      aliases: {},
      visualOverrides: {},
      connectorHints: [],
    };

    const first = layoutLogicalDag(dag, presentation);
    const second = layoutLogicalDag(dag, presentation);
    const query = first.nodeBoxes.get(`${scope}/query-projection`);
    const key = first.nodeBoxes.get(`${scope}/key-projection`);
    const value = first.nodeBoxes.get(`${scope}/value-projection`);
    const attention = first.nodeBoxes.get(`${scope}/attention`);
    const output = first.nodeBoxes.get(`${scope}/output-projection`);
    const residual = first.nodeBoxes.get(`${scope}/attention-residual`);

    expect(query?.y).toBe(key?.y);
    expect(key?.y).toBe(value?.y);
    expect(new Set([query?.x, key?.x, value?.x]).size).toBe(3);
    expect(attention!.y).toBeGreaterThan(query!.y);
    expect(output!.y).toBeGreaterThan(attention!.y);
    expect(residual!.y).toBeGreaterThan(output!.y);
    expect([...second.nodeBoxes]).toEqual([...first.nodeBoxes]);
  });
});
