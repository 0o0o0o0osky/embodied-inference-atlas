import type { CSSProperties } from "react";

import type {
  Pi0NativeEvidenceSelection,
  Pi0PerformanceCell,
  Pi0PerformanceFacet,
  Pi0PerformanceGroup,
  Pi0PerformanceMeasuredCell,
  Pi0PerformanceOverviewModel,
  Pi0PerformanceSelection,
} from "../domain/buildPi0PerformanceOverview";
import "./pi0PerformanceOverviewChart.css";

export type Pi0RoutablePerformanceSelection =
  | Pi0PerformanceSelection
  | Pi0NativeEvidenceSelection;

export interface Pi0PerformanceOverviewChartProps {
  model: Pi0PerformanceOverviewModel;
  selectedRunId: string | null;
  onSelectEvidence: (selection: Pi0RoutablePerformanceSelection) => void;
}

const CONTRACT_LABELS: Readonly<Record<string, string>> = {
  "deterministic-preprocessed-observation": "确定性预处理观测",
  "deterministic-observation": "确定性观测",
  "synthetic-vla-observation": "合成 VLA 观测",
  "synthetic-observation": "合成观测",
  "action-chunk": "动作块",
  cached_prompt_and_graph: "复用提示与 CUDA Graph",
  cached: "复用缓存",
  synthetic_inputs: "合成输入",
  predict_cached_graph_sync: "缓存图预测并同步",
  vlacpp_engine_predict_synthetic: "引擎合成输入预测",
  predict: "预测窗口",
  "predict-with-preprocess": "预处理与预测",
  unknown: "运行点未记录",
};

const PRECISION_LABELS: Readonly<Record<string, string>> = {
  "mixed-fp8-e4m3-fp16": "混合 FP8 / FP16",
  "mixed-bf16-fp32": "BF16 / FP32 累加",
  "uniform-fp16": "FP16",
  "uniform-bf16": "BF16",
  q8_0: "Q8_0 权重量化",
  "q8_0-weight-only": "Q8_0 权重量化",
};

const STATISTIC_LABELS: Readonly<Record<string, string>> = {
  mean: "均值",
  p50: "中位数",
};

function label(value: string): string {
  return CONTRACT_LABELS[value] ?? value.replaceAll("_", " ");
}

function precisionLabel(value: string): string {
  return PRECISION_LABELS[value] ?? value;
}

function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const ceiling = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return ceiling * magnitude;
}

function formatTick(value: number): string {
  return value.toLocaleString("zh-CN", { maximumFractionDigits: value < 10 ? 1 : 0 });
}

function pointLabel(facet: Pi0PerformanceFacet, cell: Pi0PerformanceMeasuredCell): string {
  const statistic = STATISTIC_LABELS[cell.latency.statistic] ?? cell.latency.statistic;
  return `${facet.runtimeLabel}，${cell.cameraViews} 个视角，动作块 ${cell.actionChunk}，端到端${statistic} ${cell.latency.value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} ${cell.latency.unit}，查看详情`;
}

function statusLabel(cell: Pi0PerformanceCell): string {
  if (cell.state === "measured") return "已测";
  if (cell.state === "unsupported") return "不支持";
  return cell.reason === "multiple_exact_measurements" ? "待复核" : "待测";
}

function statusTitle(cell: Pi0PerformanceCell): string {
  if (cell.state === "measured") {
    return `${statusLabel(cell)}：${cell.latency.value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} ${cell.latency.unit}`;
  }
  if (cell.state === "unsupported") {
    return cell.reason === "fixed_action_horizon"
      ? "源码审计表明该实现的固定动作长度与此目标点不兼容"
      : "源码审计表明该实现的固定去噪步数与此目标点不兼容";
  }
  return cell.reason === "multiple_exact_measurements"
    ? "存在多个精确记录，需要先复核口径"
    : "此目标点尚无精确本地测量";
}

function contractSummary(facet: Pi0PerformanceFacet): string {
  return `${label(facet.contract.inputContractId)} → ${label(facet.contract.outputContractId)} · ${label(facet.contract.timingBoundaryId)}`;
}

function contractTitle(facet: Pi0PerformanceFacet): string {
  const { contract } = facet;
  return [
    `模型制品：${contract.modelArtifactId}`,
    `输入：${label(contract.inputContractId)}`,
    `输出：${label(contract.outputContractId)}`,
    `状态：${label(contract.stateReuse)}`,
    `计时边界：${label(contract.timingBoundaryId)}`,
    `运行点：${label(contract.operatingPointId)}`,
    `统计：${contract.statistic ? STATISTIC_LABELS[contract.statistic] ?? contract.statistic : "未记录"}`,
  ].join("\n");
}

function observedScopeSummary(facet: Pi0PerformanceFacet): string {
  const scope = facet.observedScope;
  const denoise = [
    ...scope.denoiseSteps.map(String),
    ...(scope.hasMissingDenoise ? ["未记录"] : []),
  ].join("/") || "未记录";
  return `原生证据 P=${scope.promptTokens.join("/") || "未记录"} · A=${scope.actionChunks.join("/") || "未记录"} · N=${denoise}`;
}

function TargetMatrix({
  facet,
  focus,
  selectedRunId,
  onSelectEvidence,
}: {
  facet: Pi0PerformanceFacet;
  focus: { cameraViews: number; actionChunk: number };
  selectedRunId: string | null;
  onSelectEvidence: (selection: Pi0RoutablePerformanceSelection) => void;
}) {
  return (
    <table className="pi0-target-matrix">
      <caption className="visually-hidden">{facet.runtimeLabel} 的目标采样状态；行为动作块，列为视角数</caption>
      <thead>
        <tr>
          <th scope="col">动作块</th>
          {facet.series[0]?.cells.map((cell) => <th key={cell.cameraViews} scope="col">V={cell.cameraViews}</th>)}
        </tr>
      </thead>
      <tbody>
        {facet.series.map((series) => (
          <tr key={series.actionChunk}>
            <th scope="row">A={series.actionChunk}</th>
            {series.cells.map((cell) => {
              const selected = cell.state === "measured" && selectedRunId === cell.selection.runId;
              const focused = cell.cameraViews === focus.cameraViews && cell.actionChunk === focus.actionChunk;
              const contents = <>
                <i className="pi0-target-state-mark" aria-hidden="true" />
                <span>{statusLabel(cell)}</span>
                {cell.state === "measured" ? <small>{cell.latency.value.toLocaleString("zh-CN", { maximumFractionDigits: 1 })} {cell.latency.unit}</small> : null}
              </>;
              return (
                <td key={cell.cameraViews} className={`is-${cell.state}${selected ? " is-selected" : ""}${focused ? " is-focus" : ""}`} title={statusTitle(cell)}>
                  {cell.state === "measured" ? (
                    <button type="button" onClick={() => onSelectEvidence(cell.selection)}>{contents}</button>
                  ) : <div>{contents}</div>}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function firstMeasuredCell(facet: Pi0PerformanceFacet): Pi0PerformanceMeasuredCell | null {
  return facet.series.flatMap((series) => series.cells)
    .find((cell): cell is Pi0PerformanceMeasuredCell => cell.state === "measured") ?? null;
}

function cellAt(
  facet: Pi0PerformanceFacet,
  coordinate: Pi0PerformanceOverviewModel["defaultCoordinate"],
): Pi0PerformanceCell | null {
  return facet.series.find((series) => series.actionChunk === coordinate.actionChunk)
    ?.cells.find((cell) => cell.cameraViews === coordinate.cameraViews) ?? null;
}

function ComparisonBars({
  groups,
  coordinate,
  onSelectEvidence,
}: {
  groups: readonly Pi0PerformanceGroup[];
  coordinate: Pi0PerformanceOverviewModel["defaultCoordinate"];
  onSelectEvidence: (selection: Pi0RoutablePerformanceSelection) => void;
}) {
  const measured = groups.flatMap((group) => group.comparison.state === "measured"
    && Number.isFinite(group.comparison.cell.latency.value) ? [group.comparison] : []);
  const unit = measured[0]?.cell.latency.unit ?? "ms";
  const scaled = measured.filter((comparison) => comparison.cell.latency.unit === unit);
  const maximum = niceCeiling(Math.max(...scaled.map((comparison) => comparison.cell.latency.value), 0));
  const statistics = [...new Set(measured.map((comparison) => comparison.cell.latency.statistic))];
  const statistic = statistics.length === 1
    ? STATISTIC_LABELS[statistics[0]!] ?? statistics[0]!
    : "各口径统计量";

  return (
    <section className="pi0-overview-comparison" aria-labelledby="pi0-overview-comparison-title">
      <header>
        <div>
          <h4 id="pi0-overview-comparison-title">同坐标实测</h4>
          <p>V={coordinate.cameraViews} · A={coordinate.actionChunk} · P=48 · N=10 · {statistic}</p>
        </div>
        <p>统一横轴读取绝对延时；不同测量口径不合并，也不计算加速比。</p>
      </header>
      <div className="pi0-comparison-axis" aria-hidden="true">
        <span>0</span><span>{formatTick(maximum / 2)}</span><span>{formatTick(maximum)} {unit}</span>
      </div>
      <div className="pi0-comparison-rows">
        {groups.map((group) => {
          const comparison = group.comparison;
          const primaryFacet = group.facets.find((facet) => facet.id === group.primaryFacetId) ?? group.facets[0]!;
          const focusedCell = cellAt(primaryFacet, coordinate);
          const canScale = comparison.state === "measured" && comparison.cell.latency.unit === unit;
          const width = canScale ? Math.max(2, comparison.cell.latency.value / maximum * 100) : 0;
          return (
            <div className="pi0-comparison-row" key={group.id}>
              <div className="pi0-comparison-identity">
                <strong>{group.runtimeLabel}</strong>
                <span>{precisionLabel(group.precisionId)}</span>
              </div>
              <div className="pi0-comparison-track">
                {canScale ? <button
                  type="button"
                  className="pi0-comparison-bar"
                  style={{ "--pi0-bar-width": `${width}%` } as CSSProperties}
                  title={pointLabel(comparison.facet, comparison.cell)}
                  onClick={() => onSelectEvidence(comparison.cell.selection)}
                ><span>{comparison.cell.latency.value.toLocaleString("zh-CN", { maximumFractionDigits: 1 })} {unit}</span></button>
                  : <span className="pi0-comparison-missing">{comparison.state === "multiple_contracts"
                    ? `${comparison.measurements.length} 个独立口径，展开查看`
                    : comparison.state === "measured" ? `单位 ${comparison.cell.latency.unit}，未纳入横轴`
                      : focusedCell?.state === "unsupported" ? "当前坐标不支持" : "此坐标暂无精确实测"}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function GroupPanel({
  group,
  coordinate,
  selectedRunId,
  onSelectEvidence,
}: {
  group: Pi0PerformanceGroup;
  coordinate: Pi0PerformanceOverviewModel["defaultCoordinate"];
  selectedRunId: string | null;
  onSelectEvidence: (selection: Pi0RoutablePerformanceSelection) => void;
}) {
  const facet = group.facets.find((candidate) => candidate.id === group.primaryFacetId) ?? group.facets[0]!;
  const nativeEvidence = [facet, ...group.facets.filter((candidate) => candidate.id !== facet.id)]
    .find((candidate) => candidate.nativeEvidenceSelection)?.nativeEvidenceSelection ?? null;

  return (
    <article className="pi0-overview-facet" aria-labelledby={`pi0-overview-${encodeURIComponent(group.id)}`}>
      <header>
        <div className="pi0-overview-facet-identity">
          <h4 id={`pi0-overview-${encodeURIComponent(group.id)}`}>{group.runtimeLabel}</h4>
          <span>{precisionLabel(group.precisionId)}</span>
        </div>
        <button
          className="pi0-overview-evidence-action"
          type="button"
          disabled={!nativeEvidence}
          onClick={() => nativeEvidence && onSelectEvidence(nativeEvidence)}
        >
          {nativeEvidence ? "查看已有原生证据" : "暂无可下钻证据"}
        </button>
      </header>
      <p className="pi0-overview-contract" title={contractTitle(facet)}>当前口径：{contractSummary(facet)}</p>
      <TargetMatrix facet={facet} focus={coordinate} selectedRunId={selectedRunId} onSelectEvidence={onSelectEvidence} />
      <p className="pi0-overview-observed">{observedScopeSummary(facet)}</p>
      {group.facets.length > 1 ? (
        <details className="pi0-overview-contracts">
          <summary>{group.facets.length} 个独立测量口径</summary>
          <div>
            {group.facets.map((candidate, index) => {
              const measured = firstMeasuredCell(candidate);
              const evidence = measured?.selection ?? candidate.nativeEvidenceSelection;
              return <section key={candidate.id}>
                <p title={contractTitle(candidate)}><strong>口径 {index + 1}</strong><span>{contractSummary(candidate)}</span></p>
                {evidence ? <button type="button" onClick={() => onSelectEvidence(evidence)}>查看证据</button> : <span>暂无证据入口</span>}
              </section>;
            })}
          </div>
        </details>
      ) : null}
    </article>
  );
}

export function Pi0PerformanceOverviewChart({ model, selectedRunId, onSelectEvidence }: Pi0PerformanceOverviewChartProps) {
  return (
    <section className="pi0-performance-overview" aria-labelledby="pi0-performance-overview-title">
      <header className="pi0-overview-heading">
        <div>
          <h3 id="pi0-performance-overview-title">端到端总体表现</h3>
          <p>{model.hardwareLabel} · P=48 · N=10 · V=1/2/3 · A=20/50</p>
        </div>
        <p className="pi0-overview-progress"><strong>{model.defaultCoordinate.measuredGroupCount}</strong> 个推理栈/精度组在默认坐标有精确实测</p>
      </header>
      {model.groups.length ? (<>
        <ComparisonBars groups={model.groups} coordinate={model.defaultCoordinate} onSelectEvidence={onSelectEvidence} />
        <div className="pi0-overview-facets">
          {model.groups.map((group) => <GroupPanel
            key={group.id}
            group={group}
            coordinate={model.defaultCoordinate}
            selectedRunId={selectedRunId}
            onSelectEvidence={onSelectEvidence}
          />)}
        </div>
      </>) : (
        <p className="pi0-overview-empty">当前硬件尚无本地端到端证据，无法建立推理栈分面；目标采样格保持待测。</p>
      )}
      <footer>每个推理栈与实际精度只出现一次；目标格只接受精确匹配的本地实测，其他 workload 与不同 comparison contract 均在组内下钻。</footer>
    </section>
  );
}
