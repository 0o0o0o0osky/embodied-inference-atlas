import type { OperatorDetail } from "../domain/types";
import type { ModelText } from "./ModelDisplay";

const roles: Readonly<Record<string, string>> = {
  "query-projection": "Q projection",
  "key-projection": "K projection",
  "value-projection": "V projection",
  "output-projection": "Attention output projection",
  "up-projection": "MLP Up projection",
  "mlp-up-projection": "MLP Up projection",
  "down-projection": "MLP Down projection",
  "mlp-down-projection": "MLP Down projection",
  "gate-projection": "MLP gate projection",
  "patch-project": "Patch projection",
  "project": "Vision projection",
  "connector-projection": "Vision connector projection",
  "condition-projection": "Condition projection",
  "final-condition-projection": "Condition projection",
  "state-projection": "State projection",
  "action-projection": "Action projection",
  "velocity-projection": "Velocity projection",
  "key-adapter": "Cross-attention K projection",
  "value-adapter": "Cross-attention V projection",
  "query-rope": "Q RoPE",
  "key-rope": "K RoPE",
  "time-embedding": "Sinusoidal time embedding",
  "embed-prompt": "Prompt embedding",
  "scale-slice": "Select scale",
  "final-scale-slice": "Select scale",
  "shift-slice": "Select shift",
  "final-shift-slice": "Select shift",
  "gate-slice": "Select gate",
  "scale-product": "RMSNorm × scale",
  "final-scale-product": "RMSNorm × scale",
  "scale-offset": "RMSNorm residual addition",
  "final-scale-offset": "RMSNorm residual addition",
  "shift-add": "Add shift",
  "final-shift-add": "Add shift",
  "residual-gate": "Residual gate multiplication",
  "residual-add": "Gated residual addition",
  "attention-residual": "Attention residual addition",
  "mlp-residual": "MLP residual addition",
  "gate-product": "MLP gate multiplication",
  "action-time-concat": "Action/time concat",
  "suffix-concat": "State/action concat",
  "image-language-concat": "Vision/prompt concat",
  "key-concat": "Prefix/suffix K concat",
  "value-concat": "Prefix/suffix V concat",
  "extract-prefix-key": "Prefix K selection",
  "extract-prefix-value": "Prefix V selection",
  "key-cache-output": "K cache view",
  "value-cache-output": "V cache view",
  "pair-key-layers": "K layer indexing",
  "pair-value-layers": "V layer indexing",
  "select-action-rows": "Action token selection",
  "public-action-slice": "Public action selection",
};

const kinds: Readonly<Record<string, string>> = {
  "linear": "Linear projection", "patch-embedding": "Patch embedding",
  "token-embedding": "Embedding lookup", "layer-norm": "LayerNorm", "rms-norm": "RMSNorm",
  "attention-core": "Attention", "rope": "RoPE", "gelu": "GELU", "silu": "SiLU",
  "slice": "Slice", "reshape": "Reshape", "concat": "Concat",
  "permute-rearrange": "Permute", "residual-add": "Elementwise addition",
  "elementwise-multiply": "Elementwise multiplication", "scalar-scale": "Scalar multiplication",
  "sinusoidal-time-embedding": "Sinusoidal time embedding", "euler-update": "Euler update",
};

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
  return roles[id] ?? t(operator.label);
}

export function operatorKindLabel(operator: OperatorDetail, t: ModelText): string {
  return kinds[operator.definitionId] ?? t(operator.definitionLabel);
}

export function operatorExplanation(operator: OperatorDetail): string | null {
  if (["shift-add", "final-shift-add"].includes(operator.operatorId)) {
    return "shift 来自时间条件投影，沿 token 轴广播后逐元素相加。";
  }
  if (["scale-offset", "final-scale-offset"].includes(operator.operatorId)) {
    return "加回原 RMSNorm 结果，得到 RMSNorm(X) × (1 + scale)。";
  }
  return null;
}
