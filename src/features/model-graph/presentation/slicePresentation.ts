import type { OperatorDetail } from "../domain/types";

interface SlicePresentation {
  formula: string;
  explanation: string;
  axis: number | null;
  start: number | null;
  stop: number | null;
}

const ADARMS_SCOPES = new Set([
  "action-flow-decoder/action-expert-blocks/attention-adarms",
  "action-flow-decoder/action-expert-blocks/mlp-adarms",
]);
const HEAD = "action-flow-decoder/velocity-projection";
const PI0_ATTENTION = "action-flow-decoder/action-expert-blocks/self-attention";
const PAIR = "action-flow-decoder/expert-layer-pairs";

/** Declared model operations, not kernel-name or shape-only offset inference. */
export function slicePresentation(operator: OperatorDetail): SlicePresentation | null {
  if (operator.definitionId !== "slice") return null;
  const input = operator.inputs[0]?.tensor;
  const output = operator.outputs[0]?.tensor;
  const shape = input?.shape ?? [];
  const out = output?.shape ?? [];
  const scope = operator.ref.slice(0, operator.ref.lastIndexOf("/"));
  const id = operator.operatorId;
  const dimension = operator.scopeBindings.D;
  const parameter = ADARMS_SCOPES.has(scope) ? id.replace(/-slice$/, "")
    : scope === HEAD && id.startsWith("final-") ? id.replace(/^final-/, "").replace(/-slice$/, "") : null;
  const part = parameter === "scale" ? 0 : parameter === "shift" ? 1 : parameter === "gate" ? 2 : null;
  if (part !== null && dimension !== null && dimension !== undefined && dimension > 0
    && shape.length === 2 && shape[1] === 3 * dimension && out.length === 2 && out[1] === dimension
    && shape[0] === out[0] && input?.axes[1]?.axis === "width") {
    const start = part * dimension, end = start + dimension;
    return {
      axis: 1, start, stop: end,
      formula: `${parameter} = X[:, ${start}:${end}]`,
      explanation: `从长度为 3 × D 的条件向量中取${["第一", "第二", "第三"][part]}段，每段 D=${dimension}。三段依次是 scale、shift、Gate，索引范围采用左闭右开区间。${parameter === "shift" ? "shift 是时间条件生成的 bias，用于逐元素相加。" : ""}`,
    };
  }
  const isKey = id === "extract-prefix-key";
  const isValue = id === "extract-prefix-value";
  const removesLeadingAxis = shape.length === out.length + 1 && shape[0] === 2
    && out.every((size, index) => size === shape[index + 1]);
  if ((isKey || isValue) && scope === PI0_ATTENTION && input?.axes[0]?.axis === "kv" && removesLeadingAxis) {
    const index = isKey ? 0 : 1;
    return {
      axis: 0, start: index, stop: index + 1,
      formula: `${isKey ? "Kₚ" : "Vₚ"} = X[${index}, :, :, :, :]`,
      explanation: `当前 expert 层的 prefix KV 已选定；沿第 0 轴（kv）取 ${index}，得到${isKey ? "K" : "V"}。保留 batch、prefix sequence、KV head 与 head dimension 四个轴。`,
    };
  }
  if ((isKey || isValue) && [PAIR + "/self-attention", PAIR + "/cross-attention"].includes(scope)
    && input?.axes[0]?.axis === "layer_slot" && removesLeadingAxis) {
    const index = scope.endsWith("/self-attention") ? 0 : 1;
    return {
      axis: 0, start: index, stop: index + 1,
      formula: `${isKey ? "Kₚ" : "Vₚ"} = X[${index}, :, :, :, :]`,
      explanation: `沿第 0 轴（layer_slot）取当前层组的第 ${index + 1} 层：${index === 0 ? "self-attention 对应全局层 2p" : "cross-attention 对应全局层 2p+1"}，p 从 0 开始。K 与 V 各自读取对应层，保留 batch、head、prefix sequence、head dimension。`,
    };
  }
  if (operator.ref === "action-flow-decoder/velocity-euler-update/select-action-rows"
    && shape.length === 3 && out.length === 3 && input?.axes[1]?.axis === "suffix_tokens") {
    const sequence = shape[1], count = out[1];
    if (sequence !== null && count !== null && sequence !== undefined && count !== undefined && sequence >= count
      && count === operator.scopeBindings.T && shape[0] === out[0] && shape[2] === out[2]) {
      const start = sequence - count;
      return {
        axis: 1, start, stop: sequence,
        formula: `Y = X[:, ${start}:${sequence}, :]`,
        explanation: `沿第 1 轴（suffix tokens）保留最后 ${count} 个 action token，即 [S−T, S)。${start === 1 ? "第 0 行是 state token，在这里移除。" : ""}batch 与 hidden width 保持不变。`,
      };
    }
  }
  if (operator.ref === "public-output/public-action-slice/public-action-slice"
    && shape.length === 3 && out.length === 3 && input?.axes[2]?.axis === "width") {
    const width = shape[2], count = out[2];
    if (width !== null && count !== null && width !== undefined && count !== undefined && count > 0 && count <= width
      && width === operator.scopeBindings.DIN && count === operator.scopeBindings.DOUT
      && shape[0] === out[0] && shape[1] === out[1]) {
      return {
        axis: 2, start: 0, stop: count,
        formula: `Y = X[:, :, 0:${count}]`,
        explanation: `沿最后一轴（action width）取前 ${count} 个分量，保留 batch 与 action horizon。${count === width ? `当前 ${width}→${count} 覆盖整个轴，数值与形状保持不变。` : `当前内部 ${width} 维动作输出为公开 ${count} 维。`}`,
      };
    }
  }
  return {
    axis: null, start: null, stop: null,
    formula: "Y = slice(X, axis=a, start=s, stop=e, step=k)",
    explanation: "范围待补充：当前声明未提供可确认的 axis、起止位置或步长；输入输出形状可在张量信息中查看。",
  };
}
