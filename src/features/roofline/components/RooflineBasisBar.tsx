import type { InteractiveWorkload, InteractiveWorkloadBounds } from "../data/materialize";
import type { RooflineViewModel } from "../presentation/viewModel";
import { formatNumber } from "../presentation/viewModel";
import { IntegerInput } from "../../../components/IntegerInput";
import { WORKLOAD_LABELS } from "../../model-graph/presentation/terminology";

export function RooflineBasisBar({model, workload, workloadBounds, onWorkload}: {
  model: RooflineViewModel;
  workload: InteractiveWorkload;
  workloadBounds: InteractiveWorkloadBounds;
  onWorkload: (value: InteractiveWorkload) => void;
}) {
  const basis = model.activeBasis;
  if (!basis) return null;
  const update = (field: keyof InteractiveWorkload, value: number) => onWorkload({...workload,[field]:value});
  const bandwidth = model.curves[0];
  return <section className="theory-basis-controls">
    <div className="roofline-workload-controls">
      <label><span>{WORKLOAD_LABELS.V}</span><IntegerInput aria-label={WORKLOAD_LABELS.V} min={1} value={workload.executedCameraViews} onValueChange={value => update("executedCameraViews",value)} /></label>
      <label><span>{WORKLOAD_LABELS.L_PROMPT}</span><IntegerInput aria-label={WORKLOAD_LABELS.L_PROMPT} min={workloadBounds.promptMinimum} max={workloadBounds.promptMaximum ?? undefined} value={workload.executedPromptTokens} onValueChange={value => update("executedPromptTokens",value)} /></label>
      <label><span>{WORKLOAD_LABELS.T_ACTION}</span><IntegerInput aria-label={WORKLOAD_LABELS.T_ACTION} min={1} value={workload.actionHorizon} onValueChange={value => update("actionHorizon",value)} /></label>
      <label><span>{WORKLOAD_LABELS.N_DENOISE}</span><IntegerInput aria-label={WORKLOAD_LABELS.N_DENOISE} min={1} value={workload.denoiseSteps} onValueChange={value => update("denoiseSteps",value)} /></label>
    </div>
    <p>计算上限：{model.curves.map(curve => `${formatNumber(curve.computeFlopPerSecond / 1e12)} TFLOP/s`).join("；") || "未建立"}；带宽上限：{bandwidth ? `${formatNumber(bandwidth.bandwidthBytePerSecond / 1e9)} GB/s` : "未建立"}。</p>
    <details><summary>完整计算口径</summary><code>{basis.basis_id}</code><p>{basis.provenance.condition}</p></details>
  </section>;
}
