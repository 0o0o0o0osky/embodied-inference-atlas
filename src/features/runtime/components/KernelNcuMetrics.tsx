import { KernelResources, KernelPrecisionSummary } from './KernelComputation';
import { useState } from 'react';
import type { KernelRow } from '../../performance/domain/buildKernelRows';
import type { ProfilerMetric, ProfilerMetricName } from '../../profiler/domain/types';
import './kernelNcuMetrics.css';

type MetricSpec = readonly [ProfilerMetricName, string, string?];
const GROUPS: readonly { title: string; metrics: readonly MetricSpec[] }[] = [
  { title: '计算', metrics: [
    ['sm_throughput_pct_of_peak_sustained_elapsed', 'SM 吞吐', 'elapsed 周期 / 持续峰值'],
    ['tensor_cycles_active_pct_of_peak_sustained_active', 'Tensor 活跃', 'active 周期 / 持续峰值'],
    ['tensor_cycles_active_pct_of_peak_sustained_elapsed', 'Tensor 活跃', 'elapsed 周期 / 持续峰值'],
  ] },
  { title: 'Warp 驻留', metrics: [
    ['achieved_occupancy_percent', '实际 occupancy'],
    ['theoretical_occupancy_percent', '理论 occupancy'],
  ] },
  { title: '缓存与访存', metrics: [
    ['l1tex_sector_hit_rate_percent', 'L1TEX sector 命中率'],
    ['l2_sector_hit_rate_percent', 'L2 sector 命中率'],
    ['l1_throughput_pct_of_peak_sustained_active', 'L1 吞吐', 'active 周期 / 持续峰值'],
    ['l2_throughput_pct_of_peak_sustained_elapsed', 'L2 吞吐', 'elapsed 周期 / 持续峰值'],
    ['l2_sysmem_fill_pct_of_peak_sustained_elapsed', 'L2 sysmem 填充', 'elapsed 周期 / 持续峰值'],
    ['l2_sysmem_fill_sectors', 'L2 sysmem 填充 sector'],
    ['l2_sysmem_write_sectors', 'L2 sysmem 写入 sector'],
    ['l2_sysmem_lookup_miss_sectors', 'L2 sysmem lookup miss'],
  ] },
  { title: '调度与等待', metrics: [
    ['scheduler_issue_active_per_active_cycle', '每周期发射 warp', 'scheduler active 周期'],
    ['scheduler_issue_active_pct_of_peak_sustained_active', 'Issue 活跃', 'active 周期 / 持续峰值'],
    ['scheduler_active_warps_per_active_cycle', '活跃 warp', '每 scheduler active 周期'],
    ['scheduler_eligible_warps_per_active_cycle', '可发射 warp', '每 scheduler active 周期'],
    ['average_warp_latency_cycles_per_issued_instruction', '每条已发射指令等待'],
    ['long_scoreboard_cycles_per_issued_instruction', 'Long Scoreboard 等待'],
    ['short_scoreboard_cycles_per_issued_instruction', 'Short Scoreboard 等待'],
    ['warp_stall_long_scoreboard_percent', 'Long Scoreboard 停顿'],
    ['warp_stall_short_scoreboard_percent', 'Short Scoreboard 停顿'],
  ] },
];
const LABELS = new Map(GROUPS.flatMap(group => group.metrics.map(([key, label]) => [key, label] as const)));
const REASONS: Readonly<Record<string, string>> = {
  section_not_collected: '未采集该指标组',
  counter_absent_from_report: '报告未提供该计数器',
  not_collected: '未采集',
  unsupported_by_device: '设备不支持',
  unsupported_by_tool: '工具不支持',
};
const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
function valueLabel(metric: ProfilerMetric): string {
  if (metric.value === null) return REASONS[metric.missingReason ?? ''] ?? `未记录${metric.missingReason ? ` · ${metric.missingReason}` : ''}`;
  const value = metric.value;
  if (metric.unit === 'percent') return `${number(value)}%`;
  if (metric.unit === 'ns') return value >= 1e6 ? `${number(value / 1e6)} ms` : `${number(value / 1e3)} µs`;
  if (metric.unit === 'hz') return `${number(value / 1e6)} MHz`;
  const units: Partial<Record<ProfilerMetric['unit'], string>> = {
    byte: 'B', count: '次', warp_per_cycle: 'warp/周期', warp: 'warp',
    sector: 'sector', cycles_per_instruction: '周期/指令',
  };
  return `${number(value)} ${units[metric.unit] ?? metric.unit}`;
}

export function KernelNcuMetrics({ rows }: { rows: readonly KernelRow[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const replays = rows.filter(row => row.capture.tool === 'ncu' && row.observation.observationKind === 'ncu_replayed_launch');
  const active = replays.find(row => row.observation.observationId === selectedId) ?? replays[0];
  if (!active) return <p className="kernel-ncu-empty">暂无同一 Kernel 签名的 NCU 回放。</p>;
  return <section className="kernel-ncu" aria-label="Kernel NCU 指标">
    <h4>NCU 指标</h4>
    <p className="kernel-ncu-note">同一 Kernel 签名的独立回放，仅覆盖其采集时选中的 launch；不是当前 Nsys 调用的同步计数器，不与 Nsys 合并计时。</p>
    {replays.length > 1 ? <label className="kernel-ncu-select">选择独立回放
      <select aria-label="选择独立回放" value={active.observation.observationId} onChange={event => setSelectedId(event.target.value)}>
        {replays.map((row, index) => <option key={row.observation.observationId} value={row.observation.observationId}>
          独立回放 {index + 1}{row.metrics.get('scheduler_eligible_warps_per_active_cycle')?.value != null ? ' · 含调度指标' : ''}
        </option>)}
      </select>
    </label> : null}
    {[active].map(row => {
      const index = replays.indexOf(row);
      const { capture, observation, metrics } = row;
      const measuredGroups = GROUPS.map(group => ({ ...group,
        entries: group.metrics.flatMap(([key, label, basis]) => {
          const metric = metrics.get(key);
          return metric?.value != null ? [{ metric, label, basis }] : [];
        }),
      })).filter(group => group.entries.length > 0);
      const duration = metrics.get('kernel_duration');
      const sysmem = [...metrics.values()].some(metric => metric.metricName.startsWith('l2_sysmem') && metric.value !== null);
      return <article className="kernel-ncu-replay" key={observation.observationId} data-capture-id={capture.captureId}>
        <header><strong>独立回放 {index + 1}</strong>
          <span>{observation.calls === 1 ? '单次 launch' : `${observation.calls} 次 launch`}
            {duration?.value != null ? ` · ${valueLabel(duration)}` : ''}
            {capture.ncu ? ` · ${capture.ncu.replayPasses} 轮采集` : ''}</span>
        </header>
        <KernelPrecisionSummary row={row} />
        <details className="kernel-ncu-launch"><summary>本次 NCU 回放的启动配置</summary><KernelResources launch={observation.launch} label="本次 NCU 回放的执行资源" /></details>
        {measuredGroups.length ? measuredGroups.map(group => <section className="kernel-ncu-group" key={group.title} aria-label={group.title}>
          <h5>{group.title}</h5><dl>{group.entries.map(({ metric, label, basis }) => <div key={metric.metricId}>
            <dt>{label}</dt><dd>{valueLabel(metric)}</dd>{basis ? <small>{basis}</small> : null}
          </div>)}</dl>
        </section>) : <p>本次回放尚无可展示的数值指标。</p>}
        {sysmem ? <p className="kernel-ncu-note">L2 sysmem 项描述 L2 与系统内存的交互，不代表整机内存流量。</p> : null}
        <p className="kernel-ncu-note">结合计算、访存与启动规模判断；低 occupancy 或单一吞吐指标不能独立确定瓶颈。</p>
        <details className="kernel-ncu-raw"><summary>采集身份与原始计数器</summary>
          <dl className="kernel-ncu-identity">
            <div><dt>采集</dt><dd>{capture.captureId}</dd></div>
            <div><dt>观测</dt><dd>{observation.observationId}</dd></div>
            <div><dt>运行</dt><dd>{capture.runId}</dd></div>
            <div><dt>来源</dt><dd>{capture.sourceId}</dd></div>
            <div><dt>选择范围</dt><dd>{capture.selectionPolicy === 'explicit_invocation' ? '指定 invocation' : '名称筛选后选中的 launch'} · {capture.coverage.observedCount} 次已观测 launch</dd></div>
            <div><dt>回放方式</dt><dd>{capture.ncu?.replayMode ?? '未记录'} · NCU {capture.toolVersion}</dd></div>
            {capture.ncu ? <>
              <div><dt>缓存控制请求</dt><dd>{capture.ncu.cacheControlRequest}</dd></div>
              <div><dt>时钟控制请求</dt><dd>{capture.ncu.clockControlRequest}</dd></div>
              <div><dt>外部时钟控制</dt><dd>{capture.ncu.externalClockControl ? `${capture.ncu.externalClockControl.controller} · ${capture.ncu.externalClockControl.state}` : '未记录'}</dd></div>
            </> : null}
          </dl>
          <ul>{[...metrics.values()].map(metric => <li key={metric.metricId}>
            <strong>{LABELS.get(metric.metricName) ?? metric.metricName} · {valueLabel(metric)}</strong>
            <code>{metric.rawCounterName ?? '无原始计数器名称'}</code>
            <span>{metric.sectionName} · {metric.statistic} · {metric.unit}</span>
            <span>{metric.basis}</span>
          </li>)}</ul>
        </details>
      </article>;
    })}
  </section>;
}
