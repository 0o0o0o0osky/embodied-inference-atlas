import type { RuntimeRecord } from "../../../types/atlas";

export function isAnalyticalToolForModel(runtime: RuntimeRecord, modelId: string) {
  const supports = runtime.model_support.filter((support) => support.model_id === modelId);
  return runtime.backend === "analytical-roofline"
    || (supports.length > 0 && supports.every((support) => support.status === "analytical"));
}

export function isInferenceRuntimeForModel(runtime: RuntimeRecord, modelId: string) {
  return runtime.model_support.some((support) => support.model_id === modelId)
    && !isAnalyticalToolForModel(runtime, modelId);
}
