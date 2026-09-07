import { useState } from "react";
import {RooflinePlot} from "./RooflinePlot";
import {RooflineMetricsTable} from "./RooflineMetricsTable";
import type { RooflineBasisRecord, RooflinePointRecord } from "../domain/types";
import { compareRooflinePoint } from "../presentation/rooflineComparison";
import { formatNumber, formatQuantity, formatTime } from "../presentation/viewModel";
import "./rooflineComparison.css";

export function RooflinePairChart({ point, basis }: { point: RooflinePointRecord; basis: RooflineBasisRecord }) {
  const [inspecting, setInspecting] = useState(false);
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
    <RooflinePlot title="同一计算与访存口径下的理论上限和实测性能" curve={curve}
      points={values.map(v=>({id:v.kind,label:v.name,kind:v.kind as 'theory'|'actual',xFlopPerByte:pair.intensity,yFlopPerSecond:v.rate}))}
      comparison={{intensity:pair.intensity,theoryRate:pair.theoryRate,actualRate:pair.actualRate}} onSelect={()=>setInspecting(true)}/>
    <div className="roofline-pair-legend">
      <span><i className="is-theory" />理论参考</span>
      <span><i className="is-actual" />实测性能</span>
      <small>{point.traffic.memory_domain === "system_memory" ? "系统内存" : point.traffic.memory_domain.toUpperCase()} · {pair.trafficKind === "measured" ? "实测流量" : "建模流量"}</small>
    </div>
    <RooflineMetricsTable label="当前对象的实测与理论性能对比" columns={['本次调用','理论参考']} rows={[
      {label:'吞吐量',values:[rateText(pair.actualRate),rateText(pair.theoryRate)]},
      {label:'执行耗时',values:[pair.actualRate===null?'未提供':formatTime(point.timing.observed_second!),formatTime(point.derived.roof_second!)]},
    ]}>
      <tr className="roofline-pair-attainment"><th scope="row">达到理论参考性能</th><td colSpan={2} data-reference-ratio={referenceRatio ?? undefined}>
        <strong>{percent}</strong><small>实测吞吐 ÷ 理论参考吞吐</small>
      </td></tr>
    </RooflineMetricsTable>
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
