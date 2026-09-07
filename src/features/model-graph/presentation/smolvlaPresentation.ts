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
      scopedRow("prefix-encoder/state-token-projector", ["pad-state", "state-projection"]),
      scopedRow("prefix-encoder/prompt-prefix-builder", ["flatten-views", "embed-prompt"], true),
      scopedRow("prefix-encoder/prompt-prefix-builder", [null, "prompt-scale"]),
      scopedRow("prefix-encoder/prompt-prefix-builder", ["image-language-concat"]),
      scopedRow("prefix-encoder/prompt-prefix-builder", ["build-prefix"]),
      ...transformerAttentionRows(PREFIX_ATTENTION, { rope: true }),
      scopedRow(PREFIX_ATTENTION, ["key-cache-output", "value-cache-output"]),
      ...gatedMlpRows(PREFIX_MLP, "gate-silu"),
      scopedRow("prefix-encoder/cache-layer-pairing", ["pair-key-layers", "pair-value-layers"], true),
    ],
    "action-flow-decoder": [
      scopedRow(SUFFIX, ["action-projection", "time-embedding"]),
      scopedRow(SUFFIX, [null, "broadcast-time"]),
      scopedRow(SUFFIX, ["action-time-concat"]),
      scopedRow(SUFFIX, ["time-mlp-in"]),
      scopedRow(SUFFIX, ["time-mlp-silu"]),
      scopedRow(SUFFIX, ["time-mlp-out"]),
      ...transformerAttentionRows(SELF_ATTENTION, {
        entry: ["extract-prefix-key", "attention-norm", "extract-prefix-value"],
        rope: true,
        prefixKvViews: true,
      }),
      ...gatedMlpRows(SELF_MLP, "gate-silu"),
      scopedRow(CROSS_ATTENTION, ["extract-prefix-key", "attention-norm", "extract-prefix-value"], true),
      scopedRow(CROSS_ATTENTION, ["flatten-prefix-key", null, "flatten-prefix-value"]),
      scopedRow(CROSS_ATTENTION, ["key-adapter", null, "value-adapter"]),
      scopedRow(CROSS_ATTENTION, ["rearrange-key-heads", null, "rearrange-value-heads"]),
      scopedRow(CROSS_ATTENTION, ["query-projection"]),
      scopedRow(CROSS_ATTENTION, ["query-rope"]),
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
        slotCount: 2,
        lanes: { "input/state": 0, "input/prompt-token-ids": 1 },
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
    { id: "self-prefix-key", kind: "cross", route: "top-bus", side: "left", pairs: [[
      "prefix-encoder/cache-layer-pairing/pair-key-layers",
      `${SELF_ATTENTION}/extract-prefix-key`,
    ]] },
    { id: "cross-prefix-key", kind: "cross", route: "top-bus", side: "left", pairs: [[
      "prefix-encoder/cache-layer-pairing/pair-key-layers",
      `${CROSS_ATTENTION}/extract-prefix-key`,
    ]] },
    { id: "self-prefix-value", kind: "cross", route: "top-bus", side: "right", pairs: [[
      "prefix-encoder/cache-layer-pairing/pair-value-layers",
      `${SELF_ATTENTION}/extract-prefix-value`,
    ]] },
    { id: "cross-prefix-value", kind: "cross", route: "top-bus", side: "right", pairs: [[
      "prefix-encoder/cache-layer-pairing/pair-value-layers",
      `${CROSS_ATTENTION}/extract-prefix-value`,
    ]] },
    { id: "self-key-rail", kind: "rail", side: "left", railInset: 14, pairs: [[
      `${SELF_ATTENTION}/extract-prefix-key`,
      `${SELF_ATTENTION}/key-concat`,
    ]] },
    { id: "self-value-rail", kind: "rail", side: "right", railInset: 14, pairs: [[
      `${SELF_ATTENTION}/extract-prefix-value`,
      `${SELF_ATTENTION}/value-concat`,
    ]] },
  ],
};
