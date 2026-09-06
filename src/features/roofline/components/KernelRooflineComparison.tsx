import { useMemo, useState } from "react";
import type { AtlasData } from "../../../types/atlas";
import { indexRoofline } from "../data/indexRoofline";
import { adaptRuntimeRealization, isRuntimeRealizationRecord } from "../../runtime/domain/adaptRuntimeRealization";
import { RooflinePairChart } from "./RooflinePairChart";
import "./rooflineComparison.css";

export function KernelRooflineComparison({ data, runId }: { data: AtlasData; runId: string | null }) {
  const [level, setLevel] = useState<"kernel" | "fused">("kernel");
  const [selection, setSelection] = useState<string | null>(null);
  const options = useMemo(() => {
    const run = data.datasets.runs.find((item) => item.run_id === runId);
    if (!run || !run.workload.vla) return [];
    const vla = run.workload.vla;
    const index = indexRoofline(data);
    const realizations = data.datasets.runtime_realizations.filter((item) => isRuntimeRealizationRecord(item, run.model_id))
      .map(adaptRuntimeRealization).filter((item) => item.configurationIds.includes(run.configuration_id)
        && item.precisionPaths.some((path) => path.precisionPathId === run.precision.precision_id));
    return index.bases.filter((basis) => {
      const scenario = index.scenarioById.get(basis.scenario_id);
      const workload = scenario?.workload;
      return basis.level === level && basis.run_id === run.run_id && basis.runtime_id === run.runtime_id
        && basis.device_id === run.device_id && basis.operating_point_id === run.operating_point.operating_point_id
        && basis.work_basis === "runtime_executed_formula" && basis.time_basis !== "ncu_kernel"
        && realizations.some((item) => item.realizationId === basis.realization_id)
        && scenario?.modeling_scope === "implementation_modeled" && scenario.model_id === run.model_id
        && scenario.model_artifact_id === run.model_artifact_id && scenario.precision_path.runtime_support === "proven"
        && basis.precision_path_id === scenario.precision_path.precision_path_id
        && scenario.precision_path.realization_ids.includes(basis.realization_id!)
        && workload?.batch_size === run.workload.common.batch_size
        && workload.executed_camera_views === vla.camera_views && workload.executed_prompt_tokens === vla.executed_prompt_tokens
        && workload.action_horizon === vla.action_chunk && workload.denoise_steps === vla.denoise_steps
        && vla.action_dimension !== null && workload.public_action_dimension === vla.action_dimension
        && vla.image_height !== null && vla.image_width !== null
        && workload.executed_image_height === vla.image_height && workload.executed_image_width === vla.image_width;
    }).flatMap((basis) => (index.pointsByBasisId.get(basis.basis_id) ?? [])
      .filter((point) => point.entity.kind === (level === "kernel" ? "kernel" : "execution_group"))
      .map((point) => ({ point, basis })));
  }, [data, runId, level]);
  const active = options.find((item) => item.point.point_id === selection) ?? options[0] ?? null;
  return <section className="kernel-roofline-comparison" aria-label="Kernel 理论与实测对比">
    <header><div><h3>Roofline · 理论与实测</h3><p>同一实现的上限与实际位置，先看差距，再看 NCU 原因。</p></div>
      <div className="roofline-comparison-levels" aria-label="对比层级">
        <button type="button" aria-pressed={level === "kernel"} onClick={() => setLevel("kernel")}>单 Kernel</button>
        <button type="button" aria-pressed={level === "fused"} onClick={() => setLevel("fused")}>融合组</button>
      </div>
    </header>
    {active ? <>
      <label className="roofline-comparison-picker">查看对象
        <select value={active.point.point_id} onChange={(event) => setSelection(event.target.value)}>
          {options.map(({ point }) => <option key={point.point_id} value={point.point_id}>{point.entity.label}</option>)}
        </select>
      </label>
      <RooflinePairChart key={active.point.point_id} point={active.point} basis={active.basis} />
    </> : <div className="roofline-comparison-empty">
      <strong>当前{level === "kernel" ? " Kernel" : "融合组"}尚无可匹配的理论点</strong>
      <p>需补齐形状、实际精度与融合范围对应的下界，再接入同口径的正常执行耗时。</p>
      <div className="roofline-pair-legend"><span><i className="is-theory" />理论点：对应实现的上限</span><span><i className="is-actual" />实测点：正常计时得到的性能</span></div>
      <small>已有 NCU 计数器在下方。回放耗时不用于打实测点；不借用模型 BF16 上限替代当前实现。</small>
    </div>}
  </section>;
}
