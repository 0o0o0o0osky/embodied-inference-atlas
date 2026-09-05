import { describe, expect, it } from "vitest";

import pi0GraphDocument from "../../../../data/model_graphs/pi0.json";
import type { CanonicalRecord } from "../../../types/atlas";
import { adaptLogicalDag } from "./adaptLogicalDag";
import { adaptV1ModelGraph } from "./adaptV1ModelGraph";
import { resolveFocusViewport } from "./focusViewport";
import { layoutLogicalDag } from "../layout/paperLayout";
import { pi0Presentation } from "../presentation/pi0Presentation";
import type { LogicalDag, LogicalLayout, LogicalNode } from "./types";

function focusOperator(ref: string): LogicalNode {
  return {
    ref,
    kind: "operator",
    stageId: "stage",
    moduleId: "module",
    componentId: null,
    operatorId: "operator",
    definitionId: "linear",
    label: "Operator",
    visual: "box",
    detail: null,
  };
}

describe("resolveFocusViewport", () => {
  it("adds fixed padding on unconstrained focus edges", () => {
    const ref = "stage/module/operator";
    const dag: LogicalDag = {
      nodes: new Map([[ref, focusOperator(ref)]]),
      edges: [],
      scopes: [{
        id: "stage/module",
        kind: "module",
        label: "Module",
        stageId: "stage",
        moduleId: "module",
        nodeRefs: [ref],
        repeat: 1,
      }],
      stages: [],
      stageOrder: [],
      diagnostics: [],
    };
    const layout: LogicalLayout = {
      width: 1_000,
      height: 500,
      nodeBoxes: new Map([[ref, {
        x: 400, y: 200, width: 200, height: 100, compact: false, inline: false, row: 0, lane: 0,
      }]]),
      stageBoxes: [],
      scopeBoxes: [{
        scopeId: "stage/module",
        x: 400,
        y: 200,
        width: 200,
        height: 100,
        headerHeight: 20,
        contentTop: 220,
        headerBottom: 220,
      }],
      diagnostics: [],
    };

    const focus = resolveFocusViewport(dag, layout, ref);

    expect(focus.y).toBe(152);
    expect(focus.y + focus.height).toBe(348);
  });

  it("keeps Pi0 overview full-width and frames an operator scope with its direct context", () => {
    const dag = adaptLogicalDag(adaptV1ModelGraph(pi0GraphDocument.records[0] as CanonicalRecord));
    const layout = layoutLogicalDag(dag, pi0Presentation);
    const scope = dag.scopes
      .filter((candidate) => (
        candidate.nodeRefs.some((ref) => dag.nodes.get(ref)?.kind === "operator")
        && layout.scopeBoxes.some((box) => box.scopeId === candidate.id)
      ))
      .sort((first, second) => first.nodeRefs.length - second.nodeRefs.length)[0]!;
    const selectedRef = scope.nodeRefs.find((ref) => dag.nodes.get(ref)?.kind === "operator")!;
    const scopeBox = layout.scopeBoxes.find((box) => box.scopeId === scope.id)!;
    const neighborRefs = dag.edges
      .filter((edge) => edge.source === selectedRef || edge.target === selectedRef)
      .flatMap((edge) => [edge.source, edge.target]);
    const contextBoxes = neighborRefs
      .map((ref) => layout.nodeBoxes.get(ref))
      .filter((box): box is NonNullable<typeof box> => Boolean(box));

    expect(dag.nodes.get(selectedRef)?.kind).toBe("operator");
    expect(scope.nodeRefs).toContain(selectedRef);

    expect(resolveFocusViewport(dag, layout, null)).toEqual({
      x: 0,
      y: 0,
      width: layout.width,
      height: layout.height,
      scopeId: null,
    });

    const focus = resolveFocusViewport(dag, layout, selectedRef);

    expect(focus.scopeId).toBe(scope.id);
    expect(focus.x).toBeLessThanOrEqual(scopeBox.x);
    expect(focus.y).toBeLessThanOrEqual(scopeBox.y);
    expect(focus.x + focus.width).toBeGreaterThanOrEqual(scopeBox.x + scopeBox.width);
    expect(focus.y + focus.height).toBeGreaterThanOrEqual(scopeBox.y + scopeBox.height);
    for (const box of contextBoxes) {
      expect(focus.x).toBeLessThanOrEqual(box.x);
      expect(focus.y).toBeLessThanOrEqual(box.y);
      expect(focus.x + focus.width).toBeGreaterThanOrEqual(box.x + box.width);
      expect(focus.y + focus.height).toBeGreaterThanOrEqual(box.y + box.height);
    }
    expect(focus.x).toBeGreaterThanOrEqual(0);
    expect(focus.y).toBeGreaterThanOrEqual(0);
    expect(focus.x + focus.width).toBeLessThanOrEqual(layout.width);
    expect(focus.y + focus.height).toBeLessThanOrEqual(layout.height);
  });
});
