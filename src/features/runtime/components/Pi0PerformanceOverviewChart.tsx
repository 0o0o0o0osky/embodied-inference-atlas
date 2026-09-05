import type { KeyboardEvent } from "react";

import type {
  Pi0PerformanceCell,
  Pi0PerformanceFacet,
  Pi0PerformanceMeasuredCell,
  Pi0PerformanceOverviewModel,
  Pi0PerformanceSelection,
  Pi0PerformanceSeries,
} from "../domain/buildPi0PerformanceOverview";
import "./pi0PerformanceOverviewChart.css";

export interface Pi0PerformanceOverviewChartProps {
  model: Pi0PerformanceOverviewModel;
  selectedRunId: string | null;
  onSelectPoint: (selection: Pi0PerformanceSelection) => void;
  onSelectFacet: (selection: Pick<Pi0PerformanceSelection, "facetId" | "runtimeId" | "precisionId" | "hardwareId">) => void;
}

const SERIES_COLOR: Readonly<Record<number, string>> = {
  20: "#0E8EA0",
  50: "#D85B2B",
};

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
const HEIGHT = 286;
const PLOT_LEFT = 70;
const PLOT_RIGHT = 574;
const PLOT_TOP = 38;
const PLOT_BOTTOM = 170;
const VIEW_X = [176, 350, 524] as const;
const PENDING_Y: Readonly<Record<number, number>> = { 20: 226, 50: 256 };

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
  onSelectPoint: (selection: Pi0PerformanceSelection) => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onSelectPoint(selection);
}

function pendingLabel(cell: Pi0PerformanceCell): string {
  if (cell.state === "measured") return "";
  if (cell.reason === "multiple_exact_measurements") return "待复核";
  return "待测";
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
  return `已有证据：P=${scope.promptTokens.join("/") || "未记录"} · 动作块=${scope.actionChunks.join("/") || "未记录"} · 去噪=${denoise}`;
}

function FacetChart({
  facet,
  selectedRunId,
  onSelectPoint,
  onSelectFacet,
}: {
  facet: Pi0PerformanceFacet;
  selectedRunId: string | null;
  onSelectPoint: (selection: Pi0PerformanceSelection) => void;
  onSelectFacet: (selection: Pick<Pi0PerformanceSelection, "facetId" | "runtimeId" | "precisionId" | "hardwareId">) => void;
}) {
  const measured = finiteMeasuredCells(facet);
  const maximum = niceCeiling(Math.max(0, ...measured.map((cell) => cell.latency.value)));
  const unit = measured.length ? facet.contract.unit ?? measured[0]?.latency.unit ?? "未记录" : "待测";
  const ticks = measured.length ? [maximum, maximum / 2, 0] : [];

  return (
    <article className="pi0-overview-facet" aria-labelledby={`pi0-overview-${encodeURIComponent(facet.id)}`}>
      <header>
        <div>
          <h4 id={`pi0-overview-${encodeURIComponent(facet.id)}`}>{facet.runtimeLabel}</h4>
          <span>{precisionLabel(facet.precisionId)}</span>
        </div>
        <div className="pi0-overview-facet-actions">
          <strong>{facet.measuredCellCount} / 6 已实测</strong>
          <button type="button" onClick={() => onSelectFacet({ facetId: facet.id, runtimeId: facet.runtimeId, precisionId: facet.precisionId, hardwareId: facet.hardwareId })}>查看分析</button>
        </div>
      </header>
      <p className="pi0-overview-contract" title={contractTitle(facet)}>{contractSummary(facet)}</p>
      {facet.measuredCellCount === 0 ? <p className="pi0-overview-observed">{observedScopeSummary(facet)}</p> : null}
      <svg className="pi0-overview-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${facet.runtimeLabel} 在目标采样格的端到端延时`}>
        <text className="pi0-overview-axis-title" x={PLOT_LEFT} y={19}>端到端延时 / {unit}</text>
        {ticks.map((tick) => {
          const y = yFor(tick, maximum);
          return <g key={tick} className="pi0-overview-gridline">
            <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={y} y2={y} />
            <text x={PLOT_LEFT - 10} y={y + 4}>{formatTick(tick)}</text>
          </g>;
        })}
        {!measured.length ? <text className="pi0-overview-no-data" x={(PLOT_LEFT + PLOT_RIGHT) / 2} y={110}>目标格暂无实测值</text> : null}
        {facet.series.flatMap((series) => contiguousSegments(series).map((segment, index) =>
          segment.length > 1 ? <path
            key={`${series.actionChunk}/segment/${index}`}
            className="pi0-overview-series-line"
            d={linePath(segment, maximum)}
            pathLength={1}
            style={{ stroke: SERIES_COLOR[series.actionChunk] ?? "#657483" }}
          /> : null,
        ))}
        {facet.series.flatMap((series) => series.cells.flatMap((cell) => {
          if (cell.state !== "measured") return [];
          const x = VIEW_X[cell.cameraViews - 1] ?? PLOT_LEFT;
          const y = yFor(cell.latency.value, maximum);
          const selected = selectedRunId === cell.selection.runId;
          return [<g
            key={`${series.actionChunk}/${cell.cameraViews}`}
            className={`pi0-overview-point${selected ? " is-selected" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={pointLabel(facet, cell)}
            onClick={() => onSelectPoint(cell.selection)}
            onKeyDown={(event) => activatePoint(event, cell.selection, onSelectPoint)}
          >
            <title>{pointLabel(facet, cell)}</title>
            <circle className="pi0-overview-point-halo" cx={x} cy={y} r={10} />
            <circle cx={x} cy={y} r={5.5} style={{ fill: SERIES_COLOR[series.actionChunk] ?? "#657483" }} />
            <text x={x} y={Math.max(PLOT_TOP + 12, y - 13)}>{cell.latency.value.toLocaleString("zh-CN", { maximumFractionDigits: 1 })}</text>
          </g>];
        }))}
        {VIEW_X.map((x, index) => <text key={x} className="pi0-overview-view-label" x={x} y={192}>{index + 1} 视角</text>)}
        <line className="pi0-overview-status-rule" x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={205} y2={205} />
        {facet.series.map((series) => {
          const y = PENDING_Y[series.actionChunk] ?? 226;
          return <g key={`${series.actionChunk}/status`}>
            <text className="pi0-overview-status-series" x={PLOT_LEFT} y={y + 4}>块 {series.actionChunk}</text>
            {series.cells.map((cell) => {
              const x = VIEW_X[cell.cameraViews - 1] ?? PLOT_LEFT;
              const measuredCell = cell.state === "measured";
              return <g key={cell.cameraViews} className={measuredCell ? "is-measured" : "is-pending"}>
                <circle cx={x - 21} cy={y} r={4} style={{ fill: measuredCell ? SERIES_COLOR[series.actionChunk] ?? "#657483" : undefined }} />
                <text x={x - 13} y={y + 4}>{measuredCell ? "已测" : pendingLabel(cell)}</text>
              </g>;
            })}
          </g>;
        })}
      </svg>
    </article>
  );
}

export function Pi0PerformanceOverviewChart({ model, selectedRunId, onSelectPoint, onSelectFacet }: Pi0PerformanceOverviewChartProps) {
  return (
    <section className="pi0-performance-overview" aria-labelledby="pi0-performance-overview-title">
      <header className="pi0-overview-heading">
        <div>
          <h3 id="pi0-performance-overview-title">端到端总体表现</h3>
          <p>{model.hardwareLabel} · 提示长度 48 · 去噪 10 步</p>
        </div>
        <div className="pi0-overview-progress" aria-label={`目标格已实测 ${model.measuredCellCount}，共 ${model.targetCellCount}`}>
          <strong>{model.measuredCellCount}</strong>
          <span>/ {model.targetCellCount} 个目标点</span>
        </div>
      </header>
      <div className="pi0-overview-key" aria-label="动作块图例">
        {model.target.actionChunks.map((chunk) => <span key={chunk}>
          <i style={{ background: SERIES_COLOR[chunk] ?? "#657483" }} />动作块 {chunk}
        </span>)}
        <small>各面板口径独立，不计算跨栈速度比</small>
      </div>
      {model.facets.length ? (
        <div className="pi0-overview-facets">
          {model.facets.map((facet) => <FacetChart
            key={facet.id}
            facet={facet}
            selectedRunId={selectedRunId}
            onSelectPoint={onSelectPoint}
            onSelectFacet={onSelectFacet}
          />)}
        </div>
      ) : (
        <p className="pi0-overview-empty">当前硬件尚无本地端到端证据，无法建立推理栈分面；目标采样格保持待测。</p>
      )}
      <footer>只接受 canonical measured_local 的精确匹配；历史提示长度、原生动作块或缺失去噪步数不会填入目标格。</footer>
    </section>
  );
}
