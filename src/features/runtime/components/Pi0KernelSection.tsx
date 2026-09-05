import type { KernelRowsModel } from "../../performance/domain/buildKernelRows";
import type { RuntimeRealizationRecord } from "../domain/types";
import { pi0GroupLabel, pi0PrecisionLabel } from "./runtimePresentation";

export interface Pi0KernelSectionProps {
  view: KernelRowsModel;
  realization: RuntimeRealizationRecord | null;
  dagOpen?: boolean;
  onOpenDetails: () => void;
  onOpenDag: () => void;
}

export function Pi0KernelSection({ view: model, realization, dagOpen = false, onOpenDetails, onOpenDag }: Pi0KernelSectionProps) {
  const rows = model.rows;
  const aggregates = rows.filter((row) => row.observation.observationKind === "nsys_window_aggregate" && row.capture.nsys?.reportMode === "node");
  const captureId = aggregates[0]?.capture.captureId;
  const hotspots = aggregates.filter((row) => row.capture.captureId === captureId)
    .sort((left, right) => right.observation.duration.valueNs - left.observation.duration.valueNs).slice(0, 3);
  const ncu = rows.filter((row) => row.observation.observationKind === "ncu_replayed_launch");
  const hasScopedEvidence = rows.length > 0;
  const activeRealization = realization;
  const mappings = activeRealization?.mappings.filter((mapping) => mapping.method === "source_audit") ?? [];
  const sourceGroupIds = new Set(mappings.flatMap((mapping) => mapping.executionGroupIds));
  const groups = activeRealization?.executionGroups.filter((group) => sourceGroupIds.has(group.executionGroupId)) ?? [];
  const fusedGroupIds = new Set(mappings.filter((mapping) => mapping.relation === "fused").flatMap((mapping) => mapping.executionGroupIds));
  const fusedLabels = groups.filter((group) => fusedGroupIds.has(group.executionGroupId)).map((group) => pi0GroupLabel(group.label));
  const precisionIds = new Set(groups.map((group) => group.precisionPathId));
  const paths = activeRealization?.precisionPaths.filter((path) => precisionIds.has(path.precisionPathId)) ?? [];

  return (
    <section className="pi0-funnel-section pi0-kernel-section" aria-labelledby="pi0-kernel-title">
      <header className="pi0-funnel-heading"><h3 id="pi0-kernel-title">Kernel 与实现</h3><button className="pi0-funnel-detail" type="button" onClick={onOpenDetails}>Kernel / Roofline 详情</button></header>
      {hotspots.length ? <>
        <p className="pi0-funnel-note">同一节点 trace 的 Nsys aggregate 累计时长 Top 3；占比以该 capture 已记录 Kernel 累计时长为分母。</p>
        <div className="pi0-funnel-table-wrap"><table className="pi0-kernel-hotspots" aria-label="Nsys Kernel 热点">
          <thead><tr><th scope="col">Kernel 签名</th><th scope="col">累计时长</th><th scope="col">已记录时长占比</th></tr></thead>
          <tbody>{hotspots.map((row) => <tr key={row.observation.observationId}>
            <th scope="row">{row.signature.labelSanitized}</th>
            <td className="pi0-funnel-number">{(row.observation.duration.valueNs / 1e6).toFixed(3)} ms</td>
            <td className="pi0-funnel-number">{row.observation.durationShare?.denominator === "kernel_duration_sum" ? `${row.observation.durationShare.value.toFixed(2)}%` : "未记录"}</td>
          </tr>)}</tbody>
        </table></div>
      </> : <p className="pi0-funnel-empty">当前选择暂无节点 trace 的 Kernel 热点。</p>}
      <details className="pi0-runtime-mapping-disclosure">
        <summary>展开 Kernel 摘要</summary>
        {hotspots.length ? <div className="pi0-funnel-table-wrap"><table className="pi0-kernel-hotspots" aria-label="Kernel 调用与 NCU 状态">
          <thead><tr><th scope="col">Kernel 签名</th><th scope="col">调用数</th><th scope="col">NCU 状态</th></tr></thead>
          <tbody>{hotspots.map((row) => <tr key={row.observation.observationId}>
            <th scope="row">{row.signature.labelSanitized}</th>
            <td className="pi0-funnel-number">{row.observation.calls.toLocaleString("zh-CN")}</td>
            <td>{ncu.some((replay) => replay.signature.kernelSignatureId === row.signature.kernelSignatureId) ? "独立 replay" : "未采集"}</td>
          </tr>)}</tbody>
        </table></div> : null}
        <dl className="pi0-kernel-status">
          <div><dt>NCU</dt><dd>{ncu.length ? `${ncu.length} 条独立单 launch replay` : "未采集"}</dd></div>
          <div><dt>Kernel Roofline</dt><dd>{hasScopedEvidence && model.inventory.rooflineEligibleKernelPoints > 0 ? `${model.inventory.rooflineEligibleKernelPoints} 个证据点，口径见详情` : "未建立"}</dd></div>
          <div><dt>算子 / Kernel 关联</dt><dd>{hasScopedEvidence && model.inventory.links > 0 ? `${model.inventory.links} 条关联记录，状态见详情` : "未建立"}</dd></div>
        </dl>
        <p className="pi0-funnel-note">NCU replay 与 Nsys aggregate 独立，不合并时长。缺少完整流量和调度证据时，不判定计算 / 内存瓶颈或 LPDDR 饱和。</p>
        <div className="pi0-implementation-summary">
          <h4>实现映射 <span>源码审计；Profiler 未关联</span></h4>
          {mappings.length ? <>
            <p><strong>融合与消除</strong> {fusedLabels.length ? fusedLabels.join("；") : "当前源码映射未声明融合"}；消除映射 {mappings.filter((mapping) => mapping.relation === "eliminated").length} 项。</p>
            <p><strong>精度与量化</strong> {paths.length ? paths.map((path) => pi0PrecisionLabel(path.precisionPathId, path.label)).join("；") : "当前源码映射未建立精度路径"}。</p>
            <p className="pi0-funnel-note">以上仅对应当前实现的源码审计映射，不将 Kernel 热点关联到逻辑算子。</p>
          </> : <p>当前选择暂无源码审计实现映射。</p>}
          {activeRealization ? <button className="pi0-funnel-detail" type="button" aria-expanded={dagOpen} onClick={onOpenDag}>{dagOpen ? "关闭完整实现图" : "查看完整实现图"}</button> : null}
        </div>
      </details>
    </section>
  );
}
