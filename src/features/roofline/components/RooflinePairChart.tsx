import { useEffect, useId, useRef, useState } from "react";
import type { RooflineBasisRecord, RooflinePointRecord } from "../domain/types";
import { chartGeometry, logX, logY, roofPath } from "../presentation/chartGeometry";
import { compareRooflinePoint } from "../presentation/rooflineComparison";
import { formatNumber, formatQuantity, formatTime } from "../presentation/viewModel";
import "./rooflineComparison.css";

export function RooflinePairChart({ point, basis }: { point: RooflinePointRecord; basis: RooflineBasisRecord }) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [inspecting, setInspecting] = useState(false);
  const id = useId();
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(entry.contentRect.width); });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const pair = compareRooflinePoint({
    workFlop: point.work.total_flop, trafficByte: point.traffic.total_byte,
    computeSecond: point.derived.compute_second, memorySecond: point.derived.memory_second,
    roofSecond: point.derived.roof_second, observedSecond: point.timing.observed_second,
    timeBasis: basis.time_basis, trafficKind: point.traffic.value_kind,
    efficiency: point.coverage.status === "complete" && point.derived.status === "complete"
      && basis.operating_point_id !== "unknown" ? point.derived.efficiency : null,
  });
  if (!pair) return <p className="roofline-comparison-missing">当前记录缺少计算或带宽边界数据。</p>;
  const curve = {
    computeFlopPerSecond: pair.computeRate, bandwidthBytePerSecond: pair.bandwidthRate,
    ridgeFlopPerByte: pair.computeRate / pair.bandwidthRate,
  };
  const values = [{ name: "理论上限", rate: pair.theoryRate, kind: "theory" },
    ...(pair.actualRate === null ? [] : [{ name: "实测性能", rate: pair.actualRate, kind: "actual" }])];
  const plotPoints = values.map((value) => ({ xFlopPerByte: pair.intensity, yFlopPerSecond: value.rate }));
  const geometry = chartGeometry(plotPoints, [curve]);
  const height = 360;
  const box = { left: width < 600 ? 68 : 88, top: 30, width: Math.max(1, width - (width < 600 ? 94 : 120)), height: height - 105 };
  const x = logX(pair.intensity, geometry.x, box);
  const yTheory = logY(pair.theoryRate, geometry.y, box);
  const yActual = pair.actualRate === null ? null : logY(pair.actualRate, geometry.y, box);
  const limitingTerm = pair.limiter === "compute" ? "计算边界" : pair.limiter === "memory" ? "带宽边界" : "计算／带宽边界";
  const partial = point.coverage.status !== "complete" || point.derived.status !== "complete";
  const boundLabel = `理论参考 · ${limitingTerm}`;
  // A visual ratio to this curve is available even when its operating conditions
  // remain assumptions. Keep canonical efficiency as the matched-evidence gate.
  const referenceRatio = pair.actualRate === null ? null : pair.actualRate / pair.theoryRate;
  const percent = referenceRatio === null ? "未提供" : `${formatNumber(referenceRatio * 100)}%`;
  const referenceOnly = pair.efficiency === null;
  const rateText = (rate: number | null) => rate === null ? "未提供" : `${formatNumber(rate / 1e12)} TFLOP/s`;
  return <div className="roofline-pair-chart">
    <div className="roofline-pair-summary"><span>{boundLabel}</span>
      <strong>{pair.actualRate === null ? "实测点待补齐" : partial ? "部分建模" : ""}</strong></div>
    <div ref={root} className="roofline-pair-canvas">
      <svg viewBox={`0 0 ${width} ${height}`} aria-labelledby={id} role="img">
        <title id={id}>同一计算与访存口径下的理论上限和实测性能</title>
        {geometry.xTicks.map((tick) => <g key={tick}>
          <line className="pair-grid" x1={logX(tick, geometry.x, box)} x2={logX(tick, geometry.x, box)} y1={box.top} y2={box.top + box.height} />
          <text className="pair-tick" x={logX(tick, geometry.x, box)} y={box.top + box.height + 24} textAnchor="middle">{formatNumber(tick)}</text>
        </g>)}
        {geometry.yTicks.map((tick) => <g key={tick}>
          <line className="pair-grid" x1={box.left} x2={box.left + box.width} y1={logY(tick, geometry.y, box)} y2={logY(tick, geometry.y, box)} />
          <text className="pair-tick" x={box.left - 10} y={logY(tick, geometry.y, box) + 4} textAnchor="end">{formatNumber(tick / 1e12)}</text>
        </g>)}
        <path className="pair-roof" d={roofPath(curve, geometry.x, geometry.y, box)} />
        <line className="pair-guide" x1={x} x2={x} y1={yTheory} y2={box.top + box.height} />
        {yActual !== null ? <line className="pair-gap" data-theory-rate={pair.theoryRate} data-actual-rate={pair.actualRate}
          x1={x} x2={x} y1={yTheory} y2={yActual} /> : null}
        {values.map((value) => <g key={value.kind} className={`pair-point is-${value.kind}`}
          transform={`translate(${x} ${logY(value.rate, geometry.y, box)})`} role="button" tabIndex={0}
          aria-label={`${value.name} ${formatNumber(value.rate / 1e12)} TFLOP/s，查看详情`}
          onClick={() => setInspecting(true)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setInspecting(true); } }}>
          <title>{`${value.name} · ${formatNumber(value.rate / 1e12)} TFLOP/s`}</title>
          <circle className="pair-point-hit" r={15} />
          <circle className="pair-point-glyph" r={value.kind === "theory" ? 8 : 6} />
        </g>)}
        <text className="pair-axis" x={box.left + box.width / 2} y={height - 15} textAnchor="middle">算术强度（FLOP/byte）</text>
        <text className="pair-axis" transform={`translate(19 ${box.top + box.height / 2}) rotate(-90)`} textAnchor="middle">吞吐量（TFLOP/s）</text>
      </svg>
    </div>
    <div className="roofline-pair-legend">
      <span><i className="is-theory" />理论参考</span>
      <span><i className="is-actual" />实测性能</span>
      <small>{point.traffic.memory_domain === "system_memory" ? "系统内存" : point.traffic.memory_domain.toUpperCase()} · {pair.trafficKind === "measured" ? "实测流量" : "建模流量"}</small>
    </div>
    <div className="roofline-pair-table-wrap">
      <table className="roofline-pair-metrics" aria-label="当前对象的实测与理论性能对比">
        <thead><tr><th scope="col">指标</th><th scope="col">本次调用</th><th scope="col">理论参考</th></tr></thead>
        <tbody>
          <tr><th scope="row">吞吐量</th><td>{rateText(pair.actualRate)}</td><td>{rateText(pair.theoryRate)}</td></tr>
          <tr><th scope="row">执行耗时</th><td>{pair.actualRate === null ? "未提供" : formatTime(point.timing.observed_second!)}</td><td>{formatTime(point.derived.roof_second!)}</td></tr>
          <tr className="roofline-pair-attainment"><th scope="row">达到理论参考性能</th><td colSpan={2} data-reference-ratio={referenceRatio ?? undefined}>
            <strong>{percent}</strong><small>实测吞吐 ÷ 理论参考吞吐</small>
          </td></tr>
        </tbody>
      </table>
    </div>
    {pair.actualRate !== null && pair.actualRate > pair.theoryRate ? <p className="roofline-comparison-missing">实测高于所选上限，请核对频率、流量和计时范围。</p> : null}
    <details className="roofline-pair-inspector" open={inspecting} onToggle={event=>setInspecting(event.currentTarget.open)}>
      <summary>计算范围与参考条件</summary>
      <p><strong>对象：</strong>{point.entity.label} · {point.entity.shape_or_coverage}</p>
      <p><strong>计时：</strong>{basis.time_basis === "nsys_interval" ? "Nsys 追踪记录" : basis.time_basis === "ncu_kernel" ? "NCU 独立回放" : "当前执行记录"}。</p>
      <p><strong>计算范围：</strong>{point.coverage.omitted.some(item=>item.ref === "alpha_epilogue_and_cast")
        ? "矩阵乘加；α 缩放与 FP16 输出转换未单列。"
        : partial ? "已确认的局部计算与数据边界。" : "完整建模范围。"}</p>
      <p><strong>参考条件：</strong>{referenceOnly ? "所选假设曲线" : "已匹配运行条件"}；计算上限 {formatNumber(pair.computeRate / 1e12)} TFLOP/s，带宽上限 {formatNumber(pair.bandwidthRate / 1e9)} GB/s。</p>
      <p><strong>工作量：</strong>{formatQuantity(point.work.total_flop, "FLOP")}；流量 {formatQuantity(point.traffic.total_byte, "B")}；{point.calls} 次调用。</p>
      <p><strong>比例：</strong>实测吞吐 ÷ 当前算术强度处的理论参考吞吐。</p>
    </details>
  </div>;
}
