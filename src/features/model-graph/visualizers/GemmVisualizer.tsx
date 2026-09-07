import { useState } from "react";
import type { OperatorDetail } from "../domain/types";
import { ComputationStepper } from "./ComputationStepper";
import { useOperatorAnimation } from "./useOperatorAnimation";
import "./gemmComputation.css";

function dimensions(operator: OperatorDetail) {
  const { M, N, K } = operator.bindings;
  if ([M, N, K].every((value) => typeof value === "number")) return { M, N, K };
  const input = operator.inputs[0]?.tensor?.shape;
  const output = operator.outputs[0]?.tensor?.shape;
  if (!input || !output || input.includes(null) || output.includes(null)) {
    return { M: null, N: null, K: null };
  }
  const concreteInput = input as number[];
  const concreteOutput = output as number[];
  return {
    M: concreteInput.slice(0, -1).reduce((total, value) => total * value, 1),
    N: concreteOutput.at(-1) ?? null,
    K: concreteInput.at(-1) ?? null,
  };
}


const exampleX = [[1, 2, 3], [0, 1, 2], [2, 0, 1]];
const exampleW = [[2, 1, 0], [0, 1, 2], [1, 0, 1]];
const steps = [
  { label: "选取行与列", description: "输出位置 (i, j) 使用 X 的第 i 行和 W 的第 j 列，共有 K 对元素。" },
  { label: "对应元素相乘", description: "沿 K 维逐对相乘，得到每一项对这个输出元素的贡献。" },
  { label: "累加得到输出", description: "将 K 项乘积相加，得到 yᵢⱼ。对所有行列组合重复，形成 M × N 输出。" },
];

export function GemmVisualizer({ operator, resetKey }: { operator: OperatorDetail; resetKey: string }) {
  const animation = useOperatorAnimation(steps.length, resetKey);
  const [selected, setSelected] = useState(0);
  const row = Math.floor(selected / 3), column = selected % 3;
  const dims = dimensions(operator);
  const terms = exampleX[row]!.map((value, k) => value * exampleW[k]![column]!);
  return <ComputationStepper title="矩阵乘：一行与一列生成一个输出" formula={operator.formula}
    className="gemm-visualizer gemm-computation" animation={animation} steps={steps}
    dimensions={[{ label: "输入行 M", value: dims.M?.toLocaleString() ?? "未填写" },
      { label: "输出列 N", value: dims.N?.toLocaleString() ?? "未填写" },
      { label: "相乘累加长度 K", value: dims.K?.toLocaleString() ?? "未填写" }]}
    footnote={<a href="https://docs.pytorch.org/docs/stable/generated/torch.mm.html">PyTorch · 矩阵乘法与形状约定</a>}>
    <div className="gemm-example">
      <p>3 × 3 数值示例 · 点击 Y 中的位置，查看所用的行和列。</p>
      <div className="gemm-example-matrices">
        <div><strong>X</strong><div className="gemm-example-grid">{exampleX.flatMap((values, r) => values.map((value, c) =>
          <span key={`${r}/${c}`} className={r === row ? "is-active" : ""}>{value}</span>))}</div></div>
        <b aria-hidden="true">×</b>
        <div><strong>W</strong><div className="gemm-example-grid">{exampleW.flatMap((values, r) => values.map((value, c) =>
          <span key={`${r}/${c}`} className={c === column ? "is-active" : ""}>{value}</span>))}</div></div>
        <b aria-hidden="true">=</b>
        <div><strong>Y</strong><div className="gemm-example-grid">{Array.from({ length: 9 }, (_, index) =>
          <button type="button" key={index} aria-label={`输出第 ${Math.floor(index / 3) + 1} 行第 ${index % 3 + 1} 列`}
            aria-pressed={index === selected} onClick={() => setSelected(index)}>
            {index === selected && animation.frame === 2 ? terms.reduce((a, b) => a + b, 0) : "·"}
          </button>)}</div></div>
      </div>
      <div className="gemm-example-expression">
        <span>X 的第 {row + 1} 行 × W 的第 {column + 1} 列</span>
        <div>{exampleX[row]!.map((value, k) => <span key={k}>
          <code>{value} × {exampleW[k]![column]}</code>
          {animation.frame >= 1 ? <strong>{terms[k]}</strong> : null}
        </span>)}</div>
        {animation.frame === 2 ? <p>{terms.join(" + ")} = <strong>{terms.reduce((a, b) => a + b, 0)}</strong></p> : null}
      </div>
    </div>
  </ComputationStepper>;
}
