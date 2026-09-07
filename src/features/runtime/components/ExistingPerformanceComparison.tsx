import { useState } from 'react';
import { AnalysisPlaceholder } from '../../../components/AnalysisPlaceholder';
import type { AtlasData, ModelRecord } from '../../../types/atlas';
import type { RoutePatch, RouteState } from '../../../app/routes';
import type { EvidenceRow } from '../../end-to-end/domain/buildEvidenceRows';
import { existingComparisons, existingComparisonKey, existingShapeLabel } from '../domain/modelAnalysisDescriptor';
import { runtimeEvidenceSelectionPatch } from '../domain/pi0PerformanceNavigation';
import { isInferenceRuntimeForModel } from '../domain/runtimeCatalog';
import { pi0PrecisionLabel } from './runtimePresentation';
import { RuntimePerformanceChart, performanceStatisticLabel, type RuntimePerformanceColumn } from './RuntimePerformanceChart';
import './existingPerformanceComparison.css';

type Props = { data: AtlasData; model: ModelRecord; route: RouteState; navigate: (patch: RoutePatch, replace?: boolean) => void };
function ComparisonContent({ data, model, route, navigate, rows, secondary = false }: Props & { rows: readonly EvidenceRow[]; secondary?: boolean }) {
  const inputKnown = data.datasets.model_graphs.some(record => record.model_id === model.model_id) || data.datasets.runs.some(run => run.model_id === model.model_id);
  const [batchIds, setBatchIds] = useState<Record<string, string>>({});
  const cohorts = [...new Map(rows.map(row => [existingComparisonKey(row), row])).entries()];
  const selected = rows.find(row => row.run.configuration_id === route.workload) ?? cohorts[0]?.[1];
  const cohort = selected ? rows.filter(row => existingComparisonKey(row) === existingComparisonKey(selected)) : [];
  const groups = [...new Set(cohort.map(row => `${row.run.runtime_id}|${row.run.precision.precision_id}`))].map(key => {
    const batches = cohort.filter(row => `${row.run.runtime_id}|${row.run.precision.precision_id}` === key).sort((a,b) => a.run.run_id.localeCompare(b.run.run_id));
    const row = batches.find(item => item.run.run_id === (batchIds[key] ?? route.selectedRun)) ?? batches[0]!;
    const latency = row.measurement.statistics.find(item => item.statistic === 'p50' && item.value != null)
      ?? (secondary ? row.measurement.statistics.find(item => item.statistic === 'mean' && item.value != null) : undefined);
    return { key, batches, row, latency };
  });
  const open = (run: EvidenceRow['run']) => navigate({ runtime: run.runtime_id, runtimePrecision: run.precision.precision_id, workload: run.configuration_id, selectedRun: run.run_id, ...runtimeEvidenceSelectionPatch(route, run.run_id), runtimeFacet: null });
  const columns: RuntimePerformanceColumn[] = groups.map(({ key, row, latency }) => ({
    id: key, runtimeId: row.run.runtime_id, runtimeLabel: row.runtimeLabel, precisionLabel: pi0PrecisionLabel(row.run.precision.precision_id, row.run.precision.precision_id.toUpperCase()),
    latencyMs: latency?.unit === 'ms' ? latency.value : null, statistic: latency?.statistic ?? null,
    missing: latency ? `记录单位 ${latency.unit}` : '当前口径暂无中位数', selected: route.selectedRun === row.run.run_id,
    onSelect: () => open(row.run), onInspect: () => open(row.run),
  }));
  if (!secondary) for (const runtime of data.datasets.runtimes.filter(runtime => isInferenceRuntimeForModel(runtime, model.model_id) && !groups.some(group => group.row.run.runtime_id === runtime.runtime_id))) {
    columns.push({ id: runtime.runtime_id, runtimeId: runtime.runtime_id, runtimeLabel: runtime.display_name, precisionLabel: '', latencyMs: null, statistic: null,
      missing: runtime.model_support.filter(item => item.model_id === model.model_id).every(item => item.status === 'not_supported') ? '当前模型不支持' : selected ? '当前输入无匹配测量' : '当前口径暂无测量',
      onInspect: () => navigate({ runtime: runtime.runtime_id, runtimePrecision: null, workload: selected?.run.configuration_id ?? route.workload, runtimeFacet: null, selectedRun: null, analysisView: 'system', timelineCapture: null, entity: null }),
    });
  }
  return <>
    {cohorts.length ? <label className="existing-shape-selector">已有输入与测量配置<select aria-label="已有输入与测量配置" value={selected ? existingComparisonKey(selected) : ''} onChange={event => { const row = cohorts.find(([key]) => key === event.target.value)![1]; navigate({ workload: row.run.configuration_id, selectedRun: null }, true); }}>{cohorts.map(([key,row]) => <option key={key} value={key}>{existingShapeLabel(row)} · 预热 {row.run.timing.warmup_iterations ?? '未知'} / 测量 {row.measurement.sampleCount}</option>)}</select></label> : null}
    {!rows.length && !secondary ? <div className="existing-comparison-empty"><AnalysisPlaceholder title={inputKnown ? "当前采样口径暂无测量" : "输入形状尚未填写"} state={inputKnown ? "no_match" : "not_recorded"} detail={inputKnown ? "可进入推理栈查看已有分析；其他采样口径在下方展开。" : "补充当前模型的输入维度与默认值后，可选择输入并比较性能。"} /></div> : null}
    {selected ? <p className="existing-comparison-input">{existingShapeLabel(selected)} · 预热 {selected.run.timing.warmup_iterations ?? '未记录'} 次 / 测量 {selected.measurement.sampleCount} 次</p> : null}
    {columns.length ? <RuntimePerformanceChart columns={columns} label={`${model.model_id} 固定输入的推理栈耗时柱状图`} note="点击柱子或查看推理栈，进入系统耗时、执行热点与执行优化。" /> : null}
    {groups.length ? <details className="pi0-runtime-evidence"><summary>测量口径与已有记录</summary><div className="pi0-runtime-evidence-list">{groups.map(({ key, row, batches, latency }) => <section key={key}><h4>{row.runtimeLabel}</h4><p>预热 {row.run.timing.warmup_iterations ?? '未记录'} 次 · 测量 {row.measurement.sampleCount} 次 · {latency ? performanceStatisticLabel(latency.statistic) : '中位数未记录'}</p>{batches.length > 1 ? <div className="existing-batch-buttons">{batches.map((item,index) => <button key={item.run.run_id} type="button" aria-pressed={item.run.run_id === row.run.run_id} onClick={() => setBatchIds({ ...batchIds, [key]: item.run.run_id })}>独立批次 {index+1}</button>)}</div> : null}</section>)}</div></details> : null}
  </>;
}
export function ExistingPerformanceComparison(props: Props) {
  const { data, model, route } = props;
  const rows = existingComparisons(data, model.model_id, route.hardware, false);
  const others = existingComparisons(data, model.model_id, route.hardware, true).filter(row => row.run.timing.warmup_iterations !== 5 || row.measurement.sampleCount !== 10 || !row.measurement.statistics.some(item => item.statistic === 'p50' && item.value != null));
  return <section className="existing-performance-comparison pi0-performance-overview" aria-label="已有输入形状的性能比较">
    <header className="pi0-overview-heading"><div><h3>推理耗时对比</h3><p>预热 5 次 / 测量 10 次 · 中位数</p></div></header>
    <ComparisonContent {...props} rows={rows} />
    {others.length ? <details className="pi0-runtime-evidence existing-other-protocols"><summary>查看已有其他采样口径</summary><ComparisonContent {...props} rows={others} secondary /></details> : null}
  </section>;
}
