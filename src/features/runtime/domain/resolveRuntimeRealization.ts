import type { RunRecord } from "../../../types/atlas";
import type { RuntimeRealizationRecord } from "./types";

export interface RuntimeCandidate {
  realization: RuntimeRealizationRecord;
  actualPrecisionId: string;
  precisionLabel: string;
}

interface RuntimeSelection {
  modelId: string;
  modelGraphId: string;
  runtimeId: string;
  hardwareId: string | null;
  workload: string | null;
  precisionId: string | null;
}

function actualPrecisionId(record: RuntimeRealizationRecord, runs: readonly RunRecord[]) {
  if (record.availability === "not_supported") {
    return record.precisionPaths.length === 1 ? record.precisionPaths[0]!.precisionPathId : null;
  }
  const configurations = new Set(record.configurationIds);
  const ids = new Set(
    runs
      .filter((run) => configurations.has(run.configuration_id))
      .map((run) => run.precision.precision_id),
  );
  return ids.size === 1 ? [...ids][0]! : null;
}

function parsedBindings(encoded: string) {
  const bindings = new Map<string, number>();
  for (const part of encoded.split(",")) {
    const [name, rawValue] = part.split("=", 2);
    const value = Number(rawValue);
    if (!name?.trim() || !Number.isSafeInteger(value)) return null;
    bindings.set(name.trim(), value);
  }
  return bindings;
}

function matchesWorkload(
  record: RuntimeRealizationRecord,
  runs: readonly RunRecord[],
  encoded: string | null,
) {
  if (!encoded) return true;
  if (encoded.startsWith("cfg-")) return record.configurationIds.includes(encoded);
  const bindings = parsedBindings(encoded);
  if (!bindings) return false;
  const applicability = record.workloadApplicability;
  const fixed = new Map<string, number | null>([
    ["T_ACTION", applicability.runtimeActionHorizon],
    ["N_DENOISE", applicability.denoiseSteps],
  ]);
  for (const [name, expected] of fixed) {
    const selected = bindings.get(name);
    if (selected !== undefined && selected !== expected) return false;
  }

  const configurations = new Set(record.configurationIds);
  const measuredRuns = runs.filter((run) => configurations.has(run.configuration_id));
  const variableBindings = [...bindings].filter(([name]) => name === "V" || name === "L_PROMPT");
  return variableBindings.length === 0 || measuredRuns.some((run) =>
    variableBindings.every(([name, value]) =>
      value === (name === "V" ? run.workload.vla.camera_views : run.workload.vla.executed_prompt_tokens),
    ),
  );
}

export function resolveRuntimeCandidates(
  records: readonly RuntimeRealizationRecord[],
  runs: readonly RunRecord[],
  selection: RuntimeSelection,
): readonly RuntimeCandidate[] {
  return records.flatMap((record) => {
    if (
      record.modelId !== selection.modelId ||
      record.modelGraphId !== selection.modelGraphId ||
      record.runtimeId !== selection.runtimeId
    ) return [];
    const precisionId = actualPrecisionId(record, runs);
    if (!precisionId || (selection.precisionId && selection.precisionId !== precisionId)) return [];
    const precision = record.precisionPaths.find((path) => path.precisionPathId === precisionId);
    const candidate = {
      realization: record,
      actualPrecisionId: precisionId,
      precisionLabel: precision?.label ?? precisionId,
    };
    if (record.availability === "not_supported") return [candidate];
    if (
      selection.hardwareId &&
      !record.deviceIds.includes(selection.hardwareId)
    ) return [];
    if (!matchesWorkload(record, runs, selection.workload)) return [];
    return [candidate];
  });
}
