import type { AtlasData, RunRecord } from "../../../types/atlas";
import { indexRoofline } from "../../roofline/data/indexRoofline";
import type { RooflineBasisRecord, RooflinePointRecord } from "../../roofline/domain/types";
import type { RuntimeRealizationRecord } from "./types";

export interface RuntimeBoundPoint {
  point: RooflinePointRecord;
  basis: RooflineBasisRecord;
}
export interface RuntimeBounds {
  endToEnd: RuntimeBoundPoint | null;
  groups: ReadonlyMap<string, RuntimeBoundPoint>;
  reason: string;
}

/** Never promote a model reference, partial group sum, or NCU replay into an E2E bound. */
export function resolveRuntimeBounds(data: AtlasData, run: RunRecord | null, realization: RuntimeRealizationRecord | null): RuntimeBounds {
  const empty = (reason: string): RuntimeBounds => ({ endToEnd: null, groups: new Map(), reason });
  if (!run || !realization) return empty("尚无与当前配置关联的完整执行方案。");
  if (!realization.configurationIds.includes(run.configuration_id)) return empty("源码映射尚未绑定当前测量配置。");
  const vla = run.workload.vla;
  if (!vla) return empty("缺少输入形状。");
  const index = indexRoofline(data);
  const bases = index.bases.filter((basis) => {
    const scenario = index.scenarioById.get(basis.scenario_id);
    return basis.device_id === run.device_id && basis.runtime_id === run.runtime_id
      && basis.realization_id === realization.realizationId
      && basis.run_id === run.run_id
      && basis.operating_point_id === run.operating_point.operating_point_id
      && basis.work_basis === "runtime_executed_formula" && basis.time_basis !== "ncu_kernel"
      && scenario?.model_id === run.model_id && scenario.model_artifact_id === run.model_artifact_id
      && scenario.modeling_scope === "implementation_modeled"
      && scenario.precision_path.runtime_support === "proven"
      && scenario.precision_path.realization_ids.includes(realization.realizationId)
      && realization.precisionPaths.some((path) => path.precisionPathId === run.precision.precision_id)
      && scenario.workload.executed_camera_views === vla.camera_views
      && scenario.workload.executed_prompt_tokens === vla.executed_prompt_tokens
      && scenario.workload.action_horizon === vla.action_chunk
      && scenario.workload.denoise_steps === vla.denoise_steps
      && vla.image_height !== null && scenario.workload.executed_image_height === vla.image_height
      && vla.image_width !== null && scenario.workload.executed_image_width === vla.image_width
      && vla.action_dimension !== null && scenario.workload.public_action_dimension === vla.action_dimension
      && scenario.workload.batch_size === run.workload.common.batch_size;
  });
  const matched = bases.flatMap((basis) => (index.pointsByBasisId.get(basis.basis_id) ?? [])
    .filter((point) => point.derived.roof_second !== null && point.derived.status !== "unavailable")
    .map((point) => ({ point, basis })));
  const groups = new Map<string, RuntimeBoundPoint>();
  for (const group of realization.executionGroups) {
    const candidates = matched.filter(({ point, basis }) => basis.level === "fused"
      && point.entity.kind === "execution_group" && point.entity.entity_id === group.executionGroupId);
    if (candidates.length === 1) groups.set(group.executionGroupId, candidates[0]!);
  }
  const totals = matched.filter(({ point, basis }) => point.entity.kind === "model_total"
    && basis.aggregation === "dag_resource_and_critical_path" && basis.runtime_overhead === "included"
    && point.coverage.status === "complete" && point.derived.status === "complete"
    && point.aggregation.dependency_lower_bound_second !== null
    && point.aggregation.resource_compute_lower_bound_second !== null
    && point.aggregation.resource_memory_lower_bound_second !== null
    && basis.work_unit === "action_chunk" && realization.mappingCoverage === "complete_at_level");
  return {
    endToEnd: totals.length === 1 ? totals[0]! : null,
    groups,
    reason: totals.length === 1 ? "采用当前执行图的依赖与资源下界，包含声明的运行时开销。"
      : realization.mappingCoverage !== "complete_at_level"
      ? "执行映射仍为部分覆盖，局部下界不能代替完整端到端下界。"
      : "缺少完整执行依赖、跨 kernel 流量或 CPU / 同步开销模型。",
  };
}
