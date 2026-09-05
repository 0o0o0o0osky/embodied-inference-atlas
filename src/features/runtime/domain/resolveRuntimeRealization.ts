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
  canonicalConfigurationIds?: ReadonlySet<string>;
}

function parsedBindings(encoded: string) {
  const aliases = new Map<string, string>([
    ["v", "V"], ["p", "L_PROMPT"], ["a", "T_ACTION"], ["n", "N_DENOISE"],
  ]);
  const bindings = new Map<string, number>();
  for (const part of encoded.split(",")) {
    const [rawName, rawValue] = part.split("=", 2);
    const trimmedName = rawName?.trim();
    const name = trimmedName ? aliases.get(trimmedName) ?? trimmedName : null;
    const value = Number(rawValue);
    if (!name || bindings.has(name) || !Number.isSafeInteger(value)) return null;
    bindings.set(name, value);
  }
  return bindings;
}

function runMatchesWorkload(
  record: RuntimeRealizationRecord,
  run: RunRecord,
  encoded: string | null,
  canonicalConfigurationIds: ReadonlySet<string>,
) {
  if (!encoded) return true;
  if (canonicalConfigurationIds.has(encoded) || record.configurationIds.includes(encoded)) {
    return record.configurationIds.includes(encoded) && run.configuration_id === encoded;
  }
  if (/^(?:cfg|config)-/.test(encoded)) return false;
  const bindings = parsedBindings(encoded);
  if (!bindings) return false;
  const workloadSymbols = new Set(["V", "L_PROMPT", "T_ACTION", "N_DENOISE"]);
  if ([...bindings.keys()].some((name) => !workloadSymbols.has(name))) return false;
  const applicability = record.workloadApplicability;
  const fixed = new Map<string, number | null>([
    ["T_ACTION", applicability.runtimeActionHorizon],
    ["N_DENOISE", applicability.denoiseSteps],
  ]);
  for (const [name, expected] of fixed) {
    const selected = bindings.get(name);
    if (selected !== undefined && selected !== expected) return false;
  }
  const workload = run.workload.vla;
  if (!workload) return false;
  const witnessed = new Map<string, number | null>([
    ["V", workload.camera_views],
    ["L_PROMPT", workload.executed_prompt_tokens],
    ["T_ACTION", workload.action_chunk],
    ["N_DENOISE", workload.denoise_steps],
  ]);
  return [...bindings].every(([name, value]) => witnessed.get(name) === value);
}

function actualPrecisionId(
  record: RuntimeRealizationRecord,
  runs: readonly RunRecord[],
  selection: RuntimeSelection,
) {
  if (record.availability !== "measured") return null;
  const configurationIds = new Set(record.configurationIds);
  const canonicalConfigurationIds = selection.canonicalConfigurationIds ?? new Set<string>();
  const ids = new Set(runs.filter((run) =>
    run.evidence === "measured_local"
    && run.model_id === record.modelId
    && run.runtime_id === record.runtimeId
    && configurationIds.has(run.configuration_id)
    && record.deviceIds.includes(run.device_id)
    && (!selection.hardwareId || run.device_id === selection.hardwareId)
    && runMatchesWorkload(record, run, selection.workload, canonicalConfigurationIds)
  ).map((run) => run.precision.precision_id));
  return ids.size === 1 ? [...ids][0]! : null;
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
      record.runtimeId !== selection.runtimeId ||
      record.availability !== "measured"
    ) return [];
    const precisionId = actualPrecisionId(record, runs, selection);
    if (!precisionId || (selection.precisionId && selection.precisionId !== precisionId)) return [];
    const precision = record.precisionPaths.find((path) => path.precisionPathId === precisionId);
    if (!precision) return [];
    const candidate = {
      realization: record,
      actualPrecisionId: precisionId,
      precisionLabel: precision.label,
    };
    return [candidate];
  });
}
