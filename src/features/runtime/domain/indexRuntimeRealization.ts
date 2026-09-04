import type { LogicalRef } from "../../model-graph/domain/types";
import type { RuntimeMapping, RuntimeRealizationIndex, RuntimeRealizationRecord } from "./types";

function append(
  target: Map<string, RuntimeMapping[]>,
  key: string,
  mapping: RuntimeMapping,
) {
  const values = target.get(key) ?? [];
  values.push(mapping);
  target.set(key, values);
}

export function indexRuntimeRealization(
  record: RuntimeRealizationRecord,
): RuntimeRealizationIndex {
  const mappingsByLogicalRef = new Map<LogicalRef, RuntimeMapping[]>();
  const mappingsByGroupId = new Map<string, RuntimeMapping[]>();
  record.mappings.forEach((mapping) => {
    mapping.logicalTargets.forEach((target) => append(mappingsByLogicalRef, target.ref, mapping));
    mapping.executionGroupIds.forEach((groupId) => append(mappingsByGroupId, groupId, mapping));
  });
  return {
    groupById: new Map(record.executionGroups.map((group) => [group.executionGroupId, group])),
    mappingsByLogicalRef,
    mappingsByGroupId,
    precisionById: new Map(record.precisionPaths.map((precision) => [precision.precisionPathId, precision])),
  };
}
