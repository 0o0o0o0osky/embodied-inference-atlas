import type { RoutePatch } from "../../../app/routes";
import type { CanonicalRecord } from "../../../types/atlas";
import { adaptLogicalDag } from "./adaptLogicalDag";
import { adaptV1ModelGraph, isV1ModelGraphRecord } from "./adaptV1ModelGraph";

export function modelSwitchPatch(
  records: readonly CanonicalRecord[],
  modelId: string,
  currentEntity: string | null,
): RoutePatch {
  const record = records.find((candidate) =>
    isV1ModelGraphRecord(candidate, modelId),
  );
  const entity = currentEntity && record
    ? adaptLogicalDag(adaptV1ModelGraph(record)).nodes.has(currentEntity)
      ? currentEntity
      : null
    : null;
  return { model: modelId, tab: "logical", entity };
}
