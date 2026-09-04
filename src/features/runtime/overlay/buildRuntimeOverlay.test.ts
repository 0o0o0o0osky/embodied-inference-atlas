import { expect, it } from "vitest";

import type { LogicalDag, LogicalLayout, LogicalNode } from "../../model-graph/domain/types";
import type { ExecutionGroup, RuntimeMapping, RuntimeRealizationRecord } from "../domain/types";
import { buildRuntimeOverlay } from "./buildRuntimeOverlay";

it("projects runtime mapping states and cross-selection without changing logical boxes", () => {
  const refs = ["stage/a", "stage/b", "stage/c", "stage/d", "stage/e", "stage/f"];
  const node = (ref: string): LogicalNode => ({
    ref, kind: "operator", stageId: "stage", moduleId: "module", componentId: null,
    operatorId: ref.at(-1)!, definitionId: "linear", label: ref, visual: "box", detail: null,
  });
  const dag: LogicalDag = {
    nodes: new Map(refs.map((ref) => [ref, node(ref)])), edges: [], scopes: [],
    stages: [{ id: "stage", label: "Stage", description: "" }], stageOrder: ["stage"], diagnostics: [],
  };
  const layout: LogicalLayout = {
    width: 600, height: 220,
    nodeBoxes: new Map(refs.map((ref, index) => [ref, {
      x: 30 + index * 90, y: index < 3 ? 40 : 130, width: 60, height: 30,
      compact: false, inline: false, row: index < 3 ? 0 : 1, lane: index,
    }])),
    stageBoxes: [], scopeBoxes: [], diagnostics: [],
  };
  const before = structuredClone([...layout.nodeBoxes]);
  const group = (id: string, kind: ExecutionGroup["kind"] = "custom_op"): ExecutionGroup => ({
    executionGroupId: id, label: id, kind, implementation: id, precisionPathId: "fp16",
    repeatSelectors: [], dependencyGroupIds: [], kernelSignatureIds: [], kernelResolution: "not_collected",
    unmappedReasonCode: null, evidenceIds: ["evidence"],
  });
  const mapping = (
    id: string, logical: string[], groups: string[], relation: RuntimeMapping["relation"],
    path: RuntimeMapping["path"] = "primary", certainty: RuntimeMapping["certainty"] = "exact",
  ): RuntimeMapping => ({
    mappingId: id, logicalTargets: logical.map((ref) => ({ ref, repeatSelectors: [] })),
    executionGroupIds: groups, relation, path, certainty, method: "source_audit",
    confidence: certainty === "ambiguous" ? "medium" : "high",
    reasonCode: certainty === "ambiguous" || path === "fallback" || relation === "eliminated" ? "fixture_reason" : null,
    evidenceIds: ["evidence"],
  });
  const realization = {
    realizationId: "rr-fixture",
    precisionPaths: [{ precisionPathId: "fp16", label: "FP16" }],
    executionGroups: [
      group("g-fused"), group("g-split-a"), group("g-split-b"),
      group("g-opaque", "opaque_region"), group("g-preserved"),
    ],
    mappings: [
      mapping("m-fused", refs.slice(0, 2), ["g-fused"], "fused"),
      mapping("m-split", [refs[2]!], ["g-split-a", "g-split-b"], "split"),
      mapping("m-eliminated", [refs[3]!], [], "eliminated"),
      mapping("m-opaque", [refs[4]!], ["g-opaque"], "opaque", "fallback", "ambiguous"),
      mapping("m-preserved", [refs[5]!], ["g-preserved"], "preserved"),
    ],
  } as unknown as RuntimeRealizationRecord;

  const fromLogical = buildRuntimeOverlay(dag, layout, realization, "logical:stage%2Fa");
  expect(fromLogical.boundaries).toEqual([
    expect.objectContaining({ groupId: "g-fused", nodeRefs: refs.slice(0, 2), precisionPathId: "fp16" }),
  ]);
  expect(fromLogical.badgesByNode.get(refs[2]!)?.map(({ kind }) => kind)).toContain("split");
  expect(fromLogical.badgesByNode.get(refs[3]!)?.map(({ kind }) => kind)).toContain("eliminated");
  expect(fromLogical.badgesByNode.get(refs[4]!)?.map(({ kind }) => kind)).toEqual(expect.arrayContaining(["opaque", "ambiguous", "fallback"]));
  expect(fromLogical.badgesByNode.get(refs[5]!)?.map(({ kind }) => kind)).toContain("preserved");
  expect(fromLogical.highlightedGroupIds).toEqual(new Set(["g-fused"]));
  expect(buildRuntimeOverlay(dag, layout, realization, "runtime-group:rr-fixture/g-fused").highlightedLogicalRefs)
    .toEqual(new Set(refs.slice(0, 2)));
  expect([...layout.nodeBoxes]).toEqual(before);
});
