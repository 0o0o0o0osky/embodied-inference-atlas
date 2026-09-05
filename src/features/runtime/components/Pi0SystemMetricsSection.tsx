import type { TimingValue } from "../../end-to-end/domain/buildEvidenceRows";
import type { RuntimeSystemSlice, RuntimeSystemSummaryModel } from "../domain/buildRuntimeSystemSummary";

export interface Pi0SystemMetricsSectionProps {
  summary: RuntimeSystemSummaryModel;
  selectedRuntimeId: string | null;
  selectedPrecisionId: string | null;
  onSliceChange: (slice: RuntimeSystemSlice) => void;
  onSelectRow: (runtimeId: string, precisionId: string) => void;
}

const CONTRACT_LABELS: Readonly<Record<string, string>> = {
  "deterministic-preprocessed-observation": "确定性预处理输入",
  "synthetic-vla-observation": "合成 VLA 输入",
  "action-chunk": "动作块",
  cached_prompt_and_graph: "复用 prompt 与 CUDA Graph",
  synthetic_inputs: "合成输入",
  predict_cached_graph_sync: "缓存图预测及同步",
  vlacpp_engine_predict_synthetic: "引擎合成输入预测",
  unknown: "未知",
};

function contractLabel(value: string) {
  return CONTRACT_LABELS[value] ?? value.replaceAll("_", " ");
}

function timing(value: TimingValue | null) {
  return value?.value == null ? "未记录" : `${value.value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} ${value.unit}`;
}

export function Pi0SystemMetricsSection({ summary: model, selectedRuntimeId, selectedPrecisionId, onSliceChange, onSelectRow }: Pi0SystemMetricsSectionProps) {
  return (
    <section className="pi0-funnel-section pi0-system-metrics" aria-labelledby="pi0-system-title">
      <header className="pi0-funnel-heading">
        <h3 id="pi0-system-title">总体表现</h3>
        <div className="pi0-funnel-controls">
          <label>视角数 V
            <select value={model.slice.cameraViews} onChange={(event) => onSliceChange({ ...model.slice, cameraViews: Number(event.target.value) })}>
              {model.sliceOptions.cameraViews.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>执行 prompt tokens
            <select value={model.slice.promptTokens} onChange={(event) => onSliceChange({ ...model.slice, promptTokens: Number(event.target.value) })}>
              {model.sliceOptions.promptTokens.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>
      </header>
      <p className="pi0-funnel-note">实测 mean 优先，缺失时使用 p50；按测量口径分组。正确性尚未评估，跨口径不作速度比较。</p>
      {model.contractGroups.length ? (
        <div className="pi0-funnel-table-wrap">
          <table className="pi0-system-table" aria-label="按测量口径分组的推理栈总体表现">
            <thead><tr><th scope="col">推理栈</th><th scope="col">实际精度</th><th scope="col">端到端</th><th scope="col" className="pi0-system-optional">P95</th><th scope="col" className="pi0-system-optional">每次运行样本数</th><th scope="col">Profiler 覆盖</th></tr></thead>
            {model.contractGroups.map((group) => (
              <tbody key={group.id}>
                <tr className="pi0-contract-heading"><th scope="rowgroup" colSpan={6}>
                  <strong>{contractLabel(group.contract.inputContractId)} · {contractLabel(group.contract.outputContractId)} {group.contract.actionShape.map((value) => value ?? "?").join(" × ")}</strong>
                  <span>状态复用：{contractLabel(group.contract.stateReuse)}；计时边界：{contractLabel(group.contract.timingBoundaryId)}；运行点：{contractLabel(group.contract.operatingPointId)}</span>
                </th></tr>
                {group.rows.map((row, index) => {
                  const selected = selectedRuntimeId === row.runtimeId && selectedPrecisionId === row.precisionId;
                  return <tr key={`${row.runtimeId}/${row.precisionId}/${index}`} className={selected ? "is-selected" : undefined}>
                    <th scope="row"><button type="button" aria-pressed={selected} onClick={() => onSelectRow(row.runtimeId, row.precisionId)}>{row.runtimeLabel}<small>{selected ? "当前选择" : "选择推理栈"}</small></button></th>
                    <td>{row.precisionLabel}</td>
                    <td><strong className="pi0-funnel-number">{timing(row.latency)}</strong>{row.latency?.value != null ? <small>{row.latency.statistic}</small> : null}<small className="pi0-system-mobile-detail">P95：{timing(row.p95)}<br />样本数：{row.sampleCount ?? "未记录"}</small></td>
                    <td className="pi0-system-optional pi0-funnel-number">{timing(row.p95)}</td>
                    <td className="pi0-system-optional pi0-funnel-number">{row.sampleCount ?? "未记录"}</td>
                    <td>{(["nsys", "ncu"] as const).map((tool) => <span key={tool} className="pi0-profiler-coverage">{tool === "nsys" ? "Nsys" : "NCU"} {row.profiler[tool].state === "available" ? `${row.profiler[tool].captureCount} 份` : "未采集"}</span>)}</td>
                  </tr>;
                })}
              </tbody>
            ))}
          </table>
        </div>
      ) : <p className="pi0-funnel-empty">所选视角数与 prompt 长度暂无端到端实测记录，请切换输入切片。</p>}
      <p className="pi0-funnel-note">Profiler 覆盖按推理栈与实际精度统计，不代表与此输入切片或端到端测量为同次执行。</p>
      {model.unavailable.length ? <p className="pi0-funnel-unavailable">其他推理栈：{model.unavailable.map((stack) => `${stack.displayName}（${stack.state}）`).join("；")}</p> : null}
    </section>
  );
}
