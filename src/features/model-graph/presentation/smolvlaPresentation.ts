import type { GraphPresentation } from "../domain/types";
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
const EXPERT = "action-flow-decoder/expert-layer-pairs";
const SELF_ATTENTION = `${EXPERT}/self-attention`;
const SELF_MLP = `${EXPERT}/self-feed-forward`;
const CROSS_ATTENTION = `${EXPERT}/cross-attention`;
const CROSS_MLP = `${EXPERT}/cross-feed-forward`;

export const smolvlaPresentation: GraphPresentation = {
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
      scopedRow("vision-encoder/patch-grid-connector", ["grid-rearrange"]),
      scopedRow("vision-encoder/patch-grid-connector", ["connector-projection"]),
      scopedRow("vision-encoder/patch-grid-connector", ["connector-scale"]),
    ],
    "prefix-encoder": [
      { slots: ["prefix-encoder/prompt-prefix-builder/flatten-views", "prefix-encoder/prompt-prefix-builder/embed-prompt", "prefix-encoder/state-token-projector/pad-state"] },
      { slots: [null, "prefix-encoder/prompt-prefix-builder/prompt-scale", "prefix-encoder/state-token-projector/state-projection"] },
      { slots: ["prefix-encoder/prompt-prefix-builder/image-language-concat"], centerBetween: ["prefix-encoder/prompt-prefix-builder/flatten-views", "prefix-encoder/prompt-prefix-builder/prompt-scale"] },
      scopedRow("prefix-encoder/prompt-prefix-builder", ["build-prefix"]),
      scopedRow(PREFIX_ATTENTION, ["attention-norm"], true),
      scopedRow(PREFIX_ATTENTION, ["query-projection", "key-projection", "value-projection"]),
      scopedRow(PREFIX_ATTENTION, ["query-rope", "key-rope", null]),
      scopedRow(PREFIX_ATTENTION, [null, "key-cache-output", "value-cache-output"]),
      { slots: [null, "prefix-encoder/cache-layer-pairing/pair-key-layers", "prefix-encoder/cache-layer-pairing/pair-value-layers"] },
      scopedRow(PREFIX_ATTENTION, ["attention"]),
      scopedRow(PREFIX_ATTENTION, ["output-projection"]),
      scopedRow(PREFIX_ATTENTION, ["attention-residual"]),
      ...gatedMlpRows(PREFIX_MLP, "gate-silu"),
    ],
    "action-flow-decoder": [
      scopedRow(SUFFIX, ["action-projection", "time-embedding"]),
      scopedRow(SUFFIX, [null, "broadcast-time"]),
      scopedRow(SUFFIX, ["action-time-concat"]),
      scopedRow(SUFFIX, ["time-mlp-in"]),
      scopedRow(SUFFIX, ["time-mlp-silu"]),
      scopedRow(SUFFIX, ["time-mlp-out"]),
      scopedRow(SELF_ATTENTION, ["attention-norm", "extract-prefix-key", "extract-prefix-value"], true),
      scopedRow(SELF_ATTENTION, ["query-projection", "key-projection", "value-projection"]),
      scopedRow(SELF_ATTENTION, ["query-rope", "key-rope", null]),
      scopedRow(SELF_ATTENTION, [null, "key-concat", "value-concat"]),
      scopedRow(SELF_ATTENTION, ["attention"]),
      scopedRow(SELF_ATTENTION, ["output-projection"]),
      scopedRow(SELF_ATTENTION, ["attention-residual"]),
      ...gatedMlpRows(SELF_MLP, "gate-silu"),
      scopedRow(CROSS_ATTENTION, ["attention-norm", "extract-prefix-key", "extract-prefix-value"], true),
      scopedRow(CROSS_ATTENTION, ["query-projection", "flatten-prefix-key", "flatten-prefix-value"]),
      scopedRow(CROSS_ATTENTION, ["query-rope", "key-adapter", "value-adapter"]),
      scopedRow(CROSS_ATTENTION, [null, "rearrange-key-heads", "rearrange-value-heads"]),
      scopedRow(CROSS_ATTENTION, ["attention"]),
      scopedRow(CROSS_ATTENTION, ["output-projection"]),
      scopedRow(CROSS_ATTENTION, ["attention-residual"]),
      ...gatedMlpRows(CROSS_MLP, "gate-silu"),
      scopedRow("action-flow-decoder/velocity-projection", ["final-norm"], true),
      scopedRow("action-flow-decoder/velocity-projection", ["velocity-projection"]),
      scopedRow("action-flow-decoder/euler-update", ["euler-update"], true),
    ],
    "public-output": [
      scopedRow("public-output/public-action-slice", ["public-action-slice"]),
    ],
  },
  boundaryLanes: {
    "prefix-encoder": {
      input: {
        slotCount: 3,
        lanes: { "input/state": 2, "input/prompt-token-ids": 1 },
      },
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
    "vision-encoder/patch-grid-connector/grid-rearrange": "图块合并",
    "prefix-encoder/prompt-prefix-builder/image-language-concat": "图文拼接",
    [`${SUFFIX}/action-time-concat`]: "动作拼接",
    [`${SELF_ATTENTION}/attention`]: "Self-attention core",
    [`${CROSS_ATTENTION}/attention`]: "Cross-attention core",
    "input/executed-images": "512² execution",
    "input/prompt-token-ids": "Prompt tokens",
    "input/state": "State scalars",
    "input/initial-noise": "Noise x₀",
    "loop/action-flow-loop": "xₖ",
    "control/action-flow-loop/timestep": "tₖ",
    "output/prefix-stack-output": "VLM hidden (unused)",
    "output/public-action-chunk": "Public actions · 6D",
    "public-output/public-action-slice/public-action-slice": "输出选择",
  },
  visualOverrides: {
    [`${PREFIX_ATTENTION}/key-cache-output`]: "storage",
    [`${PREFIX_ATTENTION}/value-cache-output`]: "storage",
    "prefix-encoder/cache-layer-pairing/pair-key-layers": "storage",
    "prefix-encoder/cache-layer-pairing/pair-value-layers": "storage",
    [`${SELF_ATTENTION}/extract-prefix-key`]: "read-port",
    [`${SELF_ATTENTION}/extract-prefix-value`]: "read-port",
    [`${SELF_ATTENTION}/key-concat`]: "logical-view",
    [`${SELF_ATTENTION}/value-concat`]: "logical-view",
    [`${CROSS_ATTENTION}/extract-prefix-key`]: "read-port",
    [`${CROSS_ATTENTION}/extract-prefix-value`]: "read-port",
    "public-output/public-action-slice/public-action-slice": "line-op",
  },
  connectorHints: [
    { id: "self-prefix-key", kind: "cross", route: "gutter", sourceSide: "bottom", targetSide: "top", railOffset: -7, busOffset: -12, pairs: [[
      "prefix-encoder/cache-layer-pairing/pair-key-layers",
      `${SELF_ATTENTION}/extract-prefix-key`,
    ]] },
    { id: "cross-prefix-key", kind: "cross", route: "gutter", sourceSide: "bottom", targetSide: "top", railOffset: 3, busOffset: -12, pairs: [[
      "prefix-encoder/cache-layer-pairing/pair-key-layers",
      `${CROSS_ATTENTION}/extract-prefix-key`,
    ]] },
    { id: "self-prefix-value", kind: "cross", route: "gutter", sourceSide: "bottom", sourceOffset: 6, targetSide: "top", railOffset: -2, busOffset: -7, pairs: [[
      "prefix-encoder/cache-layer-pairing/pair-value-layers",
      `${SELF_ATTENTION}/extract-prefix-value`,
    ]] },
    { id: "cross-prefix-value", kind: "cross", route: "gutter", sourceSide: "bottom", sourceOffset: 6, targetSide: "top", railOffset: 8, busOffset: -7, pairs: [[
      "prefix-encoder/cache-layer-pairing/pair-value-layers",
      `${CROSS_ATTENTION}/extract-prefix-value`,
    ]] },
    { id: "self-key-rail", kind: "rail", side: "left", railInset: 124, pairs: [[
      `${SELF_ATTENTION}/extract-prefix-key`,
      `${SELF_ATTENTION}/key-concat`,
    ]] },
    { id: "self-value-rail", kind: "rail", side: "right", railInset: 14, pairs: [[
      `${SELF_ATTENTION}/extract-prefix-value`,
      `${SELF_ATTENTION}/value-concat`,
    ]] },
  ],
};
