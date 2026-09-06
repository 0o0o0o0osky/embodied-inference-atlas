import type { Pi0AnalyticalResult } from "../../roofline/presentation/buildOperatorRooflineSummary";
import { formatTime } from "../../roofline/presentation/viewModel";
import type { RuntimeBounds } from "../domain/runtimeBounds";
import "./runtimeBounds.css";

export function RuntimeBoundSummary({ bounds, reference, onOpenImplementation, onOpenTheory }: {
  bounds: RuntimeBounds;
  reference: Pi0AnalyticalResult;
  onOpenImplementation: () => void;
  onOpenTheory: () => void;
}) {
  const model = reference.status === "available" ? reference.value.modelTotal : null;
  return <section className="runtime-bound-summary" aria-label="当前执行方案下界">
    <div className="runtime-bound-primary">
      <span>当前执行方案下界</span>
      <strong>{bounds.endToEnd?.point.derived.roof_second != null ? formatTime(bounds.endToEnd.point.derived.roof_second) : "尚不可汇总"}</strong>
      <button type="button" onClick={onOpenImplementation}>查看局部下界</button>
    </div>
    <details>
      <summary>下界依据与模型参考</summary>
      <p>{bounds.reason}</p>
      <div className="runtime-bound-rule"><span>融合 / 量化后的局部下界</span><span aria-hidden="true">→</span><span>执行依赖 + 共享资源约束</span><span aria-hidden="true">→</span><span>整条预测路径</span></div>
      <p>确认串行的部分可相加；并行部分按依赖与资源约束汇总。包含必要的 CPU、同步和数据搬运；缺项不补零。</p>
      <div className="runtime-model-reference"><span>BF16 模型参考 <strong>{model?.derived.roof_second != null ? formatTime(model.derived.roof_second) : "未建立"}</strong></span><button type="button" onClick={onOpenTheory}>查看模型理论</button></div>
      <p>这是同输入形状的模型解析估计，不代表当前栈的融合、量化或端到端下界，不据此计算差距。</p>
    </details>
  </section>;
}
