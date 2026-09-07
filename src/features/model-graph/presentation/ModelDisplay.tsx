import { createContext, useContext, type ReactNode } from "react";
import { SHARED_TERMINOLOGY } from "./terminology";

type Values = Readonly<Record<string, string | number>>;
export type ModelText = (text: string, values?: Values) => string;

// Display copy only: canonical labels, formulas, refs, and layout inputs stay intact.


const modelText: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  pi0: {
  "Gemma ×17 full": "Gemma ×17 完整块", "Expert ×18": "专家 ×18", "L18 K/V tail": "L18 K/V 尾段",
  "Prefill-once vision work: patch embedding, 27 folded SigLIP blocks, final normalization, and multimodal projection.": "视觉预填充执行一次：patch embedding、折叠表示的 27 个 SigLIP 块、末层归一化与多模态投影。",
  "Prefill-once multimodal prefix work: build view/prompt tokens, run 17 full Gemma blocks, then retain the layer-18 K/V-producing tail required by the cached decoder.": "多模态前缀预填充执行一次：构建视觉与 prompt token，执行 17 个完整 Gemma 块，并保留缓存解码器所需的第 18 层 K/V 尾段。",
  "Layer 18 runs pre-attention RMSNorm, Q/K/V projection, RoPE, and the K/V cache write; attention, output projection, and feed-forward do not run.": "第 18 层执行 Attention 前 RMSNorm、Q/K/V 投影、RoPE 与 K/V 缓存写入；不执行 Attention、输出投影或前馈计算。",
  "Iterative hot loop: rebuild the state/action suffix, run 18 folded action-expert blocks against cached prefix K/V, project velocity, and apply one Euler update per denoise step.": "每步去噪重建状态与动作后缀，利用前缀 K/V 缓存执行折叠表示的 18 个动作专家块，投影速度并执行一次欧拉更新。",
  "Pi0 logical operator graph": "Pi0 模型算子图",
  "Pi0 logical operator graph with three authored stage columns": "Pi0 模型算子图，分为视觉、前缀与动作三个阶段列",
  },
  pi05: {
    "Prefix hidden (unused)": "前缀隐状态（未使用）", "Public actions · 32D": "动作输出 · 32D",
    "identity 32 → 32": "恒等 32 → 32",
    "Pi0.5 logical operator graph": "Pi0.5 模型算子图",
    "Pi0.5 logical operator graph with three stage columns with a final action output region": "Pi0.5 模型算子图：视觉、前缀、动作与输出",
  },
  smolvla: {
    "VLM hidden (unused)": "VLM 隐状态（未使用）", "Public actions · 6D": "动作输出 · 6D",
    "slice 32 → 6": "切片 32 → 6",
    "SmolVLA logical operator graph": "SmolVLA 模型算子图",
    "SmolVLA logical operator graph with three stage columns with a final action output region": "SmolVLA 模型算子图：视觉、前缀、动作与输出",
  },
};

function format(text: string, values: Values = {}): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
}

const sourceText: ModelText = (text, values) => format(text, values);
const ModelTextContext = createContext<ModelText>(sourceText);

export function modelDisplayText(modelId: string, text: string, values?: Values): string {
  const dictionary = modelText[modelId] ?? {};
  const lookup = (label: string) => SHARED_TERMINOLOGY[label] ?? dictionary[label];
  const direct = lookup(text);
  // Scope repetition is generated from the graph, rather than a fixed model depth.
  const repeated = text.match(/^(.*?) ×(.+)$/);
  const display = direct ?? (repeated
    ? `${lookup(repeated[1]!) ?? repeated[1]} ×${repeated[2]}`
    : text);
  return format(display, values);
}

export function ModelDisplayProvider({ modelId, children }: { modelId: string; children: ReactNode }) {
  return <ModelTextContext value={(text, values) => modelDisplayText(modelId, text, values)}>{children}</ModelTextContext>;
}

export function useModelText(): ModelText {
  return useContext(ModelTextContext);
}
