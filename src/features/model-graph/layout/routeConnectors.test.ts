import { expect, it } from "vitest";
import pi0 from "../../../../data/model_graphs/pi0.json";
import type { CanonicalRecord } from "../../../types/atlas";
import { adaptV1ModelGraph } from "../domain/adaptV1ModelGraph";
import { adaptLogicalDag } from "../domain/adaptLogicalDag";
import type { GraphPresentation, LogicalDag, LogicalLayout, LogicalNode, NodeBox } from "../domain/types";
import { resolvePresentationProfile } from "../presentation/registry";
import { layoutLogicalDag } from "./paperLayout";
import { resolveConnectorHints } from "./routeConnectors";

it('routes a cache transfer through the column gap and beside its consumer', () => {
  const nodes = [
    { ref: 'cache', stageId: 'prefix' }, { ref: 'read', stageId: 'action' },
  ] as LogicalNode[];
  const dag = { nodes: new Map(nodes.map(node => [node.ref, node])), scopes: [],
    edges: [{ id: 'kv-read', source: 'cache', target: 'read', kind: 'tensor' }],
  } as unknown as LogicalDag;
  const layout = {
    nodeBoxes: new Map([
      ['cache', { x: 250, y: 400, width: 60, height: 28 }],
      ['read', { x: 440, y: 700, width: 30, height: 24 }],
    ]),
    stageBoxes: [
      { stageId: 'prefix', x: 0, y: 10, width: 340 },
      { stageId: 'action', x: 364, y: 10, width: 340 },
    ],
  } as unknown as LogicalLayout;
  const presentation = { connectorHints: [{ id: 'transfer', kind: 'cross', route: 'gutter',
    sourceSide: 'bottom', railOffset: 4, pairs: [['cache', 'read']],
  }] } as unknown as GraphPresentation;
  const result = resolveConnectorHints(dag, presentation, layout);
  expect(result.coverage.uncoveredEdgeIds).toEqual([]);
  expect(result.invalidHints).toEqual([]);
  expect(result.connectors[0]!.paths).toMatchObject([
    { path: 'M 280 428 V 436 H 356 V 690 H 455 V 700', sourceRefs: ['cache'], targetRefs: ['read'] },
  ]);
  const separateExit = { ...presentation, connectorHints: presentation.connectorHints.map(hint => ({ ...hint, sourceOffset: 6 })) };
  expect(resolveConnectorHints(dag, separateExit, layout).connectors[0]!.paths[0]!.path).toContain('V 442 H 356');
  const sideBranch: GraphPresentation = { ...presentation, connectorHints: [{ id: 'side-branch', kind: 'cache',
    route: 'right-to-top', busOffset: -20, pairs: [['cache', 'read']],
  }] };
  expect(resolveConnectorHints(dag, sideBranch, layout).connectors[0]!.paths[0]!.path)
    .toBe('M 310 414 H 318 V 680 H 455 V 700');
  const separateInput: GraphPresentation = { ...presentation, connectorHints: [{ id: 'condition-input', kind: 'rail',
    side: 'right', targetSide: 'top', pairs: [['cache', 'read']],
  }] };
  expect(resolveConnectorHints(dag, separateInput, layout).connectors[0]!.paths[0]!.path)
    .toBe('M 310 414 H 322 V 690 H 455 V 700');
});

it("routes a same-row condition into the arithmetic side while the activation enters from above", () => {
  const box = (x: number, y: number, width: number, height: number): NodeBox => ({
    x, y, width, height, compact: true, inline: false, row: 0, lane: 0,
  });
  for (const [side, condition, expected] of [
    ["right", box(160, 80, 60, 40), "M 160 100 H 110"],
    ["left", box(0, 80, 60, 40), "M 60 100 H 90"],
  ] as const) {
    const nodes = new Map([
      ["activation", box(80, 20, 40, 30)],
      ["condition", condition],
      ["multiply", box(90, 90, 20, 20)],
    ]);
    const dag = {
      nodes: new Map([...nodes.keys()].map(ref => [ref, { ref, stageId: "stage" }])),
      edges: ["activation", "condition"].map(source => ({
        id: source, source, target: "multiply", kind: "tensor",
      })),
      scopes: [],
    } as unknown as LogicalDag;
    const presentation = {
      connectorHints: [{
        id: "inputs", kind: "branch-in",
        pairs: [["activation", "multiply"], ["condition", "multiply"]],
      }],
    } as unknown as GraphPresentation;
    const layout = { nodeBoxes: nodes, stageBoxes: [] } as unknown as LogicalLayout;
    const result = resolveConnectorHints(dag, presentation, layout);
    const paths = result.connectors[0]!.paths;
    const activationPath = paths.find(path =>
      path.sourceRefs.length === 1 && path.sourceRefs[0] === "activation");
    const conditionPath = paths.find(path =>
      path.sourceRefs.length === 1 && path.sourceRefs[0] === "condition");
    expect(activationPath?.path, side).toBe("M 100 50 V 90");
    expect(conditionPath?.path, side).toBe(expected);
    expect(paths.every(path => path.arrow)).toBe(true);
    expect(result.coverage.uncoveredEdgeIds).toEqual([]);
  }
});

it("preserves every accepted Pi0 connector path", () => {
  const graph = adaptV1ModelGraph(pi0.records[0] as unknown as CanonicalRecord);
  const dag = adaptLogicalDag(graph);
  const presentation = resolvePresentationProfile(graph, dag).presentation;
  const layout = layoutLogicalDag(dag, presentation);
  const connectors = resolveConnectorHints(dag, presentation, layout).connectors;
  const serialized = JSON.stringify(connectors);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index++) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  expect(connectors).toHaveLength(53);
  expect((hash >>> 0).toString(16)).toBe("e1d5b184");
});
