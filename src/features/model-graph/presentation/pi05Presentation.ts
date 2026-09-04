import type { GraphPresentation, RowSpec } from "../domain/types";
import {
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
const SUFFIX = "action-flow-decoder/action-suffix-builder";
const EXPERT = "action-flow-decoder/action-expert-blocks";
const ATTENTION_ADARMS = `${EXPERT}/attention-adarms`;
const ATTENTION = `${EXPERT}/self-attention`;
const ATTENTION_RESIDUAL = `${EXPERT}/attention-gated-residual`;
const MLP_ADARMS = `${EXPERT}/mlp-adarms`;
const MLP = `${EXPERT}/feed-forward`;
const MLP_RESIDUAL = `${EXPERT}/mlp-gated-residual`;
const HEAD = "action-flow-decoder/velocity-projection";

function adarmsRows(scope: string): RowSpec[] {
  return [
    scopedRow(scope, ["rms-norm", "condition-projection"], true),
    scopedRow(scope, ["scale-slice", "shift-slice", "gate-slice"]),
    scopedRow(scope, ["scale-product"]),
    scopedRow(scope, ["scale-offset"]),
    scopedRow(scope, ["shift-add"]),
  ];
}

function gatedResidualRows(scope: string): RowSpec[] {
  return [
    scopedRow(scope, ["residual-gate"], true),
    scopedRow(scope, ["residual-add"]),
  ];
}

export const pi05Presentation: GraphPresentation = {
  rowsByStage: {
    "vision-encoder": [
      scopedRow("vision-encoder/image-patch-embedding", ["patch-project"]),
      ...offsetRows(
        [...transformerAttentionRows(VISION_ATTENTION), ...vitGeluMlpRows(VISION_MLP)],
        16,
      ),
      scopedRow("vision-encoder/vision-final-normalization", ["normalize"], true),
      scopedRow("vision-encoder/vision-projector", ["project"]),
    ],
    "prefix-encoder": [
      scopedRow("prefix-encoder/prompt-prefix-builder", ["flatten-views", "embed-prompt"]),
      scopedRow("prefix-encoder/prompt-prefix-builder", ["build-prefix"]),
      ...transformerAttentionRows(PREFIX_ATTENTION, { rope: true }),
      scopedRow(PREFIX_ATTENTION, ["key-cache-output", "value-cache-output"]),
      ...gatedMlpRows(PREFIX_MLP),
    ],
    "action-flow-decoder": [
      scopedRow(SUFFIX, ["action-projection", "time-embedding"]),
      scopedRow(SUFFIX, [null, "time-mlp-in"]),
      scopedRow(SUFFIX, [null, "time-silu-in"]),
      scopedRow(SUFFIX, [null, "time-mlp-out"]),
      scopedRow(SUFFIX, [null, "time-silu-out"]),
      ...adarmsRows(ATTENTION_ADARMS),
      scopedRow(ATTENTION, ["extract-prefix-key", "query-projection", "extract-prefix-value"], true),
      scopedRow(ATTENTION, ["key-projection", null, "value-projection"]),
      scopedRow(ATTENTION, ["query-rope", "key-rope"]),
      scopedRow(ATTENTION, ["key-concat", "value-concat"]),
      scopedRow(ATTENTION, ["attention"]),
      scopedRow(ATTENTION, ["output-projection"]),
      ...gatedResidualRows(ATTENTION_RESIDUAL),
      ...adarmsRows(MLP_ADARMS),
      scopedRow(MLP, ["gate-projection", "up-projection"], true),
      scopedRow(MLP, ["gate-gelu", null]),
      scopedRow(MLP, ["gate-product"]),
      scopedRow(MLP, ["down-projection"]),
      ...gatedResidualRows(MLP_RESIDUAL),
      scopedRow(HEAD, ["final-rms-norm", "final-condition-projection"], true),
      scopedRow(HEAD, ["final-scale-slice", "final-shift-slice"]),
      scopedRow(HEAD, ["final-scale-product"]),
      scopedRow(HEAD, ["final-scale-offset"]),
      scopedRow(HEAD, ["final-shift-add"]),
      scopedRow(HEAD, ["velocity-projection"]),
      scopedRow("action-flow-decoder/euler-update", ["euler-update"], true),
    ],
    "public-output": [
      scopedRow("public-output/public-action-slice", ["public-action-slice"]),
    ],
  },
  boundaryLanes: {
    "prefix-encoder": {
      input: { slotCount: 2, lanes: { "input/prompt-token-ids": 1 } },
    },
    "action-flow-decoder": {
      input: {
        slotCount: 2,
        lanes: { "input/initial-noise": 0, "control/action-flow-loop/timestep": 1 },
      },
      loop: { slotCount: 2, lanes: { "loop/action-flow-loop": 0 } },
    },
  },
  aliases: {
    "input/executed-images": "Executed images",
    "input/prompt-token-ids": "Prompt + state tokens",
    "input/initial-noise": "Noise x₀",
    "loop/action-flow-loop": "xₖ",
    "control/action-flow-loop/timestep": "tₖ",
    "output/prefix-stack-output": "Prefix hidden (unused)",
    "output/public-action-chunk": "Public actions · 32D",
    "public-output/public-action-slice/public-action-slice": "identity 32 → 32",
  },
  visualOverrides: {
    [`${PREFIX_ATTENTION}/key-cache-output`]: "storage",
    [`${PREFIX_ATTENTION}/value-cache-output`]: "storage",
    [`${ATTENTION}/extract-prefix-key`]: "read-port",
    [`${ATTENTION}/extract-prefix-value`]: "read-port",
    [`${ATTENTION}/key-concat`]: "logical-view",
    [`${ATTENTION}/value-concat`]: "logical-view",
    "public-output/public-action-slice/public-action-slice": "line-op",
  },
  connectorHints: [
    { id: "expert-prefix-key", kind: "cross", route: "top-bus", side: "left", pairs: [[
      `${PREFIX_ATTENTION}/key-cache-output`,
      `${ATTENTION}/extract-prefix-key`,
    ]] },
    { id: "expert-prefix-value", kind: "cross", route: "top-bus", side: "right", pairs: [[
      `${PREFIX_ATTENTION}/value-cache-output`,
      `${ATTENTION}/extract-prefix-value`,
    ]] },
    { id: "expert-key-rail", kind: "rail", side: "left", railInset: 14, pairs: [[
      `${ATTENTION}/extract-prefix-key`,
      `${ATTENTION}/key-concat`,
    ]] },
    { id: "expert-value-rail", kind: "rail", side: "right", railInset: 14, pairs: [[
      `${ATTENTION}/extract-prefix-value`,
      `${ATTENTION}/value-concat`,
    ]] },
  ],
};
