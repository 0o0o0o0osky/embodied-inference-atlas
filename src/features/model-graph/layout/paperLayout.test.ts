import { describe, expect, it } from "vitest";

import type { GraphPresentation, LogicalDag, LogicalNode } from "../domain/types";
import { transformerAttentionRows } from "../presentation/templates";
import { layoutLogicalDag } from "./paperLayout";
import { resolveConnectorHints } from "./routeConnectors";

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
      edges: [
        { id: "q-attention", tensorId: "q", tensorLabel: "Q", source: `${scope}/query-projection`, target: `${scope}/attention`, kind: "tensor" },
        { id: "k-attention", tensorId: "k", tensorLabel: "K", source: `${scope}/key-projection`, target: `${scope}/attention`, kind: "tensor" },
        { id: "v-attention", tensorId: "v", tensorLabel: "V", source: `${scope}/value-projection`, target: `${scope}/attention`, kind: "tensor" },
        { id: "attention-output", tensorId: "context", tensorLabel: "Context", source: `${scope}/attention`, target: `${scope}/output-projection`, kind: "tensor" },
        { id: "output-residual", tensorId: "projected", tensorLabel: "Projected", source: `${scope}/output-projection`, target: `${scope}/attention-residual`, kind: "tensor" },
        { id: "repeat-hidden", tensorId: "next-hidden", tensorLabel: "Next hidden", source: `${scope}/attention-residual`, target: `${scope}/query-projection`, kind: "repeat" },
      ],
      scopes: [{
        id: `${stageId}/block`,
        kind: "transformer",
        label: "Generic block ×2",
        stageId,
        moduleId: "block",
        nodeRefs: nodes.map((node) => node.ref),
        repeat: 2,
      }],
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
      connectorHints: [
        {
          id: "qkv-attention",
          kind: "branch-in",
          pairs: [
            [`${scope}/query-projection`, `${scope}/attention`],
            [`${scope}/key-projection`, `${scope}/attention`],
            [`${scope}/value-projection`, `${scope}/attention`],
          ],
        },
        {
          id: "attention-residual",
          kind: "chain",
          pairs: [
            [`${scope}/attention`, `${scope}/output-projection`],
            [`${scope}/output-projection`, `${scope}/attention-residual`],
          ],
        },
      ],
    };

    const first = layoutLogicalDag(dag, presentation);
    const reorderedDag: LogicalDag = {
      ...dag,
      nodes: new Map([...dag.nodes].reverse()),
      edges: [...dag.edges].reverse(),
    };
    const second = layoutLogicalDag(reorderedDag, presentation);
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
    expect(resolveConnectorHints(dag, presentation, first).coverage).toEqual({
      truthEdgeCount: 6,
      routedEdgeIds: [
        "q-attention",
        "k-attention",
        "v-attention",
        "attention-output",
        "output-residual",
      ],
      foldedEdges: [{
        edgeId: "repeat-hidden",
        scopeId: `${stageId}/block`,
        reason: "folded-repeat-boundary",
      }],
      uncoveredEdgeIds: [],
    });
  });
});
