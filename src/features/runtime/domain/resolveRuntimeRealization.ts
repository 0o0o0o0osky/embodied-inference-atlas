import type { RunRecord, RuntimeRecord } from "../../../types/atlas";
import { isInferenceRuntimeForModel } from "./runtimeCatalog";
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

export type RuntimeStackState =
  | "有实测配置"
  | "尚未实测"
  | "未实测·受阻"
  | "不支持";

export interface RuntimeStackSummary {
  runtimeId: string;
  displayName: string;
  backend: string;
  state: RuntimeStackState;
  actualPrecisions: readonly { id: string; label: string }[];
  mappingLevels: readonly RuntimeRealizationRecord["mappingLevel"][];
  variantCount: number;
  candidates: readonly RuntimeCandidate[];
}

interface RuntimeStackSummaryInput {
  modelId: string;
  modelGraphId: string;
  hardwareId: string | null;
  workload: string | null;
  runtimes: readonly RuntimeRecord[];
  realizations: readonly RuntimeRealizationRecord[];
  runs: readonly RunRecord[];
  canonicalConfigurationIds: ReadonlySet<string>;
}

const STATE_ORDER: Readonly<Record<RuntimeStackState, number>> = {
  "有实测配置": 0,
  "尚未实测": 1,
  "未实测·受阻": 2,
  "不支持": 3,
};

function unmeasuredState(runtime: RuntimeRecord, modelId: string): RuntimeStackState {
  const statuses = new Set(runtime.model_support
    .filter((support) => support.model_id === modelId)
    .map((support) => support.status));
  if (statuses.has("not_supported")) return "不支持";
  if (statuses.has("blocked")) return "未实测·受阻";
  return "尚未实测";
}

export function buildRuntimeStackSummaries({
  modelId,
  modelGraphId,
  hardwareId,
  workload,
  runtimes,
  realizations,
  runs,
  canonicalConfigurationIds,
}: RuntimeStackSummaryInput): readonly RuntimeStackSummary[] {
  const seen = new Set<string>();
  const summaries = runtimes.flatMap((runtime) => {
    if (
      seen.has(runtime.runtime_id)
      || !isInferenceRuntimeForModel(runtime, modelId)
    ) return [];
    seen.add(runtime.runtime_id);
    const candidates = resolveRuntimeCandidates(realizations, runs, {
      modelId,
      modelGraphId,
      runtimeId: runtime.runtime_id,
      hardwareId,
      workload,
      precisionId: null,
      canonicalConfigurationIds,
    });
    const actualPrecisions = [...new Map(candidates.map((candidate) => [
      candidate.actualPrecisionId,
      { id: candidate.actualPrecisionId, label: candidate.precisionLabel },
    ])).values()];
    const mappingLevels = [...new Set(candidates.map((candidate) => candidate.realization.mappingLevel))];
    return [{
      runtimeId: runtime.runtime_id,
      displayName: runtime.display_name,
      backend: runtime.backend,
      state: candidates.length ? "有实测配置" as const : unmeasuredState(runtime, modelId),
      actualPrecisions,
      mappingLevels,
      variantCount: candidates.length,
      candidates,
    }];
  });
  return summaries.sort((first, second) => STATE_ORDER[first.state] - STATE_ORDER[second.state]);
}
