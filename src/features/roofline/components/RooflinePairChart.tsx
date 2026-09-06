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
  if (!pair) return <p className="roofline-comparison-missing">该记录尚不具备可绘制的计算／带宽下界；依赖路径下界不强行套入单 Kernel 曲线。</p>;
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
  const boundLabel = point.coverage.status !== "complete" || point.derived.status !== "complete" ? "部分建模的条件上限"
    : pair.limiter === "compute" ? "理论计算受限" : pair.limiter === "memory" ? "理论带宽受限" : "计算／带宽同限";
  const percent = pair.efficiency === null ? null : `${formatNumber(pair.efficiency * 100)}%`;
  return <div className="roofline-pair-chart">
    <div className="roofline-pair-summary"><span>{boundLabel}</span>
      <strong>{percent === null ? pair.actualRate === null ? "实测点待补齐" : "上限匹配条件待确认" : `达到所选上限 ${percent}`}</strong></div>
    <div ref={root} className="roofline-pair-canvas">
      <svg viewBox={`0 0 ${width} ${height}`} aria-labelledby={id} role="img">
        <title id={id}>同一计算与访存口径下的理论上限和实测性能；连线表示吞吐差距</title>
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
          <title>{value.name} · {formatNumber(value.rate / 1e12)} TFLOP/s</title>
          <circle className="pair-point-hit" r={15} />
          <circle className="pair-point-glyph" r={value.kind === "theory" ? 8 : 6} />
        </g>)}
        <text className="pair-axis" x={box.left + box.width / 2} y={height - 15} textAnchor="middle">算术强度（FLOP/byte）</text>
        <text className="pair-axis" transform={`translate(19 ${box.top + box.height / 2}) rotate(-90)`} textAnchor="middle">吞吐量（TFLOP/s）</text>
      </svg>
    </div>
    <div className="roofline-pair-legend">
      <span><i className="is-theory" />理论上限 · {formatNumber(pair.theoryRate / 1e12)} TFLOP/s</span>
      <span><i className="is-actual" />实测性能 · {pair.actualRate === null ? "未提供" : `${formatNumber(pair.actualRate / 1e12)} TFLOP/s`}</span>
      <small>{point.traffic.memory_domain === "system_memory" ? "系统内存" : point.traffic.memory_domain.toUpperCase()} · {pair.trafficKind === "measured" ? "实测流量" : "建模流量，非实测带宽"}</small>
    </div>
    {pair.actualRate !== null && pair.actualRate > pair.theoryRate ? <p className="roofline-comparison-missing">实测高于所选上限：请核对频率、流量和计时口径，不将此差距解释为优化空间。</p> : null}
    {inspecting ? <div className="roofline-pair-inspector">
      <header><strong>{point.entity.label}</strong><button type="button" onClick={() => setInspecting(false)}>收起详情</button></header>
      <dl>
        <div><dt>理论耗时下界</dt><dd>{formatTime(point.derived.roof_second!)}</dd></div>
        <div><dt>正常执行耗时</dt><dd>{pair.actualRate === null ? "未提供" : formatTime(point.timing.observed_second!)}</dd></div>
        <div><dt>耗时 / 理论下界</dt><dd>{pair.efficiency === null ? "待匹配" : `${formatNumber(1 / pair.efficiency)}×`}</dd></div>
      </dl>
      <p>{point.entity.shape_or_coverage}</p>
      <details><summary>精度、融合范围与计算依据</summary>
        <p>{basis.label} · {point.work.components.map((part) => part.compute_class ?? part.kind).filter((value, index, all) => all.indexOf(value) === index).join(" / ")}</p>
        <p>计算量 {formatQuantity(point.work.total_flop, "FLOP")}；流量 {formatQuantity(point.traffic.total_byte, "B")}；覆盖 {point.calls} 次调用。</p>
        <p>点位保留真实坐标。不同融合／量化路径分别建模，不将未融合算子的流量直接用于融合 Kernel。</p>
      </details>
    </div> : <p className="roofline-pair-hint">点击任一点，查看耗时、形状和计算依据。曲线表示理论约束，实际瓶颈还需结合 NCU 诊断。</p>}
  </div>;
}
