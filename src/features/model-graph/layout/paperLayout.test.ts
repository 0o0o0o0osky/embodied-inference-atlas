import { pathCrossesNodes, routeAroundNodes } from "./obstacleRouting";
import pi0Document from "../../../../data/model_graphs/pi0.json";
import pi05Document from "../../../../data/model_graphs/pi05.json";
import smolDocument from "../../../../data/model_graphs/smolvla.json";
import type { CanonicalRecord } from "../../../types/atlas";
import { adaptV1ModelGraph } from "../domain/adaptV1ModelGraph";
import { adaptLogicalDag } from "../domain/adaptLogicalDag";
import { resolvePresentationProfile } from "../presentation/registry";
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

it("groups public output below the action stage without changing logical identities or edge coverage", () => {
  for (const document of [pi05Document, smolDocument]) {
    const graph = adaptV1ModelGraph(document.records[0] as unknown as CanonicalRecord);
    const dag = adaptLogicalDag(graph);
    const presentation = resolvePresentationProfile(graph, dag).presentation;
    const layout = layoutLogicalDag(dag, presentation);
    expect(layout.width).toBe(1080);
    expect(layout.stageBoxes.map(box => box.stageId)).toEqual(["vision-encoder", "prefix-encoder", "action-flow-decoder"]);
    expect(layout.diagnostics).toEqual([]);
    expect(layout.nodeBoxes.size).toBe(dag.nodes.size);
    const publicRef = "public-output/public-action-slice/public-action-slice";
    expect(dag.nodes.get(publicRef)?.stageId).toBe("public-output");
    const action = layout.stageBoxes[2]!;
    const publicBox = layout.nodeBoxes.get(publicRef)!;
    const actionOperators = [...dag.nodes.values()].filter(node => node.stageId === "action-flow-decoder" && node.kind === "operator");
    expect(publicBox.y).toBeGreaterThan(Math.max(...actionOperators.map(node => layout.nodeBoxes.get(node.ref)!.y)));
    expect(publicBox.x).toBeGreaterThan(action.x);
    expect(publicBox.x + publicBox.width).toBeLessThan(action.x + action.width);
    const routes = resolveConnectorHints(dag, presentation, layout);
    expect(routes.coverage.uncoveredEdgeIds).toEqual([]);
    for (const connector of routes.connectors) for (const path of connector.paths) {
      const obstacles = [...layout.nodeBoxes].filter(([ref]) =>
        !path.sourceRefs.includes(ref) && !path.targetRefs.includes(ref)).map(([, box]) => box);
      expect(pathCrossesNodes(path.path, obstacles), `${graph.modelId}: ${connector.id}`).toBe(false);
    }
    const denoise = dag.scopes.find(scope => scope.kind === "denoise");
    const loopBox = layout.scopeBoxes.find(box => box.scopeId === denoise?.id);
    expect(publicBox.y).toBeGreaterThan(loopBox!.y + loopBox!.height);
    expect(routes.connectors.every(connector => connector.paths.every(path => !path.path.includes("NaN")))).toBe(true);
  }
});
it("keeps the accepted Pi0 geometry byte-for-byte", () => {
  const graph = adaptV1ModelGraph(pi0Document.records[0] as unknown as CanonicalRecord);
  const dag = adaptLogicalDag(graph);
  const layout = layoutLogicalDag(dag, resolvePresentationProfile(graph, dag).presentation);
  const source = [...layout.nodeBoxes].sort(([a], [b]) => a.localeCompare(b))
    .map(([ref, box]) => `${ref}@${box.x},${box.y},${box.width},${box.height}`).join("|");
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) { hash ^= source.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  expect(`${layout.width}x${layout.height}:${layout.nodeBoxes.size}:${(hash >>> 0).toString(16)}`).toBe("1080x1498:75:29090707");
});

it("ends obstacle fallback at the node edge with a nonzero perpendicular segment", () => {
  const box = (x: number, y: number) => ({ x, y, width: 40, height: 20, compact: false, inline: false, row: 0, lane: 0 });
  const source = box(20, 20), target = box(20, 100);
  const layout = { nodeBoxes: new Map([["source", source], ["target", target]]) } as unknown as Parameters<typeof routeAroundNodes>[2];
  expect(routeAroundNodes(source, target, layout)).toBe("M 40 40 V 100");
  const shifted = box(100, 100);
  const path = routeAroundNodes(source, shifted, { ...layout, nodeBoxes: new Map([["source", source], ["target", shifted]]) })!;
  let x = 0, y = 0, dx = 0, dy = 0;
  for (const part of path.match(/[MHV][^MHV]*/g)!) {
    const [a, b] = part.slice(1).trim().split(/\s+/).map(Number);
    const nextX = part[0] === "V" ? x : a!, nextY = part[0] === "H" ? y : part[0] === "V" ? a! : b!;
    if (part[0] !== "M") expect(Math.abs(nextX - x) + Math.abs(nextY - y)).toBeGreaterThan(0);
    dx = nextX - x; dy = nextY - y; x = nextX; y = nextY;
  }
  if (y === shifted.y) expect(dx === 0 && dy > 0).toBe(true);
  else if (y === shifted.y + shifted.height) expect(dx === 0 && dy < 0).toBe(true);
  else if (x === shifted.x) expect(dy === 0 && dx > 0).toBe(true);
  else expect(x === shifted.x + shifted.width && dy === 0 && dx < 0).toBe(true);
});
