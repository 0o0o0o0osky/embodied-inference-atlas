import type { RoutePatch, RouteState } from "../../../app/routes";
import type { ProfilerMetricName } from "../../profiler/domain/types";
import type { IndependentNcuReplayEvidence } from "../../runtime/domain/scopeRuntimeProfiler";
import { kernelEntity } from "../../workbench/entityKeys";
import type { KernelRow, KernelRowsModel } from "../domain/buildKernelRows";
import { KernelInspector } from "./KernelInspector";
import { KernelTable, formatDuration, formatMetric, preferredProfilerMetric, TENSOR_ACTIVE_METRIC_NAMES } from "./KernelTable";

interface Pi0ProfilerEvidenceSectionProps {
  model: KernelRowsModel;
  partialContextRunIds: ReadonlySet<string>;
  anchorRunId: string | null;
  independentNcu: IndependentNcuReplayEvidence | null;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

export function Pi0ProfilerEvidenceSection({ model, partialContextRunIds, anchorRunId, independentNcu, route, navigate }: Pi0ProfilerEvidenceSectionProps) {
  const inventory = model.inventory;
  const hotspots = topKernelAggregates(model.rows);
  const ncuRows = model.rows.filter((row) => row.observation.observationKind === "ncu_replayed_launch");
  const nsysPartial = hotspots.some((row) => partialContextRunIds.has(row.run.run_id));
  const partialNcuCount = ncuRows.filter((row) => partialContextRunIds.has(row.run.run_id)).length;
  const nsysRunId = hotspots[0]?.run.run_id ?? null;
  const nsysIsAnchorRun = nsysRunId !== null && nsysRunId === anchorRunId;
  const independentNcuRows = ncuRows.filter((row) => independentNcu?.runIds.has(row.run.run_id));
  const firstIndependentNcu = independentNcuRows[0] ?? null;
  const selectedIndependentNcu = independentNcuRows.find((row) =>
    route.entity === kernelEntity(row.capture.captureId, row.observation.observationId)) ?? null;
  const activeNcu = ncuRows.find((row) =>
    route.entity === kernelEntity(row.capture.captureId, row.observation.observationId)) ?? ncuRows[0] ?? null;

  return (
    <section className="pi0-funnel-section pi0-profiler-section" aria-labelledby="pi0-profiler-title">
      <header className="pi0-funnel-heading">
        <div>
          <h3 id="pi0-profiler-title">NCU · Kernel 诊断</h3>
          <p>诊断计算与访存利用情况；回放耗时不用于计算实际性能差距。</p>
        </div>
      </header>
      {activeNcu ? <section className="pi0-ncu-focus">
        <label>诊断 Kernel
          <select value={activeNcu.observation.observationId} onChange={(event) => {
            const row = ncuRows.find((candidate) => candidate.observation.observationId === event.target.value);
            if (row) navigate({ entity: kernelEntity(row.capture.captureId, row.observation.observationId), rooflineLevel: "kernel", basis: null }, true);
          }}>
            {ncuRows.map((row, index) => <option key={row.observation.observationId} value={row.observation.observationId}>{row.signature.labelSanitized.replace("representative GEMM", "代表性 GEMM")} · 回放 {index + 1}</option>)}
          </select>
        </label>
        <p>单次回放 {formatDuration(activeNcu.observation.duration.valueNs)} · {ncuRows.length} 条可选记录</p>
        <div className="pi0-ncu-bars">
          {NCU_SUMMARY_METRICS.map(([label, name]) => {
            const isTensor = name === "tensor_cycles_active_pct_of_peak_sustained_active";
            const metric = isTensor ? preferredProfilerMetric(activeNcu.metrics, TENSOR_ACTIVE_METRIC_NAMES) : activeNcu.metrics.get(name);
            const metricLabel = isTensor && metric?.metricName === "tensor_cycles_active_pct_of_peak_sustained_elapsed"
              ? "Tensor 活跃（全程周期）" : label;
            const value = metric?.value;
            return <div key={name} className="pi0-ncu-bar-row">
              <span title={metric?.metricName}>{metricLabel}</span>
              <div className="pi0-ncu-meter">{value != null ? <i style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /> : null}</div>
              <strong>{metric && value != null ? formatMetric(metric) : "未采集"}</strong>
            </div>;
          })}
        </div>
        <p className="pi0-funnel-note">吞吐相对持续峰值，周期口径见指标名称；L2 吞吐不是 LPDDR 带宽。缺少融合组关联和完整流量，暂不判定理论差距。</p>
      </section> : <p className="pi0-funnel-empty">当前推理栈尚无 NCU 实测。</p>}
      <details className="pi0-runtime-mapping-disclosure">
        <summary>采集上下文与历史节点统计</summary>
      <dl className="pi0-kernel-status" aria-label="当前 Profiler 摘要">
        <SummaryMetric label="观测" value={inventory.observations.toLocaleString("zh-CN")} />
        <SummaryMetric label="NCU replay" value={inventory.ncuReplays.toLocaleString("zh-CN")} />
        <SummaryMetric label="Kernel Roofline 点" value={inventory.rooflineEligibleKernelPoints.toLocaleString("zh-CN")} />
      </dl>
      <div className="pi0-profiler-context-ledger" aria-label="Profiler 采集关系">
        <EvidenceScope
          label="Nsys aggregate"
          status={hotspots.length ? `${nsysIsAnchorRun ? "同一 run capture" : "独立采集"}${nsysPartial ? " · 部分上下文" : " · 已知上下文匹配"}` : "未显示"}
          note={hotspots.length
            ? anchorRunId === null
              ? "当前选择没有 wall-clock run identity；只解释该 Nsys capture。"
              : nsysIsAnchorRun
                ? "与当前选中的 wall-clock run identity 一致；只解释该 Nsys capture。"
                : "不是当前选中的 wall-clock run；只解释该 Nsys capture。"
            : "当前范围没有匹配的 node aggregate。"}
        />
        <EvidenceScope
          label="NCU replay"
          status={independentNcuRows.length
            ? `${independentNcuRows.length} 条独立 replay · 部分上下文`
            : ncuRows.length ? `独立 replay${partialNcuCount ? " · 含部分上下文" : " · 已知上下文匹配"}` : "未采集"}
          note={independentNcuRows.length
            ? `与当前 wall-clock timing boundary（${independentNcu?.wallClockTimingBoundaryId}）不同：${independentNcu?.timingBoundaryIds.join("、")}；不合并时长或视为同一次运行。`
            : ncuRows.length
              ? `${ncuRows.length} 条单 launch replay，其中 ${partialNcuCount} 条为部分上下文；不与 Nsys aggregate 合并。`
            : "当前范围没有 NCU replay。"}
          action={firstIndependentNcu ? {
            label: "查看独立 NCU replay",
            onClick: () => navigate({
              entity: kernelEntity(firstIndependentNcu.capture.captureId, firstIndependentNcu.observation.observationId),
              rooflineLevel: "kernel",
              basis: null,
            }, true),
          } : null}
        />
      </div>

      <section aria-labelledby="pi0-kernel-top-title">
        <header className="pi0-funnel-heading">
          <h3 id="pi0-kernel-top-title">Kernel 热点 Top 3</h3>
          <span>{hotspots.length ? "Nsys 累计时长；同一 capture" : "当前范围没有匹配的 node capture"}</span>
        </header>
        {hotspots.length ? (
          <div className="pi0-funnel-table-wrap">
            <table className="pi0-kernel-hotspots">
              <thead><tr><th scope="col">Kernel 签名</th><th scope="col">累计时长</th><th scope="col">已记录时长占比</th></tr></thead>
              <tbody>{hotspots.map((row) => (
                <tr key={row.observation.observationId}>
                  <th scope="row">{row.signature.labelSanitized}</th>
                  <td>{formatDuration(row.observation.duration.valueNs)}</td>
                  <td>{row.observation.durationShare?.denominator === "kernel_duration_sum"
                    ? `${row.observation.durationShare.value.toFixed(2)}%`
                    : "未记录"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : (
          <p className="pi0-funnel-empty">缺失保持为缺失，不从其他运行或 capture 借用 Kernel 观测。</p>
        )}
        <p className="pi0-funnel-note">这里的排序只描述已记录 Kernel 累计时长，不据此判定计算、访存或 scoreboard 瓶颈。</p>
      </section>
      </details>

      <details key={selectedIndependentNcu?.observation.observationId ?? "profiler-evidence"}
        className="pi0-profiler-evidence-disclosure pi0-runtime-mapping-disclosure">
        <summary>
          <span>完整 Profiler 证据</span>
          <small>完整计数器与来源</small>
        </summary>
        <div className="pi0-profiler-evidence-body">
          <section className="pi0-profiler-inventory-section" aria-labelledby="pi0-profiler-inventory-title">
            <header>
              <h3 id="pi0-profiler-inventory-title">Profiler 证据库存</h3>
              <span>当前范围：{model.activeFilter}</span>
            </header>
            <dl className="profiler-inventory" aria-label="Profiler 证据库存">
              <Inventory label="Capture" value={`${inventory.captures} · ${inventory.nsysCaptures} Nsys / ${inventory.ncuCaptures} NCU`} />
              <Inventory label="Timeline 记录" value={inventory.timelines.toLocaleString("zh-CN")} />
              <Inventory label="Kernel 签名" value={inventory.signatures.toLocaleString("zh-CN")} />
              <Inventory label="Counter 指标" value={`${inventory.profilerMetrics} · ${inventory.numericMetrics} 有值 / ${inventory.missingMetrics} 缺失`} />
              <Inventory label="精确关联" value={inventory.links.toLocaleString("zh-CN")} />
              <Inventory label="Telemetry" value={inventory.telemetry.toLocaleString("zh-CN")} />
              <Inventory label="NCU 选择" value={`${inventory.explicitInvocationReplays} 指定 launch / ${inventory.selectedMatchReplays} 名称匹配`} />
              <Inventory label="Cycle / path section" value={`${inventory.sectionReplays} / ${inventory.ncuReplays} replay`} />
            </dl>
          </section>

          <section className="profiler-boundary-note" aria-label="Profiler 解释边界">
            <strong>{model.rows.length ? "Profiler counter 与理论 Kernel Roofline 分开呈现。" : "当前执行范围没有匹配的 Profiler 观测。"}</strong>
            <span>{model.rows.length
              ? "Capture 中未知的工作负载字段只允许部分上下文匹配；缺失的流量、时钟与算子关联仍保持缺失。"
              : "请选择推理栈、硬件、实际精度和输入范围；不会借用其他配置的观测。"}</span>
          </section>

          {model.unclassified ? (
            <p className="kernel-coverage-strip">
              <strong>{model.unclassified.launches.toLocaleString("zh-CN")} / {model.unclassified.totalLaunches.toLocaleString("zh-CN")} 个 Nsys Kernel launch 尚未分类</strong>
              <span>{formatMs(model.unclassified.durationNs)} / {formatMs(model.unclassified.totalDurationNs)} 的 node-trace Kernel 累计时长；这是分类覆盖率，不是 GPU busy 或 idle 统计。</span>
            </p>
          ) : null}

          <KernelTable
            rows={model.rows}
            selectedObservationId={model.selectedRow?.observation.observationId ?? null}
            onSelect={(row) => navigate({ entity: kernelEntity(row.capture.captureId, row.observation.observationId) }, true)}
          />
          <KernelInspector model={model} route={route} navigate={navigate} />
        </div>
      </details>
    </section>
  );
}

const NCU_SUMMARY_METRICS: readonly [string, ProfilerMetricName][] = [
  ["SM 吞吐（全程周期）", "sm_throughput_pct_of_peak_sustained_elapsed"],
  ["Tensor 活跃（活跃周期）", "tensor_cycles_active_pct_of_peak_sustained_active"],
  ["L2 吞吐（全程周期）", "l2_throughput_pct_of_peak_sustained_elapsed"],
  ["实际占用率", "achieved_occupancy_percent"],
];

function topKernelAggregates(rows: readonly KernelRow[]) {
  const aggregates = rows.filter((row) =>
    row.observation.observationKind === "nsys_window_aggregate"
    && row.capture.nsys?.reportMode === "node",
  );
  const captureId = aggregates[0]?.capture.captureId;
  return aggregates
    .filter((row) => row.capture.captureId === captureId)
    .sort((left, right) => right.observation.duration.valueNs - left.observation.duration.valueNs)
    .slice(0, 3);
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function EvidenceScope({ label, status, note, action }: {
  label: string;
  status: string;
  note: string;
  action?: { label: string; onClick: () => void } | null;
}) {
  return <p><span>{label}</span><strong>{status}</strong><small>{note}</small>{action
    ? <button className="pi0-profiler-context-action" type="button" onClick={action.onClick}>{action.label}</button>
    : null}</p>;
}

function Inventory({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function formatMs(valueNs: number) {
  return `${(valueNs / 1e6).toFixed(6)} ms`;
}
