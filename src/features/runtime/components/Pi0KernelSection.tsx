import type { KernelRowsModel } from "../../performance/domain/buildKernelRows";
import type { IndependentNcuReplayEvidence } from "../domain/scopeRuntimeProfiler";
import type { RuntimeRealizationRecord } from "../domain/types";
import { pi0GroupLabel, pi0PrecisionLabel } from "./runtimePresentation";

export interface Pi0KernelSectionProps {
  view: KernelRowsModel;
  realization: RuntimeRealizationRecord | null;
  partialContextRunIds?: ReadonlySet<string>;
  independentNcu?: IndependentNcuReplayEvidence | null;
  dagOpen?: boolean;
  onOpenDetails: () => void;
  onOpenNcuContext?: (() => void) | null;
  onOpenDag: () => void;
}

const EMPTY_PARTIAL_RUN_IDS: ReadonlySet<string> = new Set();

export function Pi0KernelSection({ view: model, realization, partialContextRunIds = EMPTY_PARTIAL_RUN_IDS, independentNcu = null, dagOpen = false, onOpenDetails, onOpenNcuContext = null, onOpenDag }: Pi0KernelSectionProps) {
  const rows = model.rows;
  const aggregates = rows.filter((row) => row.observation.observationKind === "nsys_window_aggregate" && row.capture.nsys?.reportMode === "node");
  const captureId = aggregates[0]?.capture.captureId;
  const hotspots = aggregates.filter((row) => row.capture.captureId === captureId)
    .sort((left, right) => right.observation.duration.valueNs - left.observation.duration.valueNs).slice(0, 3);
  const ncu = rows.filter((row) => row.observation.observationKind === "ncu_replayed_launch");
  const partialNcuCount = ncu.filter((row) => partialContextRunIds.has(row.run.run_id)).length;
  const independentNcuCount = ncu.filter((row) => independentNcu?.runIds.has(row.run.run_id)).length;
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
      <header className="pi0-funnel-heading"><h3 id="pi0-kernel-title">融合实现与 Kernel 性能</h3><button className="pi0-funnel-detail" type="button" onClick={onOpenDetails}>查看 Roofline</button></header>
      <div className="pi0-implementation-summary">
        <p>{mappings.length
          ? `已审计 ${groups.length} 个执行组，${fusedGroupIds.size} 个融合组。`
          : "当前推理栈尚未建立算子实现映射。"} {ncu.length ? `有 ${ncu.length} 条 NCU 单次回放记录。` : "尚无 NCU 实测。"}</p>
        <div className="pi0-funnel-controls">
          {activeRealization ? <button className="pi0-funnel-detail" type="button" aria-expanded={dagOpen} onClick={onOpenDag}>{dagOpen ? "收起融合实现图" : "查看融合实现图"}</button> : null}
          {onOpenNcuContext ? <button className="pi0-funnel-detail" type="button" onClick={onOpenNcuContext}>分析 NCU 指标</button> : null}
        </div>
        <p className="pi0-funnel-note">从执行组看融合与精度，从 NCU 看计算、访存与停顿；当前源码映射与实测 Kernel 尚未精确关联。</p>
      </div>
      <details className="pi0-runtime-mapping-disclosure">
        <summary>采集依据与实现摘要</summary>
      <div className="pi0-profiler-context-ledger is-single" aria-label="NCU 采集关系">
        <p>
          <span>NCU replay</span>
          <strong>{independentNcuCount
            ? `${independentNcuCount} 条独立 replay · 部分上下文`
            : ncu.length ? `独立 replay${partialNcuCount ? " · 含部分上下文" : " · 已知上下文匹配"}` : "未采集"}</strong>
          <small>{independentNcuCount
            ? `与当前 wall-clock timing boundary（${independentNcu?.wallClockTimingBoundaryId}）不同：${independentNcu?.timingBoundaryIds.join("、")}；不合并时长或视为同一次运行。`
            : ncu.length
              ? `${ncu.length} 条单 launch replay，其中 ${partialNcuCount} 条为部分上下文；与 Nsys aggregate 不是同一次采集，不合并时长。`
            : "当前范围没有 NCU replay。"}</small>
          {independentNcuCount && onOpenNcuContext
            ? <button className="pi0-profiler-context-action" type="button" onClick={onOpenNcuContext}>查看独立 NCU replay</button>
            : null}
        </p>
      </div>
      <details className="pi0-runtime-mapping-disclosure">
        <summary>历史侵入式节点采集 · Kernel 调用统计</summary>
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
        {hotspots.length ? <div className="pi0-funnel-table-wrap"><table className="pi0-kernel-hotspots" aria-label="Kernel 调用与 NCU 状态">
          <thead><tr><th scope="col">Kernel 签名</th><th scope="col">调用数</th><th scope="col">NCU 状态</th></tr></thead>
          <tbody>{hotspots.map((row) => <tr key={row.observation.observationId}>
            <th scope="row">{row.signature.labelSanitized}</th>
            <td className="pi0-funnel-number">{row.observation.calls.toLocaleString("zh-CN")}</td>
            <td>{ncu.some((replay) => replay.signature.kernelSignatureId === row.signature.kernelSignatureId) ? "独立 replay" : "未采集"}</td>
          </tr>)}</tbody>
        </table></div> : null}
      </details>
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
            <p className="pi0-funnel-note">以上仅对应当前实现的源码审计映射，不将 Kernel 热点关联到模型算子。</p>
          </> : <p>当前选择暂无源码审计实现映射。</p>}
        </div>
      </details>
    </section>
  );
}
