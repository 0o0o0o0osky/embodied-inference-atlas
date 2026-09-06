import type { ReactNode } from "react";

import {
  buildOperatorRooflineSummary,
  type Pi0AnalyticalResult,
} from "../../roofline/presentation/buildOperatorRooflineSummary";
import { formatNumber, formatQuantity, formatTime } from "../../roofline/presentation/viewModel";
import type { Provenance, RooflinePointRecord } from "../../roofline/domain/types";

interface OperatorRooflinePanelProps {
  result: Pi0AnalyticalResult;
  logicalRef: string;
  fullAnalysisLink: ReactNode;
}

const LIMITERS: Record<RooflinePointRecord["derived"]["limiter"], string> = {
  compute: "计算",
  memory: "带宽",
  dependency: "依赖路径",
  tie: "计算 / 带宽并列",
  unknown: "尚不可判定",
};

function provenanceLabel(provenance: Provenance) {
  switch (provenance.class) {
    case "published_fact": return "公开规格";
    case "mode_scaled_analytical": return "运行模式缩放值";
    case "analytical_model": return "解析模型";
    case "legacy_tool_assumption": return "旧工具假设";
    case "measured_empirical": return "实测值";
    case "missing": return "缺失";
  }
}

function rowLabel(point: RooflinePointRecord) {
  if (point.entity.entity_id.endsWith("#score")) return "分数矩阵 Q @ Kᵀ";
  if (point.entity.entity_id.endsWith("#softmax")) return "缩放、掩码与 Softmax";
  if (point.entity.entity_id.endsWith("#value")) return "加权求和 P @ V";
  if (point.entity.entity_id.endsWith("#composite")) return "Attention 组合包络";
  return "逻辑算子总计";
}

function valueOrDash(value: number | null, format: (value: number) => string) {
  return value === null ? "—" : format(value);
}

export function OperatorRooflinePanel({
  result,
  logicalRef,
  fullAnalysisLink,
}: OperatorRooflinePanelProps) {
  if (result.status === "unavailable") {
    return (
      <div className="drawer-availability">
        <h3>当前场景无法生成解析 Roofline</h3>
        <p>{result.reason}</p>
        {fullAnalysisLink}
      </div>
    );
  }
  const summary = buildOperatorRooflineSummary(result.value, logicalRef);
  if (!summary) {
    return (
      <div className="drawer-availability">
        <h3>该逻辑算子尚无解析点</h3>
        <p>当前公式层只覆盖可物化的 GEMM 与 Attention 组成；缺失不会补成零。</p>
        {fullAnalysisLink}
      </div>
    );
  }

  const scenario = summary.scenario.workload;
  const computeCeilings = [...new Map(summary.rows.flatMap((row) => row.computeCeilings)
    .map((ceiling) => [ceiling.compute_ceiling_id, ceiling])).values()];
  const bandwidth = summary.rows[0]!.bandwidthCeiling;
  return (
    <section className="operator-roofline" aria-label="所选算子的解析 Roofline">
      <header>
        <div>
          <strong>解析下界</strong>
          <span>不含运行时开销，也不代表实测效率</span>
        </div>
        <code>V{scenario.executed_camera_views} / P{scenario.executed_prompt_tokens} / A{scenario.action_horizon} / N{scenario.denoise_steps}</code>
      </header>

      <div className="operator-roofline-rows">
        {summary.rows.map((row) => {
          const point = row.point;
          const partial = point.coverage.status !== "complete" || point.derived.status !== "complete";
          const missingComputeCeiling = point.work.components.some((component) => component.flop > 0
            && (component.compute_class === null
              || !row.computeCeilings.some((ceiling) =>
                ceiling.compute_class === component.compute_class && ceiling.flop_per_second !== null)));
          const computeCeiling = row.computeCeilings.map((ceiling) => ceiling.flop_per_second === null
            ? `${ceiling.compute_class}（速率缺失）`
            : `${ceiling.compute_class} ${formatNumber(ceiling.flop_per_second / 1e12)} TFLOP/s`).join("；");
          return (
            <article key={point.point_id}>
              <div className="operator-roofline-row-heading">
                <h3>{rowLabel(point)}</h3>
                <span className={partial ? "is-partial" : "is-complete"}>{partial ? "部分下界" : "完整公式"}</span>
              </div>
              <dl>
                <div><dt>工作量</dt><dd>{formatQuantity(point.work.total_flop, "FLOP")}</dd></div>
                <div><dt>建模访存</dt><dd>{formatQuantity(point.traffic.total_byte, "B")}</dd></div>
                <div><dt>算术强度</dt><dd>{valueOrDash(point.derived.arithmetic_intensity_flop_per_byte, (value) => `${formatNumber(value)} FLOP/B`)}</dd></div>
                <div><dt>理论时间</dt><dd>{valueOrDash(point.derived.roof_second, formatTime)}</dd></div>
                <div><dt>理论瓶颈</dt><dd>{LIMITERS[point.derived.limiter]}</dd></div>
              </dl>
              <p className="operator-roofline-ceiling">
                <span>计算上限：{[computeCeiling, missingComputeCeiling ? "部分标量 / SFU 上限缺失" : ""].filter(Boolean).join("；") || "未声明"}</span>
                <span>带宽上限：{bandwidth.byte_per_second === null
                  ? "速率缺失"
                  : `${formatNumber(bandwidth.byte_per_second / 1e9)} GB/s`}</span>
              </p>
            </article>
          );
        })}
      </div>

      <details className="operator-roofline-provenance">
        <summary>查看理论上限依据</summary>
        <dl>
          {computeCeilings.map((ceiling) => (
            <div key={ceiling.compute_ceiling_id}>
              <dt>计算</dt>
              <dd>
                <code>{ceiling.compute_ceiling_id}</code>
                <span>{provenanceLabel(ceiling.provenance)}；{ceiling.provenance.condition ?? "无附加条件"}</span>
                <small>{ceiling.provenance.source_ids.join(" · ") || "未声明来源"}</small>
              </dd>
            </div>
          ))}
          <div>
            <dt>带宽</dt>
            <dd>
              <code>{bandwidth.bandwidth_ceiling_id}</code>
              <span>{provenanceLabel(bandwidth.provenance)}；{bandwidth.provenance.condition ?? "无附加条件"}</span>
              <small>{bandwidth.provenance.source_ids.join(" · ") || "未声明来源"}</small>
            </dd>
          </div>
        </dl>
      </details>
      <div className="operator-roofline-action">{fullAnalysisLink}</div>
    </section>
  );
}
