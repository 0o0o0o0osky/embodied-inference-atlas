import type {
  ConnectorHint,
  GraphPresentation,
  LogicalRef,
  NodeVisualKind,
} from "../domain/types";
import {
  actionHeadRows,
  alignedRow,
  centeredMergeRow,
  gatedMlpRows,
  offsetRows,
  scopedRow,
  transformerAttentionRows,
  vitGeluMlpRows,
} from "./templates";

const VISION_ATTENTION = "vision-encoder/vision-blocks/self-attention";
const VISION_MLP = "vision-encoder/vision-blocks/feed-forward";
const PREFIX_ATTENTION = "prefix-encoder/prefix-blocks/self-attention";
const PREFIX_MLP = "prefix-encoder/prefix-blocks/feed-forward";
const ACTION_SUFFIX = "action-flow-decoder/action-suffix-builder";
const ACTION_ATTENTION = "action-flow-decoder/action-expert-blocks/self-attention";
const ACTION_MLP = "action-flow-decoder/action-expert-blocks/feed-forward";
const ACTION_HEAD = "action-flow-decoder/velocity-euler-update";

const operatorAliases: Readonly<Record<string, string>> = {
  "patch-project": "Patch",
  "attention-norm": "Norm",
  "query-projection": "Q",
  "key-projection": "K",
  "value-projection": "V",
  attention: "Attn",
  "output-projection": "O",
  "attention-residual": "Add",
  "mlp-norm": "MLP Norm",
  "mlp-up-projection": "Up",
  "mlp-gelu": "GELU",
  "mlp-down-projection": "Down",
  "mlp-residual": "Add",
  normalize: "Final Norm",
  project: "Project",
  "flatten-views": "reshape",
  "embed-prompt": "Token embed",
  "build-prefix": "concat",
  "query-rope": "Q RoPE",
  "key-rope": "K RoPE",
  "cache-output": "Prefix KV",
  "gate-projection": "Gate",
  "up-projection": "Up",
  "gate-gelu": "GELU",
  "gate-product": "Mul",
  "down-projection": "Down",
  "state-projection": "State",
  "action-projection": "Action",
  "time-embedding": "Sin/Cos",
  "action-time-concat": "concat",
  "time-mlp-in": "MLP in",
  "time-mlp-silu": "SiLU",
  "time-mlp-out": "MLP out",
  "suffix-concat": "concat",
  "extract-prefix-key": "Prefix K",
  "extract-prefix-value": "Prefix V",
  "key-concat": "K view",
  "value-concat": "V view",
  "final-norm": "Final RMSNorm",
  "select-action-rows": "Row slice",
  "velocity-projection": "Velocity proj",
  "euler-update": "Euler",
};

const scopeOperators: Readonly<Record<string, readonly string[]>> = {
  "vision-encoder/image-patch-embedding": ["patch-project"],
  [VISION_ATTENTION]: [
    "attention-norm",
    "query-projection",
    "key-projection",
    "value-projection",
    "attention",
    "output-projection",
    "attention-residual",
  ],
  [VISION_MLP]: [
    "mlp-norm",
    "mlp-up-projection",
    "mlp-gelu",
    "mlp-down-projection",
    "mlp-residual",
  ],
  "vision-encoder/vision-final-normalization": ["normalize"],
  "vision-encoder/vision-projector": ["project"],
  "prefix-encoder/prompt-prefix-builder": ["flatten-views", "embed-prompt", "build-prefix"],
  [PREFIX_ATTENTION]: [
    "attention-norm",
    "query-projection",
    "key-projection",
    "value-projection",
    "query-rope",
    "key-rope",
    "attention",
    "output-projection",
    "attention-residual",
    "cache-output",
  ],
  [PREFIX_MLP]: [
    "mlp-norm",
    "gate-projection",
    "up-projection",
    "gate-gelu",
    "gate-product",
    "down-projection",
    "mlp-residual",
  ],
  [ACTION_SUFFIX]: [
    "state-projection",
    "action-projection",
    "time-embedding",
    "action-time-concat",
    "time-mlp-in",
    "time-mlp-silu",
    "time-mlp-out",
    "suffix-concat",
  ],
  [ACTION_ATTENTION]: [
    "extract-prefix-key",
    "extract-prefix-value",
    "attention-norm",
    "query-projection",
    "key-projection",
    "value-projection",
    "query-rope",
    "key-rope",
    "key-concat",
    "value-concat",
    "attention",
    "output-projection",
    "attention-residual",
  ],
  [ACTION_MLP]: [
    "mlp-norm",
    "gate-projection",
    "up-projection",
    "gate-gelu",
    "gate-product",
    "down-projection",
    "mlp-residual",
  ],
  [ACTION_HEAD]: ["final-norm", "select-action-rows", "velocity-projection", "euler-update"],
};

const aliases: Record<LogicalRef, string> = {
  "input/images": "Images",
  "input/prompt-token-ids": "Prompt",
  "input/state": "State input",
  "input/initial-noise": "Noise x₀",
  "loop/action-flow-loop": "xₖ",
  "control/action-flow-loop/timestep": "tₖ",
  "output/prefix-stack-output": "Prefix out",
  "output/final-action-state": "Actions",
};

Object.entries(scopeOperators).forEach(([scope, operatorIds]) => {
  operatorIds.forEach((operatorId) => {
    aliases[`${scope}/${operatorId}`] = operatorAliases[operatorId] ?? operatorId;
  });
});

Object.assign(aliases, {
  [`${PREFIX_ATTENTION}/cache-output`]: "KVₚ[ℓ]",
  [`${ACTION_ATTENTION}/query-projection`]: "Qₛ",
  [`${ACTION_ATTENTION}/key-projection`]: "Kₛ",
  [`${ACTION_ATTENTION}/value-projection`]: "Vₛ",
  [`${ACTION_ATTENTION}/query-rope`]: "Qₛ RoPE",
  [`${ACTION_ATTENTION}/key-rope`]: "Kₛ RoPE",
});

const visualOverrides: Record<LogicalRef, NodeVisualKind> = {
  [`${PREFIX_ATTENTION}/cache-output`]: "storage",
  [`${ACTION_ATTENTION}/extract-prefix-key`]: "read-port",
  [`${ACTION_ATTENTION}/extract-prefix-value`]: "read-port",
  [`${ACTION_ATTENTION}/key-concat`]: "logical-view",
  [`${ACTION_ATTENTION}/value-concat`]: "logical-view",
  [`${ACTION_HEAD}/select-action-rows`]: "line-op",
};

const connectors = [
  { id: "vision-input", kind: "chain", pairs: [["input/images", "vision-encoder/image-patch-embedding/patch-project"]] },
  { id: "vision-block-entry", kind: "chain", pairs: [["vision-encoder/image-patch-embedding/patch-project", `${VISION_ATTENTION}/attention-norm`]] },
  { id: "vision-patch-residual", kind: "residual", pairs: [["vision-encoder/image-patch-embedding/patch-project", `${VISION_ATTENTION}/attention-residual`]] },
  { id: "vision-qkv", kind: "branch-out", pairs: [
    [`${VISION_ATTENTION}/attention-norm`, `${VISION_ATTENTION}/query-projection`],
    [`${VISION_ATTENTION}/attention-norm`, `${VISION_ATTENTION}/key-projection`],
    [`${VISION_ATTENTION}/attention-norm`, `${VISION_ATTENTION}/value-projection`],
  ] },
  { id: "vision-attn-input", kind: "branch-in", pairs: [
    [`${VISION_ATTENTION}/query-projection`, `${VISION_ATTENTION}/attention`],
    [`${VISION_ATTENTION}/key-projection`, `${VISION_ATTENTION}/attention`],
    [`${VISION_ATTENTION}/value-projection`, `${VISION_ATTENTION}/attention`],
  ] },
  { id: "vision-attn-output", kind: "chain", pairs: [
    [`${VISION_ATTENTION}/attention`, `${VISION_ATTENTION}/output-projection`],
    [`${VISION_ATTENTION}/output-projection`, `${VISION_ATTENTION}/attention-residual`],
  ] },
  { id: "vision-ffn-entry", kind: "chain", pairs: [[`${VISION_ATTENTION}/attention-residual`, `${VISION_MLP}/mlp-norm`]] },
  { id: "vision-ffn-residual", kind: "residual", pairs: [[`${VISION_ATTENTION}/attention-residual`, `${VISION_MLP}/mlp-residual`]] },
  { id: "vision-ffn-exit", kind: "chain", pairs: [
    [`${VISION_MLP}/mlp-norm`, `${VISION_MLP}/mlp-up-projection`],
    [`${VISION_MLP}/mlp-up-projection`, `${VISION_MLP}/mlp-gelu`],
    [`${VISION_MLP}/mlp-gelu`, `${VISION_MLP}/mlp-down-projection`],
    [`${VISION_MLP}/mlp-down-projection`, `${VISION_MLP}/mlp-residual`],
    [`${VISION_MLP}/mlp-residual`, "vision-encoder/vision-final-normalization/normalize"],
    ["vision-encoder/vision-final-normalization/normalize", "vision-encoder/vision-projector/project"],
  ] },
  { id: "vision-prefix", kind: "cross", pairs: [["vision-encoder/vision-projector/project", "prefix-encoder/prompt-prefix-builder/flatten-views"]] },
  { id: "prefix-input", kind: "branch-in", pairs: [
    ["input/prompt-token-ids", "prefix-encoder/prompt-prefix-builder/embed-prompt"],
    ["prefix-encoder/prompt-prefix-builder/flatten-views", "prefix-encoder/prompt-prefix-builder/build-prefix"],
    ["prefix-encoder/prompt-prefix-builder/embed-prompt", "prefix-encoder/prompt-prefix-builder/build-prefix"],
  ] },
  { id: "prefix-block-entry", kind: "chain", pairs: [["prefix-encoder/prompt-prefix-builder/build-prefix", `${PREFIX_ATTENTION}/attention-norm`]] },
  { id: "prefix-block-residual", kind: "residual", pairs: [["prefix-encoder/prompt-prefix-builder/build-prefix", `${PREFIX_ATTENTION}/attention-residual`]] },
  { id: "prefix-qkv", kind: "branch-out", pairs: [
    [`${PREFIX_ATTENTION}/attention-norm`, `${PREFIX_ATTENTION}/query-projection`],
    [`${PREFIX_ATTENTION}/attention-norm`, `${PREFIX_ATTENTION}/key-projection`],
    [`${PREFIX_ATTENTION}/attention-norm`, `${PREFIX_ATTENTION}/value-projection`],
  ] },
  { id: "prefix-rope", kind: "chain", pairs: [
    [`${PREFIX_ATTENTION}/query-projection`, `${PREFIX_ATTENTION}/query-rope`],
    [`${PREFIX_ATTENTION}/key-projection`, `${PREFIX_ATTENTION}/key-rope`],
  ] },
  { id: "prefix-attn-input", kind: "branch-in", pairs: [
    [`${PREFIX_ATTENTION}/query-rope`, `${PREFIX_ATTENTION}/attention`],
    [`${PREFIX_ATTENTION}/key-rope`, `${PREFIX_ATTENTION}/attention`],
    [`${PREFIX_ATTENTION}/value-projection`, `${PREFIX_ATTENTION}/attention`],
  ] },
  { id: "prefix-cache", kind: "cache", route: "right-to-top", pairs: [
    [`${PREFIX_ATTENTION}/key-rope`, `${PREFIX_ATTENTION}/cache-output`],
    [`${PREFIX_ATTENTION}/value-projection`, `${PREFIX_ATTENTION}/cache-output`],
  ] },
  { id: "prefix-attn-output", kind: "chain", pairs: [
    [`${PREFIX_ATTENTION}/attention`, `${PREFIX_ATTENTION}/output-projection`],
    [`${PREFIX_ATTENTION}/output-projection`, `${PREFIX_ATTENTION}/attention-residual`],
  ] },
  { id: "prefix-ffn-entry", kind: "chain", pairs: [[`${PREFIX_ATTENTION}/attention-residual`, `${PREFIX_MLP}/mlp-norm`]] },
  { id: "prefix-ffn-residual", kind: "residual", pairs: [[`${PREFIX_ATTENTION}/attention-residual`, `${PREFIX_MLP}/mlp-residual`]] },
  { id: "prefix-gate-up", kind: "branch-out", pairs: [
    [`${PREFIX_MLP}/mlp-norm`, `${PREFIX_MLP}/gate-projection`],
    [`${PREFIX_MLP}/mlp-norm`, `${PREFIX_MLP}/up-projection`],
  ] },
  { id: "prefix-gate-activation", kind: "chain", pairs: [[`${PREFIX_MLP}/gate-projection`, `${PREFIX_MLP}/gate-gelu`]] },
  { id: "prefix-gated-join", kind: "branch-in", pairs: [
    [`${PREFIX_MLP}/gate-gelu`, `${PREFIX_MLP}/gate-product`],
    [`${PREFIX_MLP}/up-projection`, `${PREFIX_MLP}/gate-product`],
  ] },
  { id: "prefix-exit", kind: "chain", pairs: [
    [`${PREFIX_MLP}/gate-product`, `${PREFIX_MLP}/down-projection`],
    [`${PREFIX_MLP}/down-projection`, `${PREFIX_MLP}/mlp-residual`],
    [`${PREFIX_MLP}/mlp-residual`, "output/prefix-stack-output"],
  ] },
  { id: "action-inputs", kind: "chain", pairs: [
    ["input/state", `${ACTION_SUFFIX}/state-projection`],
    ["input/initial-noise", "loop/action-flow-loop"],
  ] },
  { id: "action-loop-local", kind: "chain", pairs: [["loop/action-flow-loop", `${ACTION_SUFFIX}/action-projection`]] },
  { id: "action-time-control", kind: "chain", pairs: [["control/action-flow-loop/timestep", `${ACTION_SUFFIX}/time-embedding`]] },
  { id: "action-loop-euler", kind: "rail", side: "right", railInset: 26, sourceOffset: -5, targetOffset: -7, pairs: [["loop/action-flow-loop", `${ACTION_HEAD}/euler-update`]] },
  { id: "action-loop-output", kind: "rail", side: "right", railInset: 14, sourceOffset: 5, pairs: [["loop/action-flow-loop", "output/final-action-state"]] },
  { id: "action-time-input", kind: "branch-in", pairs: [
    [`${ACTION_SUFFIX}/action-projection`, `${ACTION_SUFFIX}/action-time-concat`],
    [`${ACTION_SUFFIX}/time-embedding`, `${ACTION_SUFFIX}/action-time-concat`],
  ] },
  { id: "action-time-mlp", kind: "chain", pairs: [
    [`${ACTION_SUFFIX}/action-time-concat`, `${ACTION_SUFFIX}/time-mlp-in`],
    [`${ACTION_SUFFIX}/time-mlp-in`, `${ACTION_SUFFIX}/time-mlp-silu`],
    [`${ACTION_SUFFIX}/time-mlp-silu`, `${ACTION_SUFFIX}/time-mlp-out`],
  ] },
  { id: "action-state-suffix", kind: "rail", side: "left", railInset: 32, pairs: [[`${ACTION_SUFFIX}/state-projection`, `${ACTION_SUFFIX}/suffix-concat`]] },
  { id: "action-token-suffix", kind: "chain", pairs: [[`${ACTION_SUFFIX}/time-mlp-out`, `${ACTION_SUFFIX}/suffix-concat`]] },
  { id: "action-block-entry", kind: "chain", pairs: [[`${ACTION_SUFFIX}/suffix-concat`, `${ACTION_ATTENTION}/attention-norm`]] },
  { id: "action-block-residual", kind: "residual", pairs: [[`${ACTION_SUFFIX}/suffix-concat`, `${ACTION_ATTENTION}/attention-residual`]] },
  { id: "prefix-kv-action", kind: "cross", pairs: [
    [`${PREFIX_ATTENTION}/cache-output`, `${ACTION_ATTENTION}/extract-prefix-key`],
    [`${PREFIX_ATTENTION}/cache-output`, `${ACTION_ATTENTION}/extract-prefix-value`],
  ] },
  { id: "action-qkv", kind: "branch-out", pairs: [
    [`${ACTION_ATTENTION}/attention-norm`, `${ACTION_ATTENTION}/query-projection`],
    [`${ACTION_ATTENTION}/attention-norm`, `${ACTION_ATTENTION}/key-projection`],
    [`${ACTION_ATTENTION}/attention-norm`, `${ACTION_ATTENTION}/value-projection`],
  ] },
  { id: "action-rope", kind: "chain", pairs: [
    [`${ACTION_ATTENTION}/query-projection`, `${ACTION_ATTENTION}/query-rope`],
    [`${ACTION_ATTENTION}/key-projection`, `${ACTION_ATTENTION}/key-rope`],
  ] },
  { id: "action-key-cache", kind: "rail", side: "left", railInset: 22, pairs: [[`${ACTION_ATTENTION}/extract-prefix-key`, `${ACTION_ATTENTION}/key-concat`]] },
  { id: "action-key-local", kind: "chain", pairs: [[`${ACTION_ATTENTION}/key-rope`, `${ACTION_ATTENTION}/key-concat`]] },
  { id: "action-value-cache", kind: "rail", side: "right", railInset: 22, pairs: [[`${ACTION_ATTENTION}/extract-prefix-value`, `${ACTION_ATTENTION}/value-concat`]] },
  { id: "action-value-local", kind: "chain", pairs: [[`${ACTION_ATTENTION}/value-projection`, `${ACTION_ATTENTION}/value-concat`]] },
  { id: "action-query-attn", kind: "rail", side: "left", railInset: 32, pairs: [[`${ACTION_ATTENTION}/query-rope`, `${ACTION_ATTENTION}/attention`]] },
  { id: "action-attn-input", kind: "branch-in", route: "top-bus", pairs: [
    [`${ACTION_ATTENTION}/key-concat`, `${ACTION_ATTENTION}/attention`],
    [`${ACTION_ATTENTION}/value-concat`, `${ACTION_ATTENTION}/attention`],
  ] },
  { id: "action-attn-output", kind: "chain", pairs: [
    [`${ACTION_ATTENTION}/attention`, `${ACTION_ATTENTION}/output-projection`],
    [`${ACTION_ATTENTION}/output-projection`, `${ACTION_ATTENTION}/attention-residual`],
  ] },
  { id: "action-ffn-entry", kind: "chain", pairs: [[`${ACTION_ATTENTION}/attention-residual`, `${ACTION_MLP}/mlp-norm`]] },
  { id: "action-ffn-residual", kind: "residual", pairs: [[`${ACTION_ATTENTION}/attention-residual`, `${ACTION_MLP}/mlp-residual`]] },
  { id: "action-gate-up", kind: "branch-out", pairs: [
    [`${ACTION_MLP}/mlp-norm`, `${ACTION_MLP}/gate-projection`],
    [`${ACTION_MLP}/mlp-norm`, `${ACTION_MLP}/up-projection`],
  ] },
  { id: "action-gate-activation", kind: "chain", pairs: [[`${ACTION_MLP}/gate-projection`, `${ACTION_MLP}/gate-gelu`]] },
  { id: "action-gated-join", kind: "branch-in", pairs: [
    [`${ACTION_MLP}/gate-gelu`, `${ACTION_MLP}/gate-product`],
    [`${ACTION_MLP}/up-projection`, `${ACTION_MLP}/gate-product`],
  ] },
  { id: "action-expert-exit", kind: "chain", pairs: [
    [`${ACTION_MLP}/gate-product`, `${ACTION_MLP}/down-projection`],
    [`${ACTION_MLP}/down-projection`, `${ACTION_MLP}/mlp-residual`],
    [`${ACTION_MLP}/mlp-residual`, `${ACTION_HEAD}/final-norm`],
  ] },
  { id: "action-head", kind: "chain", pairs: [
    [`${ACTION_HEAD}/final-norm`, `${ACTION_HEAD}/select-action-rows`],
    [`${ACTION_HEAD}/select-action-rows`, `${ACTION_HEAD}/velocity-projection`],
    [`${ACTION_HEAD}/velocity-projection`, `${ACTION_HEAD}/euler-update`],
  ] },
  { id: "euler-feedback", kind: "feedback", railOffset: 6, sourceOffset: 7, pairs: [[`${ACTION_HEAD}/euler-update`, "loop/action-flow-loop"]] },
] as const satisfies readonly ConnectorHint[];

export const pi0Presentation: GraphPresentation = {
  rowsByStage: {
    "vision-encoder": [
      { slots: ["vision-encoder/image-patch-embedding/patch-project"] },
      ...offsetRows(
        [...transformerAttentionRows(VISION_ATTENTION), ...vitGeluMlpRows(VISION_MLP)],
        16,
      ),
      { gapBefore: true, slots: ["vision-encoder/vision-final-normalization/normalize"] },
      { slots: ["vision-encoder/vision-projector/project"] },
    ],
    "prefix-encoder": [
      {
        slots: [
          "prefix-encoder/prompt-prefix-builder/flatten-views",
          "prefix-encoder/prompt-prefix-builder/embed-prompt",
        ],
      },
      { slots: ["prefix-encoder/prompt-prefix-builder/build-prefix"] },
      ...transformerAttentionRows(PREFIX_ATTENTION, { rope: true, cacheOutput: true }),
      ...gatedMlpRows(PREFIX_MLP),
    ],
    "action-flow-decoder": [
      {
        slots: [
          `${ACTION_SUFFIX}/state-projection`,
          `${ACTION_SUFFIX}/action-projection`,
          `${ACTION_SUFFIX}/time-embedding`,
        ],
      },
      centeredMergeRow(
        [`${ACTION_SUFFIX}/action-projection`, `${ACTION_SUFFIX}/time-embedding`],
        `${ACTION_SUFFIX}/action-time-concat`,
      ),
      alignedRow(`${ACTION_SUFFIX}/action-time-concat`, `${ACTION_SUFFIX}/time-mlp-in`),
      alignedRow(`${ACTION_SUFFIX}/action-time-concat`, `${ACTION_SUFFIX}/time-mlp-silu`),
      alignedRow(`${ACTION_SUFFIX}/action-time-concat`, `${ACTION_SUFFIX}/time-mlp-out`),
      { gapBefore: true, slots: [`${ACTION_SUFFIX}/suffix-concat`] },
      ...transformerAttentionRows(ACTION_ATTENTION, {
        entry: ["extract-prefix-key", "attention-norm", "extract-prefix-value"],
        rope: true,
        prefixKvViews: true,
      }),
      ...gatedMlpRows(ACTION_MLP),
      ...actionHeadRows(ACTION_HEAD),
    ],
  },
  boundaryLanes: {
    "prefix-encoder": {
      input: { slotCount: 2, lanes: { "input/prompt-token-ids": 1 } },
    },
    "action-flow-decoder": {
      input: {
        slotCount: 3,
        lanes: {
          "input/state": 0,
          "input/initial-noise": 1,
          "control/action-flow-loop/timestep": 2,
        },
      },
      loop: { slotCount: 3, lanes: { "loop/action-flow-loop": 1 } },
    },
  },
  aliases,
  visualOverrides,
  connectorHints: connectors,
};
