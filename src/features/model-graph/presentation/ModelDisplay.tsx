import { createContext, useContext, type ReactNode } from "react";

type Values = Readonly<Record<string, string | number>>;
export type ModelText = (text: string, values?: Values) => string;

// Display copy only: canonical labels, formulas, refs, and layout inputs stay intact.
const pi0Text: Readonly<Record<string, string>> = {
  "Vision Encoder": "视觉编码器", "Prefix Encoder": "前缀编码器", "Action Flow Decoder": "动作解码器",
  "Images": "图像", "Prompt": "提示词", "State input": "状态输入", "Noise x₀": "噪声 x₀",
  "Prefix out": "前缀输出", "Actions": "动作输出", "Denoise ×{count}": "去噪 ×{count}",
  "Gemma ×17 full": "Gemma ×17 完整块", "Expert ×18": "专家 ×18", "L18 K/V tail": "L18 K/V 尾段",
  "Patch": "图块", "Norm": "归一化", "Attn": "注意力", "Add": "相加", "Mul": "相乘",
  "MLP Norm": "MLP 归一化", "Up": "升维", "Down": "降维", "Gate": "门控",
  "Final Norm": "末层归一化", "Final RMSNorm": "末层 RMSNorm", "Project": "投影",
  "reshape": "重排", "Token embed": "词嵌入", "concat": "拼接", "Prefix KV": "前缀 KV",
  "State": "状态", "Action": "动作", "MLP in": "MLP 输入", "MLP out": "MLP 输出",
  "Prefix K": "前缀 K", "Prefix V": "前缀 V", "K view": "K 视图", "V view": "V 视图",
  "Row slice": "行选择", "Velocity proj": "速度投影", "Euler": "欧拉更新",
  "Attention LayerNorm": "注意力 LayerNorm", "Query projection": "Q 投影", "Key projection": "K 投影",
  "Value projection": "V 投影", "Self-attention core": "自注意力计算", "Attention output projection": "注意力输出投影",
  "Attention residual": "注意力残差相加", "MLP LayerNorm": "MLP LayerNorm",
  "MLP up projection": "MLP 升维投影", "MLP GELU": "MLP GELU", "MLP down projection": "MLP 降维投影",
  "MLP residual": "MLP 残差相加", "Attention RMSNorm": "注意力 RMSNorm",
  "MQA query projection": "MQA Q 投影", "MQA key projection": "MQA K 投影", "MQA value projection": "MQA V 投影",
  "Query RoPE": "Q RoPE", "Key RoPE": "K RoPE", "Prefix attention core": "前缀注意力计算",
  "Stack attention key and value": "堆叠注意力 K/V", "Read matched-layer prefix keys": "读取对应层的前缀 K",
  "Read matched-layer prefix values": "读取对应层的前缀 V", "Action query projection": "动作 Q 投影",
  "Action key projection": "动作 K 投影", "Action value projection": "动作 V 投影",
  "Action query RoPE": "动作 Q RoPE", "Action key RoPE": "动作 K RoPE",
  "Logical view of prefix and current-suffix keys": "前缀与当前后缀 K 的逻辑视图",
  "Logical view of prefix and current-suffix values": "前缀与当前后缀 V 的逻辑视图",
  "Action attention core": "动作注意力计算", "MLP RMSNorm": "MLP RMSNorm", "Gate projection": "门控投影",
  "Up projection": "升维投影", "Gate GELU": "门控 GELU", "Gated MLP product": "门控 MLP 逐元素乘积",
  "Down projection": "降维投影", "Patch projection": "图块投影", "Vision output LayerNorm": "视觉输出 LayerNorm",
  "Multimodal projection": "多模态投影", "Flatten view tokens": "展平视角词元", "Prompt token embedding": "提示词嵌入",
  "Concatenate view and prompt tokens": "拼接视觉与提示词词元", "State projection": "状态投影",
  "Noisy-action projection": "带噪动作投影", "Sinusoidal timestep embedding": "正弦时间步嵌入",
  "Concatenate action and time": "拼接动作与时间", "Action-time MLP input projection": "动作时间 MLP 输入投影",
  "Action-time SiLU": "动作时间 SiLU", "Action-time MLP output projection": "动作时间 MLP 输出投影",
  "Concatenate state and action tokens": "拼接状态与动作词元", "Select final action-token rows": "选择末尾动作词元行",
  "Velocity projection": "速度投影", "Euler update": "欧拉更新",
  "Patch embedding": "图块嵌入", "Token embedding": "词元嵌入", "Linear projection": "线性投影",
  "Layer normalization": "层归一化", "RMS normalization": "RMS 归一化", "Rotary position embedding": "旋转位置嵌入",
  "Attention core": "注意力计算", "GELU activation": "GELU 激活", "SiLU activation": "SiLU 激活",
  "Elementwise multiply": "逐元素相乘", "Residual addition": "残差相加", "Concatenation": "拼接",
  "Reshape or logical row selection": "形状重排或逻辑行选择", "Logical slice": "逻辑切片",
  "Sinusoidal time embedding": "正弦时间嵌入", "Euler flow update": "欧拉流更新",
  "Prompt token IDs": "提示词词元 ID", "Latent robot state": "机器人潜在状态", "Initial noise/action state": "初始噪声与动作状态",
  "Loop-carried action state": "循环携带的动作状态", "Final prefix stack hidden state": "前缀堆叠的最终隐状态",
  "Final action state": "最终动作状态",
  "Prefill-once vision work: patch embedding, 27 folded SigLIP blocks, final normalization, and multimodal projection.": "视觉预填充执行一次：图块嵌入、折叠表示的 27 个 SigLIP 块、末层归一化与多模态投影。",
  "Prefill-once multimodal prefix work: build view/prompt tokens, run 17 full Gemma blocks, then retain the layer-18 K/V-producing tail required by the cached decoder.": "多模态前缀预填充执行一次：构建视觉与提示词词元，执行 17 个完整 Gemma 块，并保留缓存解码器所需的第 18 层 K/V 尾段。",
  "Layer 18 runs pre-attention RMSNorm, Q/K/V projection, RoPE, and the K/V cache write; attention, output projection, and feed-forward do not run.": "第 18 层执行注意力前 RMSNorm、Q/K/V 投影、RoPE 与 K/V 缓存写入；不执行注意力、输出投影或前馈计算。",
  "Iterative hot loop: rebuild the state/action suffix, run 18 folded action-expert blocks against cached prefix K/V, project velocity, and apply one Euler update per denoise step.": "每步去噪重建状态与动作后缀，利用前缀 K/V 缓存执行折叠表示的 18 个动作专家块，投影速度并执行一次欧拉更新。",
  "Inspect {description}": "查看算子：{description}",
  "Pi0 logical operator graph": "Pi0 模型算子图",
  "Pi0 logical operator graph with three authored stage columns": "Pi0 模型算子图，分为视觉、前缀与动作三个阶段列",
  "embedding": "嵌入", "linear": "线性运算", "normalization": "归一化", "position": "位置编码",
  "attention": "注意力", "activation": "激活", "elementwise": "逐元素运算", "shape": "形状变换",
  "input": "输入", "output": "输出", "residual": "残差", "query": "Q", "key": "K", "value": "V",
  "update": "更新量", "hidden": "隐状态", "prefix_kv": "前缀 K/V", "right": "右输入", "left": "左输入",
  "suffix": "后缀", "images": "图像", "tokens": "词元", "image": "图像", "view_tokens": "视角词元",
  "prompt_token_ids": "提示词 ID", "prefix": "前缀", "token_ids": "词元 ID", "state": "状态",
  "action_state": "动作状态", "timestep": "时间步", "expert_hidden": "专家隐状态",
  "updated_action_state": "新动作状态", "velocity": "速度", "updated_state": "新状态",
  "initial": "初始状态", "iteration_input": "迭代输入", "iteration_output": "迭代输出", "final": "最终状态",
  "flops": "FLOPs", "read_elements": "读取元素", "write_elements": "写入元素", "elements": "元素", "unresolved": "未解析",
  "Multiply and add count as two FLOPs; logical operand elements are counted once; bias, activation, cache behavior, runtime dtype, packing, quantization metadata, and fusion are excluded.": "乘法与加法分别计为一次 FLOP；逻辑操作数元素仅计一次。不包含偏置、激活、缓存行为、运行时数据类型、打包、量化元数据与融合。",
  "GEMM tile microscope": "GEMM 分块计算", "Schematic 3 × 3 output tiles": "示意：3 × 3 输出分块",
  "Three by three GEMM tile traversal": "GEMM 的 3 × 3 分块遍历", "K tile {index}": "K 分块 {index}",
  "Write D tile row {row}, column {column}.": "写入 D 的第 {row} 行、第 {column} 列分块。",
  "D tile row {row}, column {column}: accumulate K tile {tile} of 3.": "D 第 {row} 行、第 {column} 列分块：累加第 {tile}/3 个 K 分块。",
  "Attention tile microscope": "注意力分块计算", "Query": "Q 长度", "Key/value": "K/V 长度", "Heads": "注意力头数", "Head width": "每头维度",
  "Attention dependency sequence": "注意力计算的依赖顺序", "scale / mask": "缩放 / 掩码",
  "Q @ Kᵀ score tile 1 of 3": "Q @ Kᵀ：第 1/3 个得分分块", "Q @ Kᵀ score tile 2 of 3": "Q @ Kᵀ：第 2/3 个得分分块",
  "Q @ Kᵀ score tile 3 of 3": "Q @ Kᵀ：第 3/3 个得分分块", "Scale scores and apply the declared mask": "缩放得分并应用已声明的掩码",
  "Normalize each score row with softmax": "使用 softmax 对每行得分归一化", "P @ V output tile 1 of 3": "P @ V：第 1/3 个输出分块",
  "P @ V output tile 2 of 3": "P @ V：第 2/3 个输出分块", "P @ V output tile 3 of 3": "P @ V：第 3/3 个输出分块",
  "Patch projection microscope": "图块投影计算", "patch · weight → token": "图块 · 权重 → 词元", "Image": "图像", "Patch / stride": "图块 / 步长",
  "Channels": "通道数", "Tokens / view": "每视角词元数", "Input patch lattice": "输入图块网格", "Output tokens": "输出词元",
  "Patch {index}/{count}: row {row}, column {column}; pixels y {y0}–{y1}, x {x0}–{x1}.": "图块 {index}/{count}：第 {row} 行、第 {column} 列；像素 y {y0}–{y1}，x {x0}–{x1}。",
  "The declared image and patch dimensions do not form an exact lattice.": "已声明的图像与图块尺寸无法组成完整网格。",
  "Patch animation is unavailable for inconsistent dimensions.": "尺寸不一致，无法显示图块动画。",
  "Illustrative mathematical traversal, not a runtime tile schedule.": "图中展示数学遍历过程，不代表运行时的分块调度。",
  "Read xₖ": "读取 xₖ", "Read velocity vₖ": "读取速度 vₖ", "Scale by Δt": "乘以步长 Δt", "Write xₖ₊₁": "写入 xₖ₊₁",
  "Read one feature row": "读取一行特征", "Reduce row statistics": "归约该行统计量", "Normalize and scale": "归一化并缩放", "Write normalized row": "写入归一化结果",
  "Read input lane": "读取输入元素", "Apply {operator}": "应用{operator}", "Write activated lane": "写入激活结果",
  "Read source axes": "读取源张量轴", "Remap logical indices": "重映射逻辑索引", "Expose destination view": "生成目标视图",
  "Read declared input": "读取已声明的输入", "Construct embedding coordinates": "构建嵌入坐标", "Write embedding": "写入嵌入结果",
  "Read declared inputs": "读取已声明的输入", "Apply operator semantics": "执行算子运算", "Write declared outputs": "写入已声明的输出",
  "Flow update microscope": "流状态更新", "{operator} explainer": "{operator}过程", "{operator} logical phases": "{operator}的逻辑步骤",
  "Pause computation animation": "暂停计算动画", "Play computation animation": "播放计算动画",
  "Pause": "暂停", "Play": "播放", "Step": "单步", "Reset": "重置", "Speed": "速度",
  "Timed playback disabled by reduced-motion preference. ": "已根据减少动态效果偏好关闭自动播放。",
};

function format(text: string, values: Values = {}): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
}

const sourceText: ModelText = (text, values) => format(text, values);
const chineseText: ModelText = (text, values) => format(pi0Text[text] ?? text, values);
const ModelTextContext = createContext<ModelText>(sourceText);

export function modelDisplayText(modelId: string, text: string, values?: Values): string {
  return (modelId === "pi0" ? chineseText : sourceText)(text, values);
}

export function ModelDisplayProvider({ modelId, children }: { modelId: string; children: ReactNode }) {
  return <ModelTextContext value={modelId === "pi0" ? chineseText : sourceText}>{children}</ModelTextContext>;
}

export function useModelText(): ModelText {
  return useContext(ModelTextContext);
}
