import type { OperatorDetail } from "../domain/types";
import { AnalysisPlaceholder } from "../../../components/AnalysisPlaceholder";
import { ComputationStepper } from "./ComputationStepper";
import { useOperatorAnimation } from "./useOperatorAnimation";

const eulerSteps = [
  { label: "当前状态", description: "读取当前动作状态 xₖ 和模型给出的速度 vₖ。" },
  { label: "计算变化量", description: "将速度逐元素乘以本步的 Δt，得到变化量。" },
  { label: "更新状态", description: "把变化量加到 xₖ 上，形成下一步使用的 xₖ₊₁。" },
];

export function SemanticVisualizer({ operator, resetKey }: { operator: OperatorDetail; resetKey: string }) {
  const animation = useOperatorAnimation(eulerSteps.length, resetKey);
  if (operator.definitionId !== "euler-update") return <AnalysisPlaceholder
    title="逐步计算图未填写" state="not_recorded" detail="当前公式与输入输出形状见“概览”。" />;
  return <ComputationStepper title="Euler：沿速度更新动作状态" formula={operator.formula}
    steps={eulerSteps} animation={animation}>
    <div className="computation-euler">
      <span data-active={animation.frame === 0}>xₖ</span><b>+</b>
      <span data-active={animation.frame === 1}>Δt × vₖ</span><b>=</b>
      <span data-active={animation.frame === 2}>xₖ₊₁</span>
    </div>
  </ComputationStepper>;
}
