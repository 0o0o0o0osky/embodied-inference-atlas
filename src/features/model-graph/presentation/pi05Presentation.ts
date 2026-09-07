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

const COMPUTE_REGION = [0, 0.75] as const;
const mainRow = (ref: string): RowSpec => ({ slots: [ref], region: COMPUTE_REGION });
const splitRow = (main: string | null, condition: string | null): RowSpec => ({ slots: [main, condition], slotWeights: [3, 1] });
const computeRow = (scope: string, operators: readonly (string | null)[]): RowSpec => ({ ...scopedRow(scope, operators), region: COMPUTE_REGION });

function adarmsRows(scope: string, label: string, { prefix = "", startScope = false }: { prefix?: string; startScope?: boolean } = {}): RowSpec[] {
  const ref = (id: string) => `${scope}/${prefix}${id}`;
  return [
    { ...splitRow(ref("rms-norm"), ref("condition-projection")), gapBefore: startScope, label, stepAfter: 40 },
    { ...splitRow(ref("scale-product"), ref("scale-slice")), stepAfter: 32 },
    { ...mainRow(ref("scale-offset")), stepAfter: 32 },
    { ...splitRow(ref("shift-add"), ref("shift-slice")), stepAfter: 40 },
  ];
}

function gatedResidualRows(scope: string, condition: string): RowSpec[] {
  return [
    { ...splitRow(`${scope}/residual-gate`, `${condition}/gate-slice`), stepAfter: 32 },
    mainRow(`${scope}/residual-add`),
  ];
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
      { ...splitRow(`${SUFFIX}/action-projection`, `${SUFFIX}/time-embedding`), label: "动作与时间输入", stepAfter: 40 },
      { ...splitRow(null, `${SUFFIX}/time-mlp-in`), stepAfter: 40 },
      { ...splitRow(null, `${SUFFIX}/time-silu-in`), stepAfter: 40 },
      { ...splitRow(null, `${SUFFIX}/time-mlp-out`), stepAfter: 40 },
      { ...splitRow(null, `${SUFFIX}/time-silu-out`), stepAfter: 40 },
      ...adarmsRows(ATTENTION_ADARMS, "Attention 子层", { startScope: true }),
      computeRow(ATTENTION, ["query-projection", "key-projection", "value-projection"]),
      computeRow(ATTENTION, ["query-rope", "key-rope", null]),
      computeRow(ATTENTION, [null, "extract-prefix-key", "extract-prefix-value"]),
      computeRow(ATTENTION, [null, "key-concat", "value-concat"]),
      mainRow(`${ATTENTION}/attention`),
      mainRow(`${ATTENTION}/output-projection`),
      ...gatedResidualRows(ATTENTION_RESIDUAL, ATTENTION_ADARMS),
      ...adarmsRows(MLP_ADARMS, "前馈子层"),
      computeRow(MLP, ["gate-projection", "up-projection"]),
      computeRow(MLP, ["gate-gelu", null]),
      mainRow(`${MLP}/gate-product`),
      mainRow(`${MLP}/down-projection`),
      ...gatedResidualRows(MLP_RESIDUAL, MLP_ADARMS),
      ...adarmsRows(HEAD, "动作输出", { prefix: "final-" }),
      mainRow(`${HEAD}/velocity-projection`),
      mainRow("action-flow-decoder/euler-update/euler-update"),
    ],
    "public-output": [mainRow("public-output/public-action-slice/public-action-slice")],
  },
  boundaryLanes: {
    "prefix-encoder": {
      input: { slotCount: 2, lanes: { "input/prompt-token-ids": 1 } },
    },
    "action-flow-decoder": {
      input: {
        slotCount: 4,
        lanes: { "input/initial-noise": 1, "control/action-flow-loop/timestep": 3 },
      },
      loop: { slotCount: 4, lanes: { "loop/action-flow-loop": 1 } },
      output: { slotCount: 1, region: COMPUTE_REGION, lanes: { "output/public-action-chunk": 0 } },
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
    { id: "time-condition-rail", kind: "rail", side: "right", targetSide: "top", railInset: 4, pairs: [
      [`${SUFFIX}/time-silu-out`, `${ATTENTION_ADARMS}/condition-projection`],
      [`${SUFFIX}/time-silu-out`, `${MLP_ADARMS}/condition-projection`],
      [`${SUFFIX}/time-silu-out`, `${HEAD}/final-condition-projection`],
    ] },
    ...[ATTENTION_ADARMS, MLP_ADARMS].flatMap(scope => [
      { id: `${scope}-parameters`, kind: "rail" as const, side: "right" as const, railInset: 18,
        pairs: ["scale-slice", "shift-slice", "gate-slice"].map(id => [`${scope}/condition-projection`, `${scope}/${id}`] as const) },
      { id: `${scope}-rms-offset`, kind: "rail" as const, side: "left" as const, railInset: 82,
        pairs: [[`${scope}/rms-norm`, `${scope}/scale-offset`]] as const },
    ]),
    { id: "head-parameters", kind: "rail", side: "right", railInset: 18, pairs: [
      [`${HEAD}/final-condition-projection`, `${HEAD}/final-scale-slice`],
      [`${HEAD}/final-condition-projection`, `${HEAD}/final-shift-slice`],
    ] },
    { id: "head-rms-offset", kind: "rail", side: "left", railInset: 82,
      pairs: [[`${HEAD}/final-rms-norm`, `${HEAD}/final-scale-offset`]] },
    { id: "attention-local-key", kind: "rail", side: "left", railInset: 96,
      pairs: [[`${ATTENTION}/key-rope`, `${ATTENTION}/key-concat`]] },
    { id: "attention-local-value", kind: "rail", side: "right", railInset: 96,
      pairs: [[`${ATTENTION}/value-projection`, `${ATTENTION}/value-concat`]] },
    { id: "action-state-rail", kind: "rail", side: "left", railInset: 4, pairs: [
      ["loop/action-flow-loop", "action-flow-decoder/euler-update/euler-update"],
      ["loop/action-flow-loop", "public-output/public-action-slice/public-action-slice"],
    ] },
  ],
};
