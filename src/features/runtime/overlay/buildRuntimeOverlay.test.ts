import { expect, it } from "vitest";

import { readRoute, routeHref } from "../../../app/routes";
import type { LogicalDag, LogicalLayout, LogicalNode } from "../../model-graph/domain/types";
import { placeRuntimeLabel } from "../components/RuntimeOverlay";
import type { ExecutionGroup, RuntimeMapping, RuntimeRealizationRecord } from "../domain/types";
import { buildRuntimeOverlay } from "./buildRuntimeOverlay";

it("projects runtime states without altering or obscuring fixed logical geometry", () => {
  const refs = ["stage/a", "stage/gate", "stage/c", "stage/d", "stage/e", "stage/f", "stage/g", "stage/h"];
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
      x: 30 + (index % 4) * 110, y: index < 4 ? 40 : 130, width: 60, height: 30,
      compact: false, inline: false, row: index < 4 ? 0 : 1, lane: index,
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
      { ...group("g-unmapped"), unmappedReasonCode: "extra_layer_work" },
    ],
    mappings: [
      mapping("m-fused", [refs[0]!, refs[2]!, refs[4]!], ["g-fused"], "fused"),
      mapping("m-split", [refs[3]!], ["g-split-a", "g-split-b"], "split"),
      mapping("m-eliminated", [refs[5]!], [], "eliminated"),
      mapping("m-opaque", [refs[6]!], ["g-opaque"], "opaque", "fallback", "ambiguous"),
      mapping("m-preserved", [refs[7]!], ["g-preserved"], "preserved"),
    ],
  } as unknown as RuntimeRealizationRecord;

  const fromLogical = buildRuntimeOverlay(dag, layout, realization, "logical:stage%2Fa");
  const vertical = { ...realization, mappings: [mapping("m-vertical", [refs[0]!, refs[4]!], ["g-fused"], "fused")] };
  expect(buildRuntimeOverlay(dag, layout, vertical, null).boundaries.map((item) => item.nodeRefs)).toEqual([[refs[0], refs[4]]]);
  expect(fromLogical.boundaries.map(({ nodeRefs }) => nodeRefs)).toEqual([[refs[0]], [refs[2]], [refs[4]]]);
  expect(fromLogical.boundaries.every(({ precisionPathId }) => precisionPathId === "fp16")).toBe(true);
  expect(fromLogical.badgesByNode.get(refs[3]!)?.map(({ kind }) => kind)).toContain("split");
  expect(fromLogical.badgesByNode.get(refs[5]!)?.map(({ kind }) => kind)).toContain("eliminated");
  expect(fromLogical.badgesByNode.get(refs[6]!)?.map(({ kind }) => kind)).toEqual(expect.arrayContaining(["opaque", "ambiguous", "fallback"]));
  expect(fromLogical.badgesByNode.get(refs[7]!)?.map(({ kind }) => kind)).toContain("preserved");
  expect(fromLogical.highlightedGroupIds).toEqual(new Set(["g-fused"]));
  expect(buildRuntimeOverlay(dag, layout, realization, "runtime-group:rr-fixture/g-fused").highlightedLogicalRefs)
    .toEqual(new Set([refs[0], refs[2], refs[4]]));
  expect(buildRuntimeOverlay(dag, layout, realization, "runtime-group:rr-fixture/g-unmapped").highlightedLogicalRefs)
    .toEqual(new Set());
  expect([...layout.nodeBoxes]).toEqual(before);
  const route = readRoute("?model=pi0&tab=runtime&precision=dense-bf16&runtimePrecision=uniform-fp16");
  expect(routeHref(route, { tab: "logical" })).toContain("precision=dense-bf16&runtimePrecision=uniform-fp16");
  const blocked = { ...layout, width: 320, height: 220 };
  const blockers = [{ x: 0, y: 0, width: 320, height: 220 }];
  expect(placeRuntimeLabel({ x: 100, y: 100, width: 60, height: 30 }, 190, blocked, blockers)).toBeNull();
  expect(placeRuntimeLabel(
    { x: 100, y: 100, width: 60, height: 30 }, 80, blocked,
    [{ x: 0, y: 0, width: 95, height: 220 }], true,
  )).toBeNull();
});
