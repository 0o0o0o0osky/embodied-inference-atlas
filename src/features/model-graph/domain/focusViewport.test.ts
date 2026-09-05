import { describe, expect, it } from "vitest";

import pi0GraphDocument from "../../../../data/model_graphs/pi0.json";
import type { CanonicalRecord } from "../../../types/atlas";
import { adaptLogicalDag } from "./adaptLogicalDag";
import { adaptV1ModelGraph } from "./adaptV1ModelGraph";
import { resolveFocusViewport } from "./focusViewport";
import { layoutLogicalDag } from "../layout/paperLayout";
import { pi0Presentation } from "../presentation/pi0Presentation";

describe("resolveFocusViewport", () => {
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
