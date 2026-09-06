import type { RoutePatch } from "../../../app/routes";
import type { AtlasData } from "../../../types/atlas";
import { indexRoofline, type RooflineIndex } from "../data/indexRoofline";
import { serializeInteractiveWorkload } from "../data/materialize";
import type { RooflineLevel, RooflinePointRecord } from "../domain/types";
import type { Pi0AnalyticalResult, Pi0AnalyticalSlice } from "../presentation/buildOperatorRooflineSummary";
import { formatQuantity, formatTime } from "../presentation/viewModel";

interface Pi0RooflineOverviewProps {
  data: AtlasData;
  result: Pi0AnalyticalResult;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

const STAGE_LABELS: Record<string, string> = {
  "vision-encoder": "视觉编码器",
  "prefix-encoder": "前缀编码器",
  "action-flow-decoder": "动作流解码器",
};

function stageLabel(point: RooflinePointRecord) {
  const id = point.entity.entity_id.slice(point.entity.entity_id.lastIndexOf("/") + 1);
  return STAGE_LABELS[id] ?? point.entity.label;
}

function limiterLabel(point: RooflinePointRecord) {
  switch (point.derived.limiter) {
    case "compute": return "计算受限";
    case "memory": return "带宽受限";
    case "dependency": return "依赖路径受限";
    case "tie": return "计算 / 带宽并列";
    case "unknown": return "瓶颈待定";
  }
}

function statusForLevel(index: RooflineIndex, slice: Pi0AnalyticalSlice, level: RooflineLevel) {
  const workload = slice.scenario.workload;
  const scenarioIds = new Set(index.scenarios.filter((scenario) =>
    scenario.model_id === "pi0"
    && scenario.origin !== "legacy_import"
    && scenario.precision_path.precision_path_id === slice.scenario.precision_path.precision_path_id
    && scenario.workload.executed_camera_views === workload.executed_camera_views
    && scenario.workload.executed_prompt_tokens === workload.executed_prompt_tokens
    && scenario.workload.action_horizon === workload.action_horizon
    && scenario.workload.denoise_steps === workload.denoise_steps,
  ).map((scenario) => scenario.scenario_id));
  const bases = index.bases.filter((basis) =>
    basis.level === level
    && basis.device_id === slice.atomicBasis.device_id
    && scenarioIds.has(basis.scenario_id),
  );
  if (!bases.length) return "unavailable" as const;
  return bases.some((basis) => (index.pointsByBasisId.get(basis.basis_id) ?? []).length)
    ? "available" as const
    : "empty" as const;
}

function statusLabel(status: "available" | "empty" | "unavailable") {
  if (status === "available") return "有独立证据";
  if (status === "empty") return "已有口径，暂无点位";
  return "尚无同口径证据";
}

export function Pi0RooflineOverview({ data, result, navigate }: Pi0RooflineOverviewProps) {
  if (result.status === "unavailable") {
    return (
      <section className="pi0-analytical-overview is-unavailable" role="status">
        <strong>当前场景无法生成 Pi0 解析下界</strong>
        <span>{result.reason}</span>
      </section>
    );
  }
  const slice = result.value;
  const workload = slice.scenario.workload;
  const routeWorkload = serializeInteractiveWorkload({
    executedCameraViews: workload.executed_camera_views,
    executedPromptTokens: workload.executed_prompt_tokens,
    actionHorizon: workload.action_horizon,
    denoiseSteps: workload.denoise_steps,
  });
  const openLevel = (level: "stage" | "atomic") => navigate({
    rooflineLevel: level,
    basis: null,
    entity: null,
    workload: routeWorkload,
    precision: slice.scenario.precision_path.precision_path_id,
    hardware: slice.atomicBasis.device_id,
  });
  const total = slice.modelTotal;
  const canonical = indexRoofline(data);
  const fusedStatus = statusForLevel(canonical, slice, "fused");
  const kernelStatus = statusForLevel(canonical, slice, "kernel");

  return (
    <section className="pi0-analytical-overview" aria-labelledby="pi0-analytical-overview-title">
      <header>
        <div>
          <h4 id="pi0-analytical-overview-title">模型解析下界</h4>
          <p>Thor · {slice.scenario.precision_path.precision_path_id} · V{workload.executed_camera_views} / P{workload.executed_prompt_tokens} / A{workload.action_horizon} / N{workload.denoise_steps}</p>
        </div>
        <div className="pi0-analytical-primary">
          <strong>{total?.derived.roof_second === null || !total ? "—" : formatTime(total.derived.roof_second)}</strong>
          <span>{total?.coverage.status === "complete" ? "完整解析覆盖" : "部分覆盖的理论下界"}</span>
        </div>
      </header>

      {total ? (
        <p className="pi0-analytical-disclosure">
          已建模工作 {formatQuantity(total.work.total_flop, "FLOP")}；访问流量 {formatQuantity(total.traffic.total_byte, "B")}。
          未建模的标量 / SFU 与无公式逻辑不会补零，因此此值不是端到端延迟预测。
        </p>
      ) : <p className="pi0-analytical-disclosure">当前 Stage basis 没有模型总计点。</p>}

      <div className="pi0-stage-lower-bounds" aria-label="Pi0 各阶段解析下界">
        {slice.stages.map((stage) => (
          <article key={stage.point_id}>
            <div><strong>{stageLabel(stage)}</strong><span>{limiterLabel(stage)}</span></div>
            <b>{stage.derived.roof_second === null ? "—" : formatTime(stage.derived.roof_second)}</b>
          </article>
        ))}
      </div>

      <div className="pi0-analytical-actions">
        <button type="button" onClick={() => openLevel("stage")}>查看模型阶段</button>
        <button type="button" onClick={() => openLevel("atomic")}>查看逻辑算子</button>
      </div>

      <dl className="pi0-secondary-bases">
        <div><dt>融合算子</dt><dd>{statusLabel(fusedStatus)}</dd></div>
        <div><dt>实测 Kernel</dt><dd>{statusLabel(kernelStatus)}；需精确 runtime / capture 映射</dd></div>
      </dl>
    </section>
  );
}
