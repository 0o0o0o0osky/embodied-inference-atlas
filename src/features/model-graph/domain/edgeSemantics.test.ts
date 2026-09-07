import { expect, it } from "vitest";
import type { LogicalDag, LogicalEdge } from "./types";
import { routedEdgeSemantics } from "./edgeSemantics";
import pi0Document from '../../../../data/model_graphs/pi0.json';
import type { CanonicalRecord } from '../../../types/atlas';
import { adaptV1ModelGraph } from './adaptV1ModelGraph';
import { adaptLogicalDag } from './adaptLogicalDag';
import { resolvePresentationProfile } from '../presentation/registry';
import { layoutLogicalDag } from '../layout/paperLayout';
import { resolveConnectorHints } from '../layout/routeConnectors';

const edge = (source: string, target: string, kind: LogicalEdge["kind"] = "tensor"): LogicalEdge => ({ id: `${source}/${target}`, tensorId: source, tensorLabel: source, source, target, kind });
const dag = { nodes: new Map([["control/dt", { kind: "control" }]]), edges: [
  edge("residual", "add"), edge("cache", "attention"), edge("state", "output"),
  edge("update", "state", "feedback"), edge("layer-out", "layer-in", "repeat"),
  edge("control/dt", "update"),
] } as unknown as LogicalDag;

it("keeps residual, cache and loop-state tensor paths solid regardless of routing", () => {
  const classify = routedEdgeSemantics(dag);
  for (const [source, target] of [["residual", "add"], ["cache", "attention"], ["state", "output"]]) {
    expect(classify({ sourceRefs: [source!], targetRefs: [target!] })).toBe("data");
  }
});
it("distinguishes inter-iteration feedback while preserving scalar control-value inputs as data", () => {
  const classify = routedEdgeSemantics(dag);
  for (const [source, target] of [["update", "state"], ["layer-out", "layer-in"]]) {
    expect(classify({ sourceRefs: [source!], targetRefs: [target!] })).toBe("control-iteration");
  }
  expect(classify({ sourceRefs: ["control/dt"], targetRefs: ["update"] })).toBe("data");
  expect(classify({ sourceRefs: ["unknown"], targetRefs: ["attention"] })).toBe("data");
  expect(classify({ sourceRefs: ["state", "update"], targetRefs: ["output", "state"] })).toBe("data");
});


it('preserves Pi0 cache and residual data while marking the actual Euler iteration', () => {
  const graph = adaptV1ModelGraph(pi0Document.records[0] as CanonicalRecord);
  const actualDag = adaptLogicalDag(graph);
  const presentation = resolvePresentationProfile(graph, actualDag).presentation;
  const routes = resolveConnectorHints(actualDag, presentation, layoutLogicalDag(actualDag, presentation));
  const classify = routedEdgeSemantics(actualDag);
  for (const id of ['action-key-cache', 'action-value-cache', 'action-ffn-residual']) {
    const paths = routes.connectors.find(connector => connector.id === id)!.paths;
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every(path => classify(path) === 'data')).toBe(true);
  }
  const feedback = routes.connectors.find(connector => connector.id === 'euler-feedback')!.paths;
  expect(feedback.length).toBeGreaterThan(0);
  expect(feedback.every(path => classify(path) === 'control-iteration')).toBe(true);
});
