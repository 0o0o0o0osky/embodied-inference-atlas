import { OPERATOR_CATALOG, OPERATOR_KIND_NAMES as kinds } from "./operatorCatalog";
import type { OperatorDetail } from "../domain/types";
import type { ModelText } from "./ModelDisplay";

/** Full detail names use the operator role; compact DAG aliases stay separate. */
export function operatorTitle(operator: OperatorDetail, t: ModelText): string {
  const { operatorId: id, definitionId: kind, ref } = operator;
  if (kind === "layer-norm" || kind === "rms-norm") {
    const name = kinds[kind];
    return id === "attention-norm" ? `Attention ${name}` : id === "mlp-norm" ? `MLP ${name}`
      : id.startsWith("final-") || id === "normalize" ? `Final ${name}` : name!;
  }
  if (kind === "attention-core") {
    if (ref.includes("/cross-attention/")) return "Cross-attention";
    if (operator.label.startsWith("Causal ")) return "Causal Self-attention";
    if (operator.label.startsWith("Bidirectional ")) return "Bidirectional Self-attention";
    if (ref.startsWith("prefix-encoder/")) return "Prefix Attention";
    return ref.startsWith("vision-encoder/") ? "Self-attention" : "Action Attention";
  }
  if (id === "time-mlp-in" || id === "time-mlp-out") {
    const branch = operator.inputs[0]?.tensor?.semanticRole === "condition" ? "Time" : "Action/time";
    return `${branch} MLP ${id === "time-mlp-in" ? "input" : "output"} projection`;
  }
  if (id === "build-prefix") {
    const hasState = operator.inputs.some(input => input.tensor?.tensorId === "state-token");
    return hasState ? "Vision/prompt/state concat" : "Vision/prompt concat";
  }
  if (kind === "gelu" || kind === "silu") return kinds[kind]!;
  return OPERATOR_CATALOG[id]?.title ?? t(operator.label);
}

export function operatorKindLabel(operator: OperatorDetail, t: ModelText): string {
  return kinds[operator.definitionId] ?? t(operator.definitionLabel);
}

export function operatorExplanation(operator: OperatorDetail): string | null {
  return OPERATOR_CATALOG[operator.operatorId]?.explanation ?? null;
}
