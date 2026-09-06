import { useState, type CSSProperties } from "react";
import type { Pi0NativeEvidenceSelection, Pi0PerformanceCell, Pi0PerformanceCoordinate, Pi0PerformanceFacet, Pi0PerformanceMeasuredCell, Pi0PerformanceOverviewModel, Pi0PerformanceSelection } from "../domain/buildPi0PerformanceOverview";
import "./pi0PerformanceOverviewChart.css";

export type Pi0RoutablePerformanceSelection = Pi0PerformanceSelection | Pi0NativeEvidenceSelection;
export interface Pi0PerformanceOverviewChartProps {
  model: Pi0PerformanceOverviewModel;
  selectedRunId: string | null;
  coordinate?: Pi0PerformanceCoordinate;
  onCoordinateChange?: (coordinate: Pi0PerformanceCoordinate) => void;
  onSelectEvidence: (selection: Pi0RoutablePerformanceSelection) => void;
  onInspectRuntime?: (runtimeId: string, precisionId: string, coordinate: Pi0PerformanceCoordinate) => void;
}
const PRECISIONS: Readonly<Record<string, string>> = {
  "mixed-fp8-e4m3-fp16": "混合 FP8 / FP16", "mixed-bf16-fp32": "BF16 权重 / F32 激活",
  "uniform-fp16": "FP16", "uniform-bf16": "BF16", q8_0: "Q8 仅权重 / F32 激活", "q8_0-weight-only": "Q8 仅权重 / F32 激活",
  unknown: "精度待核对",
};
const BOUNDARIES: Readonly<Record<string, string>> = {
  predict_cached_graph_sync: "缓存图预测并同步", vlacpp_engine_predict_synthetic: "合成输入引擎预测",
  predict: "预测窗口", "predict-with-preprocess": "预处理与预测",
};
const statisticLabel = (value: string) => ({ mean: "均值", p50: "中位数" }[value] ?? value);
const precisionLabel = (value: string) => PRECISIONS[value] ?? value;
const formatValue = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
const boundaryLabel = (facet: Pi0PerformanceFacet) => BOUNDARIES[facet.contract.timingBoundaryId] ?? facet.contract.timingBoundaryId;
function cellAt(facet: Pi0PerformanceFacet, coordinate: Pi0PerformanceCoordinate): Pi0PerformanceCell | undefined {
  return facet.series.find((series) => series.actionChunk === coordinate.actionChunk)?.cells.find((cell) => cell.cameraViews === coordinate.cameraViews);
}
function chartCeiling(value: number): number {
  if (value <= 0) return 200;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude / 0.5) * magnitude * 0.5;
}
function representativeCell(cells: readonly Pi0PerformanceMeasuredCell[], selectedRunId: string | null) {
  // A stable record selection, never a minimum latency or a pooled percentile.
  return cells.find((cell) => cell.selection.runId === selectedRunId)
    ?? [...cells].sort((a, b) => a.selection.runId.localeCompare(b.selection.runId))[0]!;
}
interface ChartColumn {
  id: string; runtimeLabel: string; runtimeId: string; precisionId: string;
  facet: Pi0PerformanceFacet | null; cell: Pi0PerformanceMeasuredCell | null;
  replicates?: readonly Pi0PerformanceMeasuredCell[] | undefined;
  contractIndex?: number; missing: string;
}
export function Pi0PerformanceOverviewChart({ model, selectedRunId, onSelectEvidence, onInspectRuntime, coordinate: controlledCoordinate, onCoordinateChange }: Pi0PerformanceOverviewChartProps) {
  const [localCoordinate, setLocalCoordinate] = useState<Pi0PerformanceCoordinate>({ cameraViews: 1, actionChunk: 50 });
  const coordinate = controlledCoordinate ?? localCoordinate;
  const setCoordinate = (next: Pi0PerformanceCoordinate) => { setLocalCoordinate(next); onCoordinateChange?.(next); };
  const columns = model.groups.flatMap<ChartColumn>((group) => {
    const measured = group.facets.flatMap<{ facet: Pi0PerformanceFacet; cell: Pi0PerformanceMeasuredCell; contractIndex: number; replicates?: readonly Pi0PerformanceMeasuredCell[] | undefined }>((facet, index) => {
      const cell = cellAt(facet, coordinate);
      const replicates = cell?.state === "pending_supported" ? cell.replicates : undefined;
      return cell?.state === "measured" ? [{ facet, cell, contractIndex: index + 1, replicates: undefined }]
        : replicates?.length ? [{ facet, cell: representativeCell(replicates, selectedRunId), contractIndex: index + 1, replicates }] : [];
    });
    const identity = { runtimeLabel: group.runtimeLabel, runtimeId: group.runtimeId, precisionId: group.precisionId };
    if (measured.length) return measured.map(({ facet, cell, contractIndex, replicates }) => ({
      ...identity, id: facet.id, facet, cell, replicates, missing: "", ...(measured.length > 1 ? { contractIndex } : {}),
    }));
    const cells = group.facets.length ? group.facets.map((facet) => cellAt(facet, coordinate))
      : group.unmeasuredSeries?.find((series) => series.actionChunk === coordinate.actionChunk)?.cells
        .filter((cell) => cell.cameraViews === coordinate.cameraViews) ?? [];
    const unsupported = cells.length > 0 && cells.every((cell) => cell?.state === "unsupported");
    const ambiguous = cells.some((cell) => cell?.state === "pending_supported" && cell.reason === "multiple_exact_measurements");
    return [{ ...identity, id: group.id, facet: null, cell: null, missing: unsupported ? "此形状不支持" : ambiguous ? "多条记录待复核" : "暂无此形状的 P48 实测" }];
  });
  const measured = columns.filter((column) => column.cell?.latency.unit === "ms");
  const maximum = chartCeiling(Math.max(0, ...measured.map((column) => column.cell!.latency.value)));
  const statistics = [...new Set(measured.map((column) => column.cell!.latency.statistic))];
  const axisStatistic = statistics.length === 1 ? statisticLabel(statistics[0]!) : "各自记录的统计量";
  return <section className="pi0-performance-overview" aria-labelledby="pi0-performance-overview-title">
    <header className="pi0-overview-heading">
      <div><h3 id="pi0-performance-overview-title">推理耗时对比</h3><p>{model.hardwareLabel} · 提示词 48 token · 去噪 10 步 · 预热 {model.target.warmupIterations} 次 / 测量 {model.target.sampleCount} 次</p></div>
      <div className="pi0-shape-controls">
        <fieldset><legend>视角数</legend><div>{model.target.cameraViews.map((value) => <button key={value} type="button" aria-pressed={coordinate.cameraViews === value} onClick={() => setCoordinate({ ...coordinate, cameraViews: value })}>{value}</button>)}</div></fieldset>
        <fieldset><legend>动作块长度</legend><div>{model.target.actionChunks.map((value) => <button key={value} type="button" aria-pressed={coordinate.actionChunk === value} onClick={() => setCoordinate({ ...coordinate, actionChunk: value })}>{value}</button>)}</div></fieldset>
      </div>
    </header>
    <figure className="pi0-runtime-chart" aria-label={`视角 ${coordinate.cameraViews}，动作块 ${coordinate.actionChunk} 的推理栈耗时柱状图`}>
      <figcaption><span>推理耗时 / ms{measured.length ? ` · ${axisStatistic}` : ""}</span><span>越低越快</span></figcaption>
      <div className="pi0-runtime-plot">
        <div className="pi0-runtime-grid" aria-hidden="true">{[1, 0.75, 0.5, 0.25, 0].map((fraction) => <div key={fraction} style={{ top: `${(1 - fraction) * 100}%` }}><span>{formatValue(maximum * fraction)}</span></div>)}</div>
        <div className="pi0-runtime-columns" style={{ "--pi0-column-count": columns.length || 1 } as CSSProperties}>
          {columns.map((column) => {
            const { cell, facet } = column;
            return <div key={`${column.id}-${coordinate.cameraViews}-${coordinate.actionChunk}`} className="pi0-runtime-column" data-runtime={column.runtimeId}>
              <div className="pi0-runtime-column-plot">
                {cell && cell.latency.unit === "ms" ? <button type="button" className={`pi0-runtime-bar${selectedRunId === cell.selection.runId ? " is-selected" : ""}`} style={{ height: `${cell.latency.value / maximum * 100}%` }} onClick={() => onSelectEvidence(cell.selection)} aria-label={`${column.runtimeLabel} ${precisionLabel(column.precisionId)}，${statisticLabel(cell.latency.statistic)} ${formatValue(cell.latency.value)} ms，查看推理栈`} title={`${facet ? boundaryLabel(facet) : ""}；点击查看推理栈`}><strong>{formatValue(cell.latency.value)}</strong></button>
                  : <span className="pi0-runtime-missing">{cell ? `记录单位 ${cell.latency.unit}` : column.missing}</span>}
              </div>
              <div className="pi0-runtime-column-label"><strong>{column.runtimeLabel}</strong><span>{precisionLabel(column.precisionId)}</span>{column.contractIndex ? <small>独立口径 {column.contractIndex}</small> : null}</div>
              {onInspectRuntime ? <button type="button" className="pi0-runtime-source-link" onClick={() => onInspectRuntime(column.runtimeId, column.precisionId, coordinate)}>查看推理栈</button> : null}
            </div>;
          })}
        </div>
      </div>
      <p className="pi0-runtime-chart-note">{measured.length ? "点击柱子查看系统耗时、执行热点与计算复用。计时边界、精度可能不同，仅并列展示实测耗时。" : "当前输入形状还没有可绘制的实测数据；可切换形状或查看已有记录。"}</p>
    </figure>
    <details className="pi0-runtime-evidence">
      <summary>测量口径与已有记录</summary>
      <p className="pi0-runtime-chart-note">主图仅展示预热 5 次、正式测量 10 次的记录。旧采样口径保留在数据中，不混入当前对比。</p>
      <div className="pi0-runtime-evidence-list">{model.groups.map((group) => <section key={group.id}>
        <h4>{group.runtimeLabel}<span>{precisionLabel(group.precisionId)}</span></h4>
        {!group.facets.length ? <p>已收录支持或源码审计信息，当前没有 P48 耗时记录。</p> : null}
        {group.facets.map((facet, index) => {
          const cell = cellAt(facet, coordinate);
          const replicates = cell?.state === "pending_supported" ? cell.replicates : undefined;
          const representative = replicates?.length ? representativeCell(replicates, selectedRunId) : null;
          const existingCell = facet.series.flatMap((series) => series.cells)
            .find((candidate): candidate is Pi0PerformanceMeasuredCell => candidate.state === "measured");
          const evidence = cell?.state === "measured" ? cell.selection : representative?.selection ?? facet.nativeEvidenceSelection ?? existingCell?.selection;
          const scope = facet.observedScope;
          return <div className="pi0-runtime-evidence-row" key={facet.id}>
            <div><p>{group.facets.length > 1 ? `口径 ${index + 1} · ` : ""}{boundaryLabel(facet)} · {statisticLabel(facet.contract.statistic ?? "未记录统计量")}</p><span>已有记录：提示词 {scope.promptTokens.join(" / ") || "未记录"} · 动作块 {scope.actionChunks.join(" / ") || "未记录"} · 去噪 {[...scope.denoiseSteps.map(String), ...(scope.hasMissingDenoise ? ["未记录"] : [])].join(" / ") || "未记录"}</span></div>
            {evidence ? <button type="button" onClick={() => onSelectEvidence(evidence)}>{cell?.state === "measured" ? "查看当前形状" : "查看已有记录"}</button> : <span>暂无可下钻记录</span>}
            {replicates ? <details className="pi0-repeat-measurements"><summary>同配置的其他测量</summary><p>主图使用一条记录的{statisticLabel(facet.contract.statistic ?? "统计量")}，不合并不同测量的百分位。未指定时按记录编号固定选择，不取最快值，也不推断新旧顺序。</p>{replicates.map((item) => <button key={item.selection.runId} type="button" onClick={() => onSelectEvidence(item.selection)}>{formatValue(item.latency.value)} ms{item.selection.runId === representative?.selection.runId ? " · 主图记录" : ""}</button>)}</details> : null}
          </div>;
        })}
      </section>)}</div>
    </details>
  </section>;
}
