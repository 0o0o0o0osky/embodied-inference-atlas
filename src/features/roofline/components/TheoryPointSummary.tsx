import type { RooflinePointRecord } from "../domain/types";
import { formatQuantity, formatNumber, formatTime } from "../presentation/viewModel";
import { modelDisplayText } from "../../model-graph/presentation/ModelDisplay";

const LIMITERS = { compute: "计算受限", memory: "带宽受限", dependency: "依赖路径受限", tie: "计算与带宽并列", unknown: "尚不可判定" };
const LABELS: Record<string, string> = {
  "Model total": "模型整体", "Vision Encoder": "视觉编码器",
  "Prefix Encoder": "前缀编码器", "Action Flow Decoder": "动作解码器",
  "Q @ Kᵀ score": "Q @ Kᵀ 分数矩阵", "P @ V value": "P @ V 加权求和",
  "Scale / mask / softmax": "缩放 / 掩码 / Softmax", "Partial envelope": "部分计算的组合下界",
};

export function theoryPointLabel(label: string): string {
  return label.split(" · ").map((part) => LABELS[part] ?? modelDisplayText("pi0", part)).join(" · ");
}

export function TheoryPointSummary({ point }: { point: RooflinePointRecord | null }) {
  if (!point) return <aside className="theory-point-summary"><h3>选择图中的阶段或算子</h3><p>查看形状、理论时间与瓶颈。</p></aside>;
  return <aside className="theory-point-summary">
    <header>
      <h3>{theoryPointLabel(point.entity.label)}</h3>
      <strong>{point.derived.roof_second === null ? "暂无下界" : formatTime(point.derived.roof_second)}</strong>
      <span>{LIMITERS[point.derived.limiter]}</span>
    </header>
    <dl>
      <div><dt>工作量</dt><dd>{formatQuantity(point.work.total_flop, "FLOP")}</dd></div>
      <div><dt>建模访存</dt><dd>{formatQuantity(point.traffic.total_byte, "B")}</dd></div>
      <div><dt>算术强度</dt><dd>{point.derived.arithmetic_intensity_flop_per_byte === null ? "未建立" : `${formatNumber(point.derived.arithmetic_intensity_flop_per_byte)} FLOP/B`}</dd></div>
      <div><dt>解析覆盖</dt><dd>{point.coverage.status === "complete" && point.derived.status === "complete" ? "完整" : "部分下界"}</dd></div>
    </dl>
    <details><summary>形状与计算范围</summary><p>{point.entity.shape_or_coverage}</p><p>累计调用 {point.calls} 次</p></details>
    <p>理论时间不含运行时开销。缺失的工作量不会补零；理论点位不表示实测效率。</p>
  </aside>;
}
