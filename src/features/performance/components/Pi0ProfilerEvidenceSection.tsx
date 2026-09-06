import type { RoutePatch, RouteState } from "../../../app/routes";
import { kernelEntity } from "../../workbench/entityKeys";
import type { KernelRow, KernelRowsModel } from "../domain/buildKernelRows";
import { KernelInspector } from "./KernelInspector";
import { KernelTable, formatDuration } from "./KernelTable";

interface Pi0ProfilerEvidenceSectionProps {
  model: KernelRowsModel;
  partialContextRunIds: ReadonlySet<string>;
  route: RouteState;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

export function Pi0ProfilerEvidenceSection({ model, partialContextRunIds, route, navigate }: Pi0ProfilerEvidenceSectionProps) {
  const inventory = model.inventory;
  const hotspots = topKernelAggregates(model.rows);
  const ncuRows = model.rows.filter((row) => row.observation.observationKind === "ncu_replayed_launch");
  const nsysPartial = hotspots.some((row) => partialContextRunIds.has(row.run.run_id));
  const partialNcuCount = ncuRows.filter((row) => partialContextRunIds.has(row.run.run_id)).length;

  return (
    <section className="pi0-funnel-section pi0-profiler-section" aria-labelledby="pi0-profiler-title">
      <header className="pi0-funnel-heading">
        <div>
          <h3 id="pi0-profiler-title">Kernel 观测</h3>
          <p>先看同一份 Nsys node capture 的累计热点；NCU replay 与理论 Roofline 保持独立口径。</p>
        </div>
      </header>
      <dl className="pi0-kernel-status" aria-label="当前 Profiler 摘要">
        <SummaryMetric label="观测" value={inventory.observations.toLocaleString("zh-CN")} />
        <SummaryMetric label="NCU replay" value={inventory.ncuReplays.toLocaleString("zh-CN")} />
        <SummaryMetric label="Kernel Roofline 点" value={inventory.rooflineEligibleKernelPoints.toLocaleString("zh-CN")} />
      </dl>
      <div className="pi0-profiler-context-ledger" aria-label="Profiler 采集关系">
        <EvidenceScope
          label="Nsys aggregate"
          status={hotspots.length ? `独立采集${nsysPartial ? " · 部分上下文" : " · 已知上下文匹配"}` : "未显示"}
          note={hotspots.length
            ? "不是当前选中的 wall-clock run；只解释该 Nsys capture。"
            : "当前范围没有匹配的 node aggregate。"}
        />
        <EvidenceScope
          label="NCU replay"
          status={ncuRows.length ? `独立 replay${partialNcuCount ? " · 含部分上下文" : " · 已知上下文匹配"}` : "未采集"}
          note={ncuRows.length
            ? `${ncuRows.length} 条单 launch replay，其中 ${partialNcuCount} 条为部分上下文；不与 Nsys aggregate 合并。`
            : "当前范围没有 NCU replay。"}
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

      <details className="pi0-profiler-evidence-disclosure pi0-runtime-mapping-disclosure">
        <summary>
          <span>完整 Profiler 证据</span>
          <small>Capture 库存、13 列 KernelTable、NCU counter 与证据缺口</small>
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

function EvidenceScope({ label, status, note }: { label: string; status: string; note: string }) {
  return <p><span>{label}</span><strong>{status}</strong><small>{note}</small></p>;
}

function Inventory({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function formatMs(valueNs: number) {
  return `${(valueNs / 1e6).toFixed(6)} ms`;
}
