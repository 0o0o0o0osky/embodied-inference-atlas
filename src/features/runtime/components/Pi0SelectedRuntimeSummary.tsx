import type { TimingValue } from "../../end-to-end/domain/buildEvidenceRows";
import type { VlaWorkloadRecord } from "../../../types/atlas";

type SelectedWorkload = Pick<VlaWorkloadRecord,
  "camera_views" | "executed_prompt_tokens" | "action_chunk" | "denoise_steps">;

interface Pi0SelectedRuntimeSummaryProps {
  runtimeLabel: string;
  precisionLabel: string;
  latency: TimingValue | null;
  workload: SelectedWorkload;
}

const STATISTIC_LABELS: Readonly<Record<string, string>> = {
  mean: "均值",
  p50: "中位数",
  analytical_estimate: "理论估计",
};

function value(value: number | null, suffix = "") {
  return value === null ? "未记录" : `${value}${suffix}`;
}

export function Pi0SelectedRuntimeSummary({ runtimeLabel, precisionLabel, latency, workload }: Pi0SelectedRuntimeSummaryProps) {
  return (
    <section className="pi0-selected-runtime" aria-labelledby="pi0-selected-runtime-title">
      <header>
        <div>
          <span>当前推理栈</span>
          <h3 id="pi0-selected-runtime-title">{runtimeLabel}</h3>
          <small>{precisionLabel}</small>
        </div>
        <div className="pi0-selected-latency">
          <span>端到端延时</span>
          <strong>{latency?.value == null ? "目标配置待测" : `${latency.value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} ${latency.unit}`}</strong>
          <small>{latency ? STATISTIC_LABELS[latency.statistic] ?? latency.statistic : "未借用其他输入配置"}</small>
        </div>
      </header>
      <dl>
        <div><dt>视角</dt><dd>{value(workload.camera_views)}</dd></div>
        <div><dt>提示长度</dt><dd>{value(workload.executed_prompt_tokens)}</dd></div>
        <div><dt>动作块</dt><dd>{value(workload.action_chunk)}</dd></div>
        <div><dt>去噪</dt><dd>{value(workload.denoise_steps, " 步")}</dd></div>
      </dl>
    </section>
  );
}
