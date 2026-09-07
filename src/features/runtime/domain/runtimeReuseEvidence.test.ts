import { expect, it } from "vitest";
import { atlasSnapshot as atlasDocument } from '../../../testSupport/atlasSnapshot';
import type { AtlasData } from "../../../types/atlas";
import { adaptRuntimeRealization } from "./adaptRuntimeRealization";

it("preserves reuse dependencies, evidence and unknown costs without adding reuse to legacy records", () => {
  const record = (atlasDocument as unknown as AtlasData).datasets.runtime_realizations[0]!;
  const legacyRecord = { ...record };
  delete legacyRecord.reuse;
  expect(adaptRuntimeRealization(legacyRecord).reuse ?? []).toEqual([]);
  const result = adaptRuntimeRealization({ ...record, reuse: [{
    reuse_id: "prefix-kv", label: "Prefix K/V", kind: "computed_result",
    producer_refs: ["prefix"], consumer_refs: ["denoise"], lifetime: "observation",
    repeat_scope: "denoise_steps", value_dependencies: ["image", "prompt", "position", "mask"],
    invalidation_conditions: ["observation_changed"], implementation_status: "implemented",
    evidence_ids: ["source-prefix"], storage_bytes: null, preparation_ns: null, read_ns: null,
  }] });
  expect(result.reuse?.[0]).toMatchObject({ kind: "computed_result", lifetime: "observation",
    valueDependencies: ["image", "prompt", "position", "mask"], evidenceIds: ["source-prefix"],
    storageBytes: null, preparationNs: null, readNs: null });
});
