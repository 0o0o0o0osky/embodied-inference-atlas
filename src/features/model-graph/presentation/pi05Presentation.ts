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
    { slots: [`${scope}/scale-product`, [`${scope}/scale-slice`, `${scope}/shift-slice`, `${scope}/gate-slice`]] },
    scopedRow(scope, ["scale-offset", null]),
    scopedRow(scope, ["shift-add", null]),
  ];
}

function gatedResidualRows(scope: string): RowSpec[] {
  return [scopedRow(scope, ["residual-add", "residual-gate"])];
}

export const pi05Presentation: GraphPresentation = {
  avoidNodeObstacles: true,
  stageColumns: [["vision-encoder"], ["prefix-encoder"], ["action-flow-decoder", "public-output"]],
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
      scopedRow(PREFIX_ATTENTION, ["attention-norm"], true),
      scopedRow(PREFIX_ATTENTION, ["query-projection", "key-projection", "value-projection"]),
      scopedRow(PREFIX_ATTENTION, ["query-rope", "key-rope", null]),
      { slots: [null, `${PREFIX_ATTENTION}/attention`, [`${PREFIX_ATTENTION}/key-cache-output`, `${PREFIX_ATTENTION}/value-cache-output`]] },
      scopedRow(PREFIX_ATTENTION, ["output-projection"]),
      scopedRow(PREFIX_ATTENTION, ["attention-residual"]),
      ...gatedMlpRows(PREFIX_MLP),
    ],
    "action-flow-decoder": [
      scopedRow(SUFFIX, ["action-projection", "time-embedding"]),
      { slots: [null, [`${SUFFIX}/time-mlp-in`, `${SUFFIX}/time-silu-in`]] },
      { slots: [null, [`${SUFFIX}/time-mlp-out`, `${SUFFIX}/time-silu-out`]] },
      ...adarmsRows(ATTENTION_ADARMS),
      scopedRow(ATTENTION, ["query-projection", "key-projection", "value-projection"], true),
      scopedRow(ATTENTION, ["query-rope", "key-rope", null]),
      { slots: [null, [`${ATTENTION}/extract-prefix-key`, `${ATTENTION}/key-concat`], [`${ATTENTION}/extract-prefix-value`, `${ATTENTION}/value-concat`]] },
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
      { slots: [`${HEAD}/final-scale-product`, [`${HEAD}/final-scale-slice`, `${HEAD}/final-shift-slice`]] },
      scopedRow(HEAD, ["final-scale-offset", null]),
      scopedRow(HEAD, ["final-shift-add", null]),
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
    [`${PREFIX_ATTENTION}/key-cache-output`]: "Kₚ",
    [`${PREFIX_ATTENTION}/value-cache-output`]: "Vₚ",
    [`${SUFFIX}/time-mlp-in`]: "输入投影",
    [`${SUFFIX}/time-mlp-out`]: "输出投影",
    [`${ATTENTION_ADARMS}/condition-projection`]: "条件投影",
    [`${MLP_ADARMS}/condition-projection`]: "条件投影",
    [`${HEAD}/final-condition-projection`]: "条件投影",
    "input/executed-images": "Executed images",
    "input/prompt-token-ids": "Prompt + state tokens",
    "input/initial-noise": "Noise x₀",
    "loop/action-flow-loop": "xₖ",
    "control/action-flow-loop/timestep": "tₖ",
    "output/prefix-stack-output": "Prefix hidden (unused)",
    "output/public-action-chunk": "Public actions · 32D",
    "public-output/public-action-slice/public-action-slice": "输出选择",
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
    { id: "prefix-key-store", kind: "cache", route: "right-to-top", railInset: 12, busOffset: -22, pairs: [
      [`${PREFIX_ATTENTION}/key-rope`, `${PREFIX_ATTENTION}/key-cache-output`],
    ] },
    { id: "prefix-value-store", kind: "cache", route: "right-to-top", railInset: 8, busOffset: -14, pairs: [
      [`${PREFIX_ATTENTION}/value-projection`, `${PREFIX_ATTENTION}/value-cache-output`],
    ] },
    { id: "expert-prefix-key", kind: "cross", route: "gutter", sourceSide: "bottom", targetSide: "top", railOffset: -4, busOffset: -10, pairs: [[
      `${PREFIX_ATTENTION}/key-cache-output`,
      `${ATTENTION}/extract-prefix-key`,
    ]] },
    { id: "expert-prefix-value", kind: "cross", route: "gutter", sourceSide: "bottom", targetSide: "top", sourceOffset: 8, railOffset: 4, busOffset: -18, pairs: [[
      `${PREFIX_ATTENTION}/value-cache-output`,
      `${ATTENTION}/extract-prefix-value`,
    ]] },
    { id: "time-condition-rail", kind: "rail", side: "right", railInset: 4, pairs: [
      [`${SUFFIX}/time-silu-out`, `${MLP_ADARMS}/condition-projection`],
      [`${SUFFIX}/time-silu-out`, `${HEAD}/final-condition-projection`],
    ] },
    { id: "attention-gate-rail", kind: "rail", side: "right", railInset: 16, pairs: [
      [`${ATTENTION_ADARMS}/gate-slice`, `${ATTENTION_RESIDUAL}/residual-gate`],
    ] },
    { id: "mlp-gate-rail", kind: "rail", side: "right", railInset: 16, pairs: [
      [`${MLP_ADARMS}/gate-slice`, `${MLP_RESIDUAL}/residual-gate`],
    ] },
  ],
};
