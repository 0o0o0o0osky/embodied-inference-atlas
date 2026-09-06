import type { KeyboardEvent } from "react";

import type {
  Pi0NativeEvidenceSelection,
  Pi0PerformanceCell,
  Pi0PerformanceFacet,
  Pi0PerformanceMeasuredCell,
  Pi0PerformanceOverviewModel,
  Pi0PerformanceSelection,
  Pi0PerformanceSeries,
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

const WIDTH = 600;
const HEIGHT = 166;
const PLOT_LEFT = 68;
const PLOT_RIGHT = 574;
const PLOT_TOP = 34;
const PLOT_BOTTOM = 120;
const VIEW_X = [176, 350, 524] as const;

function label(value: string): string {
  return CONTRACT_LABELS[value] ?? value.replaceAll("_", " ");
}

function precisionLabel(value: string): string {
  return PRECISION_LABELS[value] ?? value;
}

function finiteMeasuredCells(facet: Pi0PerformanceFacet): Pi0PerformanceMeasuredCell[] {
  return facet.series.flatMap((series) => series.cells.flatMap((cell) =>
    cell.state === "measured" && Number.isFinite(cell.latency.value) ? [cell] : [],
  ));
}

function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const ceiling = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return ceiling * magnitude;
}

function yFor(value: number, maximum: number): number {
  const normalized = Math.max(0, Math.min(1, value / maximum));
  return PLOT_BOTTOM - normalized * (PLOT_BOTTOM - PLOT_TOP);
}

function contiguousSegments(series: Pi0PerformanceSeries): Pi0PerformanceMeasuredCell[][] {
  const segments: Pi0PerformanceMeasuredCell[][] = [];
  let current: Pi0PerformanceMeasuredCell[] = [];
  series.cells.forEach((cell) => {
    if (cell.state === "measured") {
      current.push(cell);
      return;
    }
    if (current.length) segments.push(current);
    current = [];
  });
  if (current.length) segments.push(current);
  return segments;
}

function linePath(segment: readonly Pi0PerformanceMeasuredCell[], maximum: number): string {
  return segment.map((cell, index) => {
    const x = VIEW_X[cell.cameraViews - 1] ?? PLOT_LEFT;
    return `${index ? "L" : "M"} ${x} ${yFor(cell.latency.value, maximum)}`;
  }).join(" ");
}

function formatTick(value: number): string {
  return value.toLocaleString("zh-CN", { maximumFractionDigits: value < 10 ? 1 : 0 });
}

function pointLabel(facet: Pi0PerformanceFacet, cell: Pi0PerformanceMeasuredCell): string {
  const statistic = STATISTIC_LABELS[cell.latency.statistic] ?? cell.latency.statistic;
  return `${facet.runtimeLabel}，${cell.cameraViews} 个视角，动作块 ${cell.actionChunk}，端到端${statistic} ${cell.latency.value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} ${cell.latency.unit}，查看详情`;
}

function activatePoint(
  event: KeyboardEvent<SVGGElement>,
  selection: Pi0PerformanceSelection,
  onSelectEvidence: (selection: Pi0RoutablePerformanceSelection) => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onSelectEvidence(selection);
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
  selectedRunId,
  onSelectEvidence,
}: {
  facet: Pi0PerformanceFacet;
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
              const contents = <>
                <i className="pi0-target-state-mark" aria-hidden="true" />
                <span>{statusLabel(cell)}</span>
                {cell.state === "measured" ? <small>{cell.latency.value.toLocaleString("zh-CN", { maximumFractionDigits: 1 })} {cell.latency.unit}</small> : null}
              </>;
              return (
                <td key={cell.cameraViews} className={`is-${cell.state}${selected ? " is-selected" : ""}`} title={statusTitle(cell)}>
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

function CompactMeasuredPlot({
  facet,
  measured,
  selectedRunId,
  onSelectEvidence,
}: {
  facet: Pi0PerformanceFacet;
  measured: readonly Pi0PerformanceMeasuredCell[];
  selectedRunId: string | null;
  onSelectEvidence: (selection: Pi0RoutablePerformanceSelection) => void;
}) {
  const maximum = niceCeiling(Math.max(...measured.map((cell) => cell.latency.value)));
  const unit = facet.contract.unit ?? measured[0]?.latency.unit ?? "未记录";
  const ticks = [maximum, maximum / 2, 0];
  return (
    <svg className="pi0-overview-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${facet.runtimeLabel} 目标采样格中的已测端到端延时`}>
      <text className="pi0-overview-axis-title" x={PLOT_LEFT} y={18}>端到端延时 / {unit}</text>
      {ticks.map((tick) => {
        const y = yFor(tick, maximum);
        return <g key={tick} className="pi0-overview-gridline">
          <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={y} y2={y} />
          <text x={PLOT_LEFT - 10} y={y + 4}>{formatTick(tick)}</text>
        </g>;
      })}
      {facet.series.flatMap((series) => contiguousSegments(series).map((segment, index) =>
        segment.length > 1 ? <path
          key={`${series.actionChunk}/segment/${index}`}
          className={`pi0-overview-series-line is-a-${series.actionChunk}`}
          d={linePath(segment, maximum)}
          pathLength={1}
        /> : null,
      ))}
      {facet.series.flatMap((series) => series.cells.flatMap((cell) => {
        if (cell.state !== "measured") return [];
        const x = VIEW_X[cell.cameraViews - 1] ?? PLOT_LEFT;
        const y = yFor(cell.latency.value, maximum);
        const selected = selectedRunId === cell.selection.runId;
        return [<g
          key={`${series.actionChunk}/${cell.cameraViews}`}
          className={`pi0-overview-point is-a-${series.actionChunk}${selected ? " is-selected" : ""}`}
          role="button"
          tabIndex={0}
          aria-label={pointLabel(facet, cell)}
          onClick={() => onSelectEvidence(cell.selection)}
          onKeyDown={(event) => activatePoint(event, cell.selection, onSelectEvidence)}
        >
          <title>{pointLabel(facet, cell)}</title>
          <circle className="pi0-overview-point-halo" cx={x} cy={y} r={10} />
          {series.actionChunk === 50
            ? <rect className="pi0-overview-point-shape" x={x - 4.5} y={y - 4.5} width={9} height={9} rx={1} />
            : <circle className="pi0-overview-point-shape" cx={x} cy={y} r={4.75} />}
          <text x={x} y={Math.max(PLOT_TOP + 12, y - 12)}>{cell.latency.value.toLocaleString("zh-CN", { maximumFractionDigits: 1 })}</text>
        </g>];
      }))}
      {VIEW_X.map((x, index) => <text key={x} className="pi0-overview-view-label" x={x} y={151}>V={index + 1}</text>)}
    </svg>
  );
}

function FacetChart({
  facet,
  selectedRunId,
  onSelectEvidence,
}: {
  facet: Pi0PerformanceFacet;
  selectedRunId: string | null;
  onSelectEvidence: (selection: Pi0RoutablePerformanceSelection) => void;
}) {
  const measured = finiteMeasuredCells(facet);
  const nativeEvidence = facet.nativeEvidenceSelection;

  return (
    <article className="pi0-overview-facet" aria-labelledby={`pi0-overview-${encodeURIComponent(facet.id)}`}>
      <header>
        <div className="pi0-overview-facet-identity">
          <h4 id={`pi0-overview-${encodeURIComponent(facet.id)}`}>{facet.runtimeLabel}</h4>
          <span>{precisionLabel(facet.precisionId)}</span>
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
      <p className="pi0-overview-contract" title={contractTitle(facet)}>{contractSummary(facet)}</p>
      {measured.length ? <CompactMeasuredPlot facet={facet} measured={measured} selectedRunId={selectedRunId} onSelectEvidence={onSelectEvidence} /> : null}
      <TargetMatrix facet={facet} selectedRunId={selectedRunId} onSelectEvidence={onSelectEvidence} />
      <p className="pi0-overview-observed">{observedScopeSummary(facet)}</p>
    </article>
  );
}

export function Pi0PerformanceOverviewChart({ model, selectedRunId, onSelectEvidence }: Pi0PerformanceOverviewChartProps) {
  const cells = model.facets.flatMap((facet) => facet.series.flatMap((series) => series.cells));
  const measured = cells.filter((cell) => cell.state === "measured").length;
  const pending = cells.filter((cell) => cell.state === "pending_supported").length;
  const unsupported = cells.filter((cell) => cell.state === "unsupported").length;

  return (
    <section className="pi0-performance-overview" aria-labelledby="pi0-performance-overview-title">
      <header className="pi0-overview-heading">
        <div>
          <h3 id="pi0-performance-overview-title">端到端总体表现</h3>
          <p>{model.hardwareLabel} · P=48 · N=10 · V=1/2/3 · A=20/50</p>
        </div>
        <p className="pi0-overview-progress" aria-label={`目标格已测 ${measured}，待测 ${pending}，不支持 ${unsupported}`}>
          <span><strong>{measured}</strong> 已测</span>
          <span><strong>{pending}</strong> 待测</span>
          <span><strong>{unsupported}</strong> 不支持</span>
        </p>
      </header>
      {model.facets.length ? (
        <div className="pi0-overview-facets">
          {model.facets.map((facet) => <FacetChart
            key={facet.id}
            facet={facet}
            selectedRunId={selectedRunId}
            onSelectEvidence={onSelectEvidence}
          />)}
        </div>
      ) : (
        <p className="pi0-overview-empty">当前硬件尚无本地端到端证据，无法建立推理栈分面；目标采样格保持待测。</p>
      )}
      <footer>目标格只接受精确匹配的本地实测；原生 workload 单独下钻，不填入 P=48、N=10、A=20/50 目标点。</footer>
    </section>
  );
}
