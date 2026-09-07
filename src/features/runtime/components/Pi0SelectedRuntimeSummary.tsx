import type { VlaWorkloadRecord } from "../../../types/atlas";
import type { TimingValue } from "../../end-to-end/domain/buildEvidenceRows";

type SelectedWorkload = Pick<VlaWorkloadRecord,
  "camera_views" | "executed_prompt_tokens" | "action_chunk" | "denoise_steps">;

export type Pi0RuntimeSelectionKind =
  | "target_measurement"
  | "native_evidence"
  | "symbolic_target"
  | "unsupported"
  | "profiler_capture"
  | "incomplete_input";

interface Pi0SelectedRuntimeSummaryProps {
  runtimeLabel: string;
  precisionLabel: string;
  latency: TimingValue | null;
  workload: SelectedWorkload;
  workloadStatus: "complete" | "partial";
  selectionKind: Pi0RuntimeSelectionKind;
}

const STATISTIC_LABELS: Readonly<Record<string, string>> = {
  mean: "均值",
  p50: "中位数",
  analytical_estimate: "理论估计",
};

const SELECTION_LABELS: Readonly<Record<Pi0RuntimeSelectionKind, string>> = {
  incomplete_input: "输入信息待补",
  target_measurement: "目标点实测",
  native_evidence: "已有原生证据",
  symbolic_target: "目标配置待测",
  unsupported: "当前形状不支持",
  profiler_capture: "独立性能采集",
};

const SELECTION_NOTES: Readonly<Record<Pi0RuntimeSelectionKind, string>> = {
  incomplete_input: "填写当前模型的输入维度后，可关联相应测量。",
  target_measurement: "与当前输入形状匹配；预热 5 次，正式测量 10 次。",
  native_evidence: "这是该推理栈已有的原生测量，未完全匹配当前输入形状或 5+10 采样口径。",
  symbolic_target: "当前只是待采集的目标坐标；没有借用其他输入配置的延时。",
  unsupported: "现有实现不支持当前形状；下方可查看当前栈的执行结构。",
  profiler_capture: "当前为独立 Profiler 采集，不将其窗口时长当作无 Profiler 的端到端统计。",
};

function value(item: number | null, suffix = "") {
  return item === null ? "未记录" : `${item}${suffix}`;
}

export function Pi0SelectedRuntimeSummary({
  runtimeLabel,
  precisionLabel,
  latency,
  workload,
  workloadStatus,
  selectionKind,
}: Pi0SelectedRuntimeSummaryProps) {
  return (
    <section className="pi0-selected-runtime" aria-labelledby="pi0-selected-runtime-title">
      <header>
        <div className="pi0-selected-runtime-identity">
          <div className="pi0-selected-runtime-state">
            <span>{SELECTION_LABELS[selectionKind]}</span>
            {workloadStatus === "partial" ? <strong>部分上下文</strong> : null}
          </div>
          <h3 id="pi0-selected-runtime-title">{runtimeLabel}</h3>
          <small>{precisionLabel}</small>
        </div>
        <div className="pi0-selected-latency">
          <span>端到端延时</span>
          <strong>{latency?.value == null ? selectionKind === "incomplete_input" ? "未填写输入" : selectionKind === "profiler_capture" ? "未关联" : selectionKind === "unsupported" ? "不支持" : "待测" : `${latency.value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} ${latency.unit}`}</strong>
          <small>{latency ? STATISTIC_LABELS[latency.statistic] ?? latency.statistic : "无匹配实测"}</small>
        </div>
      </header>
      {workloadStatus === "partial" ? <p className="pi0-selected-runtime-note">输入维度待补充，已知信息列于下方。</p> : null}
      <dl>
        <div><dt>视角</dt><dd>{value(workload.camera_views)}</dd></div>
        <div><dt>提示长度</dt><dd>{value(workload.executed_prompt_tokens)}</dd></div>
        <div><dt>动作块</dt><dd>{value(workload.action_chunk)}</dd></div>
        <div><dt>去噪</dt><dd>{value(workload.denoise_steps, " 步")}</dd></div>
      </dl>
      <details className="pi0-selected-measurement-note"><summary>测量说明</summary><p>{SELECTION_NOTES[selectionKind]}</p></details>
    </section>
  );
}
