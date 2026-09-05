import type { LogicalDag } from "../../model-graph/domain/types";
import type { LogicalTarget, RepeatSelector, RuntimeMapping } from "../domain/types";

export function humanizeRuntime(value: string) {
  return value.replaceAll("_", " ");
}

const PI0_PRECISION_LABELS: Readonly<Record<string, string>> = {
  "mixed-fp8-e4m3-fp16": "选择性 FP8 E4M3 / FP16",
  "flashrt-fp16-control": "FP16 控制路径（组内）",
  "mixed-bf16-fp32": "BF16 / FP32 混合执行",
  "q8_0-weight-only": "Q8_0 仅权重量化 / FP16 执行（非 INT8 计算）",
};

const PI0_SHORT_PRECISION_LABELS: Readonly<Record<string, string>> = {
  "mixed-fp8-e4m3-fp16": "FP8/FP16",
  "flashrt-fp16-control": "FP16",
  "mixed-bf16-fp32": "BF16/FP32",
  "q8_0-weight-only": "Q8_0 权重/FP16",
};

const PI0_GROUP_LABELS: Readonly<Record<string, string>> = {
  "Prefix merged QKV GEMM": "前缀 Q/K/V 合并 GEMM",
  "Prefix attention runtime region": "前缀注意力运行区",
  "Velocity projection + Euler update": "速度投影 + 欧拉更新",
  "ggml query projection": "ggml Q 投影",
  "Attention option region": "注意力可选路径",
  "Extra layer-18 hidden path": "第 18 层额外隐状态路径",
  "ggml velocity projection": "ggml 速度投影",
  "ggml Euler add": "ggml 欧拉相加",
  "Q8_0 weight-only query projection": "Q8_0 仅权重 Q 投影",
  "Output projection then Euler add": "输出投影后执行欧拉相加",
};

export function pi0PrecisionLabel(precisionId: string, fallback: string) {
  return PI0_PRECISION_LABELS[precisionId] ?? fallback;
}

export function pi0ShortPrecisionLabel(precisionId: string, fallback: string) {
  return PI0_SHORT_PRECISION_LABELS[precisionId] ?? fallback;
}

export function pi0GroupLabel(label: string) {
  return PI0_GROUP_LABELS[label] ?? label;
}

export function pi0MappingLevelLabel(value: string) {
  return ({
    custom_runtime: "自定义运行时",
    ggml_graph: "GGML 图",
    pytorch_eager: "PyTorch eager",
    kernel_correlated: "Kernel 关联",
    none: "未建立",
  } as Readonly<Record<string, string>>)[value] ?? humanizeRuntime(value);
}

export function pi0MappingCoverageLabel(value: string) {
  return ({
    complete_at_level: "层级内完整覆盖",
    partial: "部分覆盖",
    opaque: "不透明覆盖",
    none: "未覆盖",
  } as Readonly<Record<string, string>>)[value] ?? humanizeRuntime(value);
}

export function pi0RelationLabel(value: string) {
  return ({
    preserved: "保留",
    fused: "融合",
    split: "拆分",
    eliminated: "已消除",
    opaque: "不透明",
  } as Readonly<Record<string, string>>)[value] ?? humanizeRuntime(value);
}

export interface Pi0NoExecutionGroupPresentation {
  mappingSummary: string;
  implementation: string;
  precision: string;
  repeatAndKernel: string;
}

export function pi0NoExecutionGroupPresentation(
  relations: readonly RuntimeMapping["relation"][],
): Pi0NoExecutionGroupPresentation {
  if (relations.includes("eliminated")) {
    return {
      mappingSummary: "已由运行时消除，无独立执行组",
      implementation: "无独立实现（运行时消除）",
      precision: "不适用",
      repeatAndKernel: "无独立执行组；Kernel 不适用",
    };
  }
  if (relations.length) {
    return {
      mappingSummary: "已建立源码映射，无独立执行组",
      implementation: "无独立执行组",
      precision: "不适用",
      repeatAndKernel: "无独立执行组；Kernel 未关联",
    };
  }
  return {
    mappingSummary: "尚无源码审计映射",
    implementation: "实现未建立",
    precision: "未建立",
    repeatAndKernel: "无执行组；Kernel 未关联",
  };
}

export function shortLogicalRef(ref: string) {
  const parts = ref.split("/");
  return parts.slice(-2).join(" / ");
}

function selectorLabel(selector: RepeatSelector, dag: LogicalDag) {
  const scope = dag.scopes.find((item) => item.id === selector.scopeRef);
  const repeat = scope?.repeat ?? null;
  const isDenoise = scope?.kind === "denoise" || selector.scopeRef.endsWith("action-flow-loop");
  const noun = isDenoise ? "denoise" : "layers";
  if (selector.selection === "all") return repeat ? `${noun} ×${repeat}` : `${noun}: all`;
  const indices = [...selector.indices].sort((a, b) => a - b);
  if (repeat && indices.length === 1 && [repeat - 1, repeat].includes(indices[0]!)) {
    return `L${indices[0]! + 1} only`;
  }
  if (indices.length > 1 && indices.every((value, index) => value === indices[0]! + index)) {
    return `${noun} ${indices[0]}–${indices.at(-1)}`;
  }
  return `${noun} ${indices.join(", ")}`;
}

export function targetRepeatLabel(target: LogicalTarget, dag: LogicalDag) {
  return repeatSelectorLabel(target.repeatSelectors, dag);
}

export function repeatSelectorLabel(selectors: readonly RepeatSelector[], dag: LogicalDag) {
  return selectors.map((selector) => selectorLabel(selector, dag)).join(" · ");
}
